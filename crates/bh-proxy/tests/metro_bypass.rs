use bh_core::TrafficEvent;
use futures::{SinkExt, StreamExt};
use hudsucker::tokio_tungstenite::tungstenite::Message;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn proxy_client(port: u16) -> reqwest::Client {
    reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).unwrap())
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}

async fn spawn_status_server(
    body: &'static str,
) -> (u16, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = socket.read(&mut chunk).await.unwrap();
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                break;
            }
        }
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        socket.write_all(resp.as_bytes()).await.unwrap();
        String::from_utf8_lossy(&buf).into_owned()
    });
    (port, task)
}

async fn spawn_ws_echo_server() -> (u16, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        while let Some(Ok(msg)) = ws.next().await {
            if msg.is_close() {
                break;
            }
            ws.send(msg).await.unwrap();
        }
    });
    (port, task)
}

async fn connect_through_proxy(proxy_port: u16, target_port: u16) -> tokio::net::TcpStream {
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", proxy_port))
        .await
        .unwrap();
    let req = format!(
        "CONNECT 127.0.0.1:{target_port} HTTP/1.1\r\nHost: 127.0.0.1:{target_port}\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let n = stream.read(&mut chunk).await.unwrap();
        assert!(n > 0, "proxy closed connection during CONNECT");
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let head = String::from_utf8_lossy(&buf);
    assert!(head.starts_with("HTTP/1.1 200"), "connect failed: {head}");
    stream
}

async fn free_port() -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    listener.local_addr().unwrap().port()
}

#[tokio::test]
async fn metro_emulator_http_bypass_relays_without_capture() {
    let (metro_port, server) = spawn_status_server("packager-status:running").await;

    let ca = bh_ca::generate_ca().unwrap();
    let sink = Arc::new(bh_core::RecordingSink::default());
    let handle = bh_proxy::start_mitm(
        0,
        &ca,
        2_000_000,
        sink.clone(),
        bh_proxy::MetroBypass {
            port: metro_port,
            enabled: true,
        },
        Vec::new(),
    )
    .await
    .unwrap();

    let client = proxy_client(handle.port);
    let resp = client
        .get(format!("http://10.0.2.2:{metro_port}/status"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "packager-status:running");

    let received = server.await.unwrap();
    assert!(received.starts_with("GET /status HTTP/1.1\r\n"));
    assert!(received.contains(&format!("host: 127.0.0.1:{metro_port}")));
    assert!(!received.contains("10.0.2.2"));

    handle.stop().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let events = sink.events.lock().unwrap();
    assert!(
        events.is_empty(),
        "expected no events for bypassed metro request, got {}",
        events.len()
    );
}

#[tokio::test]
async fn metro_loopback_http_bypass_relays_without_capture() {
    let (metro_port, server) = spawn_status_server("packager-status:running").await;

    let ca = bh_ca::generate_ca().unwrap();
    let sink = Arc::new(bh_core::RecordingSink::default());
    let handle = bh_proxy::start_mitm(
        0,
        &ca,
        2_000_000,
        sink.clone(),
        bh_proxy::MetroBypass {
            port: metro_port,
            enabled: true,
        },
        Vec::new(),
    )
    .await
    .unwrap();

    let client = proxy_client(handle.port);
    let resp = client
        .get(format!("http://127.0.0.1:{metro_port}/status"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "packager-status:running");
    server.await.unwrap();

    handle.stop().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let events = sink.events.lock().unwrap();
    assert!(
        events.is_empty(),
        "expected no events for direct loopback metro request, got {}",
        events.len()
    );
}

#[tokio::test]
async fn non_metro_http_is_captured_with_bypass_enabled() {
    let (other_port, server) = spawn_status_server("hello").await;
    let metro_port = free_port().await;

    let ca = bh_ca::generate_ca().unwrap();
    let sink = Arc::new(bh_core::RecordingSink::default());
    let handle = bh_proxy::start_mitm(
        0,
        &ca,
        2_000_000,
        sink.clone(),
        bh_proxy::MetroBypass {
            port: metro_port,
            enabled: true,
        },
        Vec::new(),
    )
    .await
    .unwrap();

    let client = proxy_client(handle.port);
    let resp = client
        .get(format!("http://127.0.0.1:{other_port}/x"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "hello");
    server.await.unwrap();

    handle.stop().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let events = sink.events.lock().unwrap();
    assert!(events
        .iter()
        .any(|e| matches!(e, TrafficEvent::ExchangeStarted { .. })));
    assert!(events
        .iter()
        .any(|e| matches!(e, TrafficEvent::ExchangeCompleted { .. })));
}

#[tokio::test]
async fn metro_capture_enabled_keeps_capture() {
    let (metro_port, server) = spawn_status_server("packager-status:running").await;

    let ca = bh_ca::generate_ca().unwrap();
    let sink = Arc::new(bh_core::RecordingSink::default());
    let handle = bh_proxy::start_mitm(
        0,
        &ca,
        2_000_000,
        sink.clone(),
        bh_proxy::MetroBypass {
            port: metro_port,
            enabled: false,
        },
        Vec::new(),
    )
    .await
    .unwrap();

    let client = proxy_client(handle.port);
    let resp = client
        .get(format!("http://10.0.2.2:{metro_port}/status"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "packager-status:running");
    server.await.unwrap();

    handle.stop().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let events = sink.events.lock().unwrap();
    let request = events
        .iter()
        .find_map(|e| match e {
            TrafficEvent::ExchangeStarted { request, .. } => Some(request),
            _ => None,
        })
        .expect("no exchange recorded");
    assert_eq!(request.url, format!("http://10.0.2.2:{metro_port}/status"));
    assert_eq!(request.host, "10.0.2.2");
    assert!(events
        .iter()
        .any(|e| matches!(e, TrafficEvent::ExchangeCompleted { .. })));
}

#[tokio::test]
async fn metro_ws_bypass_relays_without_capture() {
    let (ws_port, server) = spawn_ws_echo_server().await;

    let ca = bh_ca::generate_ca().unwrap();
    let sink = Arc::new(bh_core::RecordingSink::default());
    let handle = bh_proxy::start_mitm(
        0,
        &ca,
        2_000_000,
        sink.clone(),
        bh_proxy::MetroBypass {
            port: ws_port,
            enabled: true,
        },
        Vec::new(),
    )
    .await
    .unwrap();

    let stream = connect_through_proxy(handle.port, ws_port).await;
    let (mut ws, _) = tokio_tungstenite::client_async(format!("ws://127.0.0.1:{ws_port}/hmr"), stream)
        .await
        .unwrap();
    ws.send(Message::Text("hello-metro".to_owned()))
        .await
        .unwrap();
    let echoed = ws.next().await.unwrap().unwrap();
    assert_eq!(echoed.to_string(), "hello-metro");
    ws.close(None).await.unwrap();
    server.await.unwrap();

    handle.stop().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let events = sink.events.lock().unwrap();
    assert!(
        events.is_empty(),
        "expected no events for bypassed metro websocket, got {}",
        events.len()
    );
}

#[tokio::test]
async fn non_metro_ws_is_captured_with_bypass_enabled() {
    let (ws_port, server) = spawn_ws_echo_server().await;
    let metro_port = free_port().await;

    let ca = bh_ca::generate_ca().unwrap();
    let sink = Arc::new(bh_core::RecordingSink::default());
    let handle = bh_proxy::start_mitm(
        0,
        &ca,
        2_000_000,
        sink.clone(),
        bh_proxy::MetroBypass {
            port: metro_port,
            enabled: true,
        },
        Vec::new(),
    )
    .await
    .unwrap();

    let stream = connect_through_proxy(handle.port, ws_port).await;
    let (mut ws, _) = tokio_tungstenite::client_async(
        format!("ws://127.0.0.1:{ws_port}/socket"),
        stream,
    )
    .await
    .unwrap();
    ws.send(Message::Text("hello-other".to_owned()))
        .await
        .unwrap();
    let echoed = ws.next().await.unwrap().unwrap();
    assert_eq!(echoed.to_string(), "hello-other");
    ws.close(None).await.unwrap();
    server.await.unwrap();

    handle.stop().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let events = sink.events.lock().unwrap();
    assert!(events
        .iter()
        .any(|e| matches!(e, TrafficEvent::ExchangeStarted { .. })));
    assert!(events.iter().any(|e| matches!(
        e,
        TrafficEvent::Ws(bh_core::types::WsEvent::Opened { .. })
    )));
    assert!(events.iter().any(|e| matches!(
        e,
        TrafficEvent::Ws(bh_core::types::WsEvent::Frame { .. })
    )));
}
