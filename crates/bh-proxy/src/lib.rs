pub mod handler;
pub mod ws;

use bh_ca::Ca;
use bh_core::TrafficSink;
use handler::RecordingHttpHandler;
use hudsucker::certificate_authority::RcgenAuthority;
use hudsucker::rcgen::{CertificateParams, KeyPair};
use hudsucker::rustls::crypto::aws_lc_rs;
use hudsucker::Proxy;
use std::net::SocketAddr;
use std::sync::Arc;
use thiserror::Error;
use ws::RecordingWsHandler;

#[derive(Debug, Error)]
pub enum ProxyError {
    #[error("bind failed: {0}")]
    Bind(String),
    #[error("ca setup failed: {0}")]
    Ca(String),
    #[error("proxy build failed: {0}")]
    Build(String),
}

pub struct ProxyHandle {
    pub port: u16,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    join: tokio::task::JoinHandle<Result<(), hudsucker::Error>>,
}

impl ProxyHandle {
    pub async fn stop(mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        let _ = self.join.await;
    }
}

pub async fn start_mitm(
    port: u16,
    ca: &Ca,
    body_cap: usize,
    sink: Arc<dyn TrafficSink>,
) -> Result<ProxyHandle, ProxyError> {
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))
        .await
        .map_err(|e| ProxyError::Bind(e.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|e| ProxyError::Bind(e.to_string()))?
        .port();

    let key_pair = KeyPair::from_pem(&ca.key_pem).map_err(|e| ProxyError::Ca(e.to_string()))?;
    let ca_cert = CertificateParams::from_ca_cert_pem(&ca.cert_pem)
        .map_err(|e| ProxyError::Ca(e.to_string()))?
        .self_signed(&key_pair)
        .map_err(|e| ProxyError::Ca(e.to_string()))?;
    let authority = RcgenAuthority::new(key_pair, ca_cert, 1_000, aws_lc_rs::default_provider());

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let proxy = Proxy::builder()
        .with_listener(listener)
        .with_ca(authority)
        .with_rustls_client(aws_lc_rs::default_provider())
        .with_http_handler(RecordingHttpHandler::new(sink.clone(), body_cap))
        .with_websocket_handler(RecordingWsHandler::new(sink, body_cap))
        .with_graceful_shutdown(async {
            let _ = rx.await;
        })
        .build()
        .map_err(|e| ProxyError::Build(e.to_string()))?;

    let join = tokio::spawn(proxy.start());
    Ok(ProxyHandle {
        port,
        shutdown: Some(tx),
        join,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn starts_on_random_port_and_stops() {
        let ca = bh_ca::generate_ca().unwrap();
        let sink = Arc::new(bh_core::RecordingSink::default());
        let handle = start_mitm(0, &ca, 1000, sink).await.unwrap();
        assert!(handle.port > 0);
        handle.stop().await;
    }
}
