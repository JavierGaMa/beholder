#[tokio::test]
async fn emulator_host_upstream_rewrites_to_loopback() {
    let metro = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let metro_port = metro.local_addr().unwrap().port();
    let metro_task = tokio::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (mut socket, _) = metro.accept().await.unwrap();
        let mut buf = [0u8; 4096];
        let _ = socket.read(&mut buf).await;
        let body = "packager-status:running";
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        socket.write_all(resp.as_bytes()).await.unwrap();
    });

    let ca = bh_ca::generate_ca().unwrap();
    let sink = std::sync::Arc::new(bh_core::RecordingSink::default());
    let handle = bh_proxy::start_mitm(0, &ca, 2_000_000, sink.clone())
        .await
        .unwrap();

    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{}", handle.port)).unwrap())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap();

    let resp = client
        .get(format!("http://10.0.2.2:{metro_port}/status"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "packager-status:running");
    metro_task.await.unwrap();

    handle.stop().await;
    let events = sink.events.lock().unwrap();
    let request = events
        .iter()
        .find_map(|e| match e {
            bh_core::TrafficEvent::ExchangeStarted { request, .. } => Some(request),
            _ => None,
        })
        .expect("no exchange recorded");
    assert_eq!(request.url, format!("http://10.0.2.2:{metro_port}/status"));
    assert_eq!(request.host, "10.0.2.2");
}
