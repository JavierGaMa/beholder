use bh_core::types::{BodyCapture, HttpResponse, TrafficEvent};
use std::io::Write;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const CAP: usize = 64;

const JSON_SMALL: &str = r#"{"ok":true,"n":1}"#;
const JSON_BIG: &str = r#"{"ok":true,"items":["alpha","bravo","charlie","delta","echo","foxtrot","golf","hotel"]}"#;
const LATIN1: &[u8] = b"caf\xe9 na\xefve";

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(data).unwrap();
    enc.finish().unwrap()
}

async fn read_request_head(stream: &mut TcpStream) -> String {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let n = stream.read(&mut chunk).await.unwrap();
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

async fn serve_conn(mut stream: TcpStream) {
    let head = read_request_head(&mut stream).await;
    let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
    match path.as_str() {
        "/gzip-small" => {
            let body = gzip(JSON_SMALL.as_bytes());
            write_response(&mut stream, "200 OK", "application/json", "gzip", &body).await;
        }
        "/gzip-big" => {
            let body = gzip(JSON_BIG.as_bytes());
            write_response(&mut stream, "200 OK", "application/json", "gzip", &body).await;
        }
        "/latin1" => {
            write_response(&mut stream, "200 OK", "text/plain", "", LATIN1).await;
        }
        "/stream" => {
            stream
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n")
                .await
                .unwrap();
            for byte in [b'x', b'y', b'z'] {
                stream.write_all(&vec![byte; 100]).await.unwrap();
                stream.flush().await.unwrap();
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }
        _ => {
            write_response(&mut stream, "404 Not Found", "text/plain", "", b"not found").await;
        }
    }
}

async fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    encoding: &str,
    body: &[u8],
) {
    let mut head = format!(
        "HTTP/1.1 {}\r\ncontent-type: {}\r\ncontent-length: {}\r\n",
        status,
        content_type,
        body.len()
    );
    if !encoding.is_empty() {
        head.push_str(&format!("content-encoding: {}\r\n", encoding));
    }
    head.push_str("connection: close\r\n\r\n");
    stream.write_all(head.as_bytes()).await.unwrap();
    stream.write_all(body).await.unwrap();
    stream.flush().await.unwrap();
}

async fn wait_for_response(sink: &bh_core::RecordingSink, path: &str) -> HttpResponse {
    for _ in 0..200 {
        let found = {
            let events = sink.events.lock().unwrap();
            let ids: Vec<u64> = events
                .iter()
                .filter_map(|e| match e {
                    TrafficEvent::ExchangeStarted { id, request } if request.path == path => {
                        Some(*id)
                    }
                    _ => None,
                })
                .collect();
            events
                .iter()
                .find_map(|e| match e {
                    TrafficEvent::ExchangeCompleted { id, response, .. } if ids.contains(id) => {
                        Some(response.clone())
                    }
                    _ => None,
                })
        };
        if let Some(response) = found {
            return response;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("no ExchangeCompleted event for {}", path);
}

fn body_of(response: &HttpResponse) -> BodyCapture {
    response.body.clone().expect("response should carry a body")
}

#[tokio::test]
async fn capture_decodes_while_client_receives_encoded_bytes() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            if let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(serve_conn(stream));
            }
        }
    });

    let ca = bh_ca::generate_ca().unwrap();
    let sink = std::sync::Arc::new(bh_core::RecordingSink::default());
    let handle = bh_proxy::start_mitm(
        0,
        &ca,
        CAP,
        sink.clone(),
        bh_proxy::MetroBypass {
            port: 8081,
            enabled: false,
        },
        Vec::new(),
    )
    .await
    .unwrap();

    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{}", handle.port)).unwrap())
        .build()
        .unwrap();

    let base = format!("http://127.0.0.1:{}", server_port);

    let gz_small = gzip(JSON_SMALL.as_bytes());
    let res = client
        .get(format!("{}/gzip-small", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.headers().get("content-encoding").unwrap(), "gzip");
    let client_bytes = res.bytes().await.unwrap();
    assert_eq!(&client_bytes[..], &gz_small[..]);
    let capture = body_of(&wait_for_response(&sink, "/gzip-small").await);
    assert_eq!(capture.text, JSON_SMALL);
    assert_eq!(capture.size, JSON_SMALL.len());
    assert!(!capture.truncated);
    assert!(!capture.is_binary);

    let gz_big = gzip(JSON_BIG.as_bytes());
    let res = client.get(format!("{}/gzip-big", base)).send().await.unwrap();
    let client_bytes = res.bytes().await.unwrap();
    assert_eq!(&client_bytes[..], &gz_big[..]);
    let capture = body_of(&wait_for_response(&sink, "/gzip-big").await);
    assert!(capture.truncated);
    assert_eq!(capture.size, JSON_BIG.len());
    assert_eq!(capture.text.len(), CAP);
    assert!(capture.text.starts_with(r#"{"ok":true,"items":["alpha"#));

    let res = client.get(format!("{}/latin1", base)).send().await.unwrap();
    let client_bytes = res.bytes().await.unwrap();
    assert_eq!(&client_bytes[..], LATIN1);
    let capture = body_of(&wait_for_response(&sink, "/latin1").await);
    assert_eq!(capture.text, "café naïve");
    assert!(!capture.is_binary);

    let expected_stream: Vec<u8> = [b'x', b'y', b'z']
        .iter()
        .flat_map(|b| vec![*b; 100])
        .collect();
    let res = client.get(format!("{}/stream", base)).send().await.unwrap();
    let client_bytes = res.bytes().await.unwrap();
    assert_eq!(&client_bytes[..], &expected_stream[..]);
    let capture = body_of(&wait_for_response(&sink, "/stream").await);
    assert!(capture.truncated);
    assert_eq!(capture.size, 300);
    assert_eq!(capture.text.len(), CAP);
    assert!(capture.text.starts_with(&"x".repeat(CAP)));

    handle.stop().await;
}
