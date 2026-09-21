use hudsucker::rcgen;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_rustls::rustls;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer, ServerName};
use tokio_rustls::{TlsAcceptor, TlsConnector};

async fn spawn_localhost_tls_server() -> (u16, Vec<u8>, tokio::task::JoinHandle<()>) {
    let key_pair = rcgen::KeyPair::generate().unwrap();
    let params = rcgen::CertificateParams::new(vec!["localhost".to_string()]).unwrap();
    let cert = params.self_signed(&key_pair).unwrap();
    let cert_der = cert.der().to_vec();

    let server_config = rustls::ServerConfig::builder_with_provider(
        rustls::crypto::aws_lc_rs::default_provider().into(),
    )
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![CertificateDer::from(cert_der.clone())],
        PrivatePkcs8KeyDer::from(key_pair.serialize_der()).into(),
    )
    .unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(server_config));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut tls = acceptor.accept(stream).await.unwrap();
        let mut buf = [0u8; 1024];
        let _ = tls.read(&mut buf).await;
    });
    (port, cert_der, task)
}

fn client_trusting_only(cert_der: &[u8]) -> TlsConnector {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(CertificateDer::from(cert_der.to_vec())).unwrap();
    let config = rustls::ClientConfig::builder_with_provider(
        rustls::crypto::aws_lc_rs::default_provider().into(),
    )
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_root_certificates(roots)
    .with_no_client_auth();
    TlsConnector::from(Arc::new(config))
}

async fn connect_tunnel(proxy_port: u16, host: &str, port: u16) -> tokio::net::TcpStream {
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", proxy_port))
        .await
        .unwrap();
    let req = format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n");
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

#[tokio::test]
async fn bypassed_host_relays_real_certificate() {
    let (server_port, cert_der, server) = spawn_localhost_tls_server().await;

    let ca = bh_ca::generate_ca().unwrap();
    let sink = Arc::new(bh_core::RecordingSink::default());
    let handle = bh_proxy::start_mitm(
        0,
        &ca,
        2_000_000,
        sink.clone(),
        bh_proxy::MetroBypass {
            port: 8081,
            enabled: false,
        },
        vec!["localhost".to_string()],
    )
    .await
    .unwrap();

    let tunnel = connect_tunnel(handle.port, "localhost", server_port).await;
    let mut tls = client_trusting_only(&cert_der)
        .connect(ServerName::try_from("localhost").unwrap(), tunnel)
        .await
        .unwrap();

    let peer = tls
        .get_ref()
        .1
        .peer_certificates()
        .unwrap()
        .first()
        .unwrap();
    assert_eq!(peer.as_ref(), cert_der.as_slice());
    tls.shutdown().await.unwrap();
    server.await.unwrap();

    handle.stop().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let events = sink.events.lock().unwrap();
    assert!(
        events.is_empty(),
        "expected no events for bypassed tunnel, got {}",
        events.len()
    );
}

#[tokio::test]
async fn non_bypassed_host_is_intercepted() {
    let (server_port, cert_der, _server) = spawn_localhost_tls_server().await;

    let ca = bh_ca::generate_ca().unwrap();
    let sink = Arc::new(bh_core::RecordingSink::default());
    let handle = bh_proxy::start_mitm(
        0,
        &ca,
        2_000_000,
        sink.clone(),
        bh_proxy::MetroBypass {
            port: 8081,
            enabled: false,
        },
        Vec::new(),
    )
    .await
    .unwrap();

    let tunnel = connect_tunnel(handle.port, "localhost", server_port).await;
    let result = client_trusting_only(&cert_der)
        .connect(ServerName::try_from("localhost").unwrap(), tunnel)
        .await;

    let err = result.err().expect("expected interception to break trust");
    assert!(
        err.to_string().contains("UnknownIssuer"),
        "expected unknown-issuer failure, got: {err}"
    );

    handle.stop().await;
}
