use bh_core::{HttpRequest, RoutedTo, TrafficEvent};
use bh_proxy::{ActiveRoutes, MetroBypass, ProxyHandle, SharedRoutes};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct Upstream {
    port: u16,
    received: Arc<Mutex<Vec<String>>>,
}

impl Upstream {
    async fn start(name: &'static str) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let received = Arc::new(Mutex::new(Vec::new()));
        let log = received.clone();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let log = log.clone();
                tokio::spawn(async move {
                    let mut data = Vec::new();
                    let mut buf = [0u8; 4096];
                    while !is_complete(&data) {
                        match socket.read(&mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => data.extend_from_slice(&buf[..n]),
                        }
                    }
                    log.lock()
                        .unwrap()
                        .push(String::from_utf8_lossy(&data).into_owned());
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        name.len(),
                        name
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                });
            }
        });
        Upstream { port, received }
    }

    fn only_request(&self) -> String {
        let received = self.received.lock().unwrap();
        assert_eq!(received.len(), 1, "{received:?}");
        received[0].clone()
    }
}

fn is_complete(data: &[u8]) -> bool {
    let text = String::from_utf8_lossy(data).to_ascii_lowercase();
    let Some((head, body)) = text.split_once("\r\n\r\n") else {
        return false;
    };
    let expected = head
        .lines()
        .find_map(|l| l.strip_prefix("content-length:"))
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(0);
    body.len() >= expected
}

struct Harness {
    handle: ProxyHandle,
    client: reqwest::Client,
    sink: Arc<bh_core::RecordingSink>,
    routes: SharedRoutes,
}

impl Harness {
    async fn start(routes_json: String) -> Self {
        let file = bh_core::parse_route_file(&routes_json).unwrap();
        let routes: SharedRoutes = Arc::new(std::sync::RwLock::new(ActiveRoutes {
            routes: file.routes,
            enabled: Default::default(),
        }));
        let ca = bh_ca::generate_ca().unwrap();
        let sink = Arc::new(bh_core::RecordingSink::default());
        let handle = bh_proxy::start_mitm(
            0,
            &ca,
            2_000_000,
            sink.clone(),
            MetroBypass {
                port: 8081,
                enabled: false,
            },
            Vec::new(),
            routes.clone(),
        )
        .await
        .unwrap();
        let cert = reqwest::Certificate::from_pem(ca.cert_pem.as_bytes()).unwrap();
        let client = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{}", handle.port)).unwrap())
            .add_root_certificate(cert)
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap();
        Harness {
            handle,
            client,
            sink,
            routes,
        }
    }

    fn enable(&self, key: &str) {
        self.routes.write().unwrap().enabled.insert(key.to_string());
    }

    fn requests(&self) -> Vec<HttpRequest> {
        self.sink
            .events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                TrafficEvent::ExchangeStarted { request, .. } => Some(request.clone()),
                _ => None,
            })
            .collect()
    }
}

fn orders_route(port: u16) -> String {
    format!(
        r#"{{"version":1,"name":"local stack","routes":[{{"id":"orders","match":{{"pathPrefix":"/v1/Orders"}},"target":"http://127.0.0.1:{port}"}}]}}"#
    )
}

#[tokio::test]
async fn matched_https_request_reaches_the_local_target() {
    let local = Upstream::start("local-orders").await;
    let harness = Harness::start(orders_route(local.port)).await;
    harness.enable("orders");

    let url = "https://gateway.example.test/v1/orders/api/Items?x=1";
    let resp = harness
        .client
        .post(url)
        .header("authorization", "Bearer test-token")
        .header("content-type", "text/plain")
        .body("payload")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "local-orders");

    let received = local.only_request();
    let lower = received.to_ascii_lowercase();
    assert!(
        received.starts_with("POST /api/Items?x=1 HTTP/1.1\r\n"),
        "{received}"
    );
    assert!(
        lower.contains(&format!("\r\nhost: 127.0.0.1:{}\r\n", local.port)),
        "{received}"
    );
    assert!(!lower.contains("gateway.example.test"), "{received}");
    assert!(
        lower.contains("\r\nauthorization: bearer test-token\r\n"),
        "{received}"
    );
    assert!(received.ends_with("\r\n\r\npayload"), "{received}");

    let requests = harness.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].url,
        "https://gateway.example.test:443/v1/orders/api/Items?x=1"
    );
    assert_eq!(requests[0].host, "gateway.example.test");
    assert_eq!(requests[0].path, "/v1/orders/api/Items");
    assert_eq!(
        requests[0].routed,
        Some(RoutedTo {
            route_id: "orders".into(),
            target: format!("http://127.0.0.1:{}", local.port),
        })
    );
    harness.handle.stop().await;
}

#[tokio::test]
async fn unmatched_request_is_untouched() {
    let local = Upstream::start("local-orders").await;
    let other = Upstream::start("other").await;
    let harness = Harness::start(orders_route(local.port)).await;
    harness.enable("orders");

    let url = format!("http://127.0.0.1:{}/v1/ordersX/api?y=2", other.port);
    let resp = harness.client.get(&url).send().await.unwrap();
    assert_eq!(resp.text().await.unwrap(), "other");

    let received = other.only_request();
    assert!(
        received.starts_with("GET /v1/ordersX/api?y=2 HTTP/1.1\r\n"),
        "{received}"
    );
    assert!(local.received.lock().unwrap().is_empty());
    assert_eq!(harness.requests()[0].routed, None);
    harness.handle.stop().await;
}

#[tokio::test]
async fn toggling_applies_to_the_next_request_without_restart() {
    let local = Upstream::start("local-orders").await;
    let other = Upstream::start("other").await;
    let harness = Harness::start(orders_route(local.port)).await;
    let url = format!("http://127.0.0.1:{}/v1/orders/api", other.port);

    let send = || async {
        harness
            .client
            .get(&url)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap()
    };
    assert_eq!(send().await, "other");
    harness.enable("orders");
    assert_eq!(send().await, "local-orders");
    harness.routes.write().unwrap().enabled.clear();
    assert_eq!(send().await, "other");

    let routed: Vec<bool> = harness
        .requests()
        .iter()
        .map(|r| r.routed.is_some())
        .collect();
    assert_eq!(routed, [false, true, false]);
    harness.handle.stop().await;
}

#[tokio::test]
async fn websocket_upgrade_is_never_routed() {
    let local = Upstream::start("local-orders").await;
    let other = Upstream::start("other").await;
    let harness = Harness::start(orders_route(local.port)).await;
    harness.enable("orders");

    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", harness.handle.port))
        .await
        .unwrap();
    let request = format!(
        "GET http://127.0.0.1:{port}/v1/orders/hub HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
        port = other.port
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut buf = [0u8; 1024];
    let n = stream.read(&mut buf).await.unwrap();
    assert!(String::from_utf8_lossy(&buf[..n]).starts_with("HTTP/1.1 101"));
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    assert!(local.received.lock().unwrap().is_empty());
    assert!(other.only_request().starts_with("GET /v1/orders/hub "));
    assert_eq!(harness.requests()[0].routed, None);
    harness.handle.stop().await;
}

#[tokio::test]
async fn unreachable_target_records_a_failed_exchange() {
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let harness = Harness::start(orders_route(port)).await;
    harness.enable("orders");

    let resp = harness
        .client
        .get("https://gateway.example.test/v1/orders/api")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 502);

    let events = harness.sink.events.lock().unwrap().clone();
    assert!(
        matches!(
            events.as_slice(),
            [
                TrafficEvent::ExchangeStarted { id: started, .. },
                TrafficEvent::ExchangeFailed { id: failed, error },
            ] if started == failed && !error.is_empty()
        ),
        "{events:?}"
    );
    harness.handle.stop().await;
}
