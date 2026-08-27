#[tokio::test]
async fn http_and_https_roundtrip() {
    let ca = bh_ca::generate_ca().unwrap();
    let sink = std::sync::Arc::new(bh_core::RecordingSink::default());

    let handle = bh_proxy::start_mitm(0, &ca, 2_000_000, sink.clone())
        .await
        .unwrap();

    let cert = reqwest::Certificate::from_pem(ca.cert_pem.as_bytes()).unwrap();
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{}", handle.port)).unwrap())
        .add_root_certificate(cert)
        .build()
        .unwrap();

    let http_status = client
        .get("http://example.com")
        .send()
        .await
        .unwrap()
        .status();
    let https_status = client
        .get("https://example.com")
        .send()
        .await
        .unwrap()
        .status();

    assert_eq!(http_status, 200);
    assert_eq!(https_status, 200);

    handle.stop().await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let events = sink.events.lock().unwrap();
    assert!(
        events.len() >= 2,
        "expected at least 2 events, got {}",
        events.len()
    );
    assert!(events
        .iter()
        .any(|e| matches!(e, bh_core::TrafficEvent::ExchangeCompleted { .. })));
    assert!(events
        .iter()
        .any(|e| matches!(e, bh_core::TrafficEvent::ExchangeStarted { .. })));
}
