use crate::config::{self, ConfigError, UiConfig};
use crate::routes::{self, Health};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(2);
const DISCOVERY_BODY_CAP: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DiscoveredFile {
    pub id: String,
    pub label: String,
    pub path: String,
    pub hint: Option<String>,
    pub routes: usize,
    pub up: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DiscoveryResult {
    pub name: String,
    pub address: String,
    pub files: Vec<DiscoveredFile>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiscoverFailure {
    InvalidAddress { message: String },
    Unreachable { message: String },
    InvalidResponse { message: String },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RouteConfigError {
    InvalidFile { message: String },
    Config { message: String },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RouteFilesUpdate {
    pub files: Vec<String>,
    pub name: String,
    pub reset: Vec<String>,
}

pub async fn discover(address: &str) -> Result<DiscoveryResult, DiscoverFailure> {
    let Some(base) = bh_core::discovery_base(address) else {
        return Err(DiscoverFailure::InvalidAddress {
            message: format!("`{address}` is not a local address"),
        });
    };
    let body = fetch(&format!("{base}{}", bh_core::DISCOVERY_PATH)).await?;
    let text = std::str::from_utf8(&body).map_err(unreachable)?;
    serde_json::from_str::<serde::de::IgnoredAny>(text).map_err(unreachable)?;
    let document =
        bh_core::parse_discovery(text).map_err(|e| DiscoverFailure::InvalidResponse {
            message: e.to_string(),
        })?;
    let mut files = Vec::with_capacity(document.files.len());
    for file in document.files {
        let loaded = routes::load_file(&file.path).await;
        let up = routes::probe_all(&loaded.routes)
            .await
            .values()
            .filter(|health| **health == Health::Up)
            .count();
        files.push(DiscoveredFile {
            id: file.id,
            label: file.label,
            path: file.path,
            hint: file.hint,
            routes: loaded.routes.len(),
            up,
            error: loaded.error,
        });
    }
    Ok(DiscoveryResult {
        name: document.name,
        address: base,
        files,
    })
}

fn unreachable(error: impl std::fmt::Display) -> DiscoverFailure {
    DiscoverFailure::Unreachable {
        message: error.to_string(),
    }
}

async fn fetch(url: &str) -> Result<Vec<u8>, DiscoverFailure> {
    let client = reqwest::Client::builder()
        .timeout(DISCOVERY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(unreachable)?;
    let mut response = client.get(url).send().await.map_err(unreachable)?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(unreachable(response.status()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(unreachable)? {
        if body.len() + chunk.len() > DISCOVERY_BODY_CAP {
            return Err(DiscoverFailure::InvalidResponse {
                message: "discovery document is larger than 64 KiB".into(),
            });
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub async fn connect(
    dir: &Path,
    path: &str,
    replaces: &[String],
) -> Result<(RouteFilesUpdate, UiConfig), RouteConfigError> {
    let loaded = routes::load_file(path).await;
    if let Some(message) = loaded.error {
        return Err(RouteConfigError::InvalidFile { message });
    }
    update(dir, loaded.name, |current| {
        let mut next: Vec<String> = current
            .iter()
            .filter(|file| *file == path || !replaces.contains(file))
            .cloned()
            .collect();
        if !next.iter().any(|file| file == path) {
            next.push(path.to_string());
        }
        next
    })
}

pub fn remove(dir: &Path, path: &str) -> Result<(RouteFilesUpdate, UiConfig), RouteConfigError> {
    update(dir, String::new(), |current| {
        current
            .iter()
            .filter(|file| *file != path)
            .cloned()
            .collect()
    })
}

fn update(
    dir: &Path,
    name: String,
    change: impl FnOnce(&[String]) -> Vec<String>,
) -> Result<(RouteFilesUpdate, UiConfig), RouteConfigError> {
    let failed = |e: ConfigError| RouteConfigError::Config {
        message: e.to_string(),
    };
    let mut next: Vec<String> = Vec::new();
    let mut reset: Vec<String> = Vec::new();
    let (config, _) = config::update(dir, |config| {
        next = change(&config.routes.files);
        let removed = config.routes.files.iter().filter(|f| !next.contains(f));
        let added = next.iter().filter(|f| !config.routes.files.contains(f));
        for file in removed.chain(added) {
            if !reset.contains(file) {
                reset.push(file.clone());
            }
        }
        config.routes.files = next.clone();
    })
    .map_err(failed)?;
    Ok((
        RouteFilesUpdate {
            files: next,
            name,
            reset,
        },
        config,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Instant;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    struct Server {
        address: String,
        requests: Arc<std::sync::Mutex<Vec<String>>>,
        hits: Arc<AtomicUsize>,
    }

    async fn serve(response: Vec<u8>) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
        let hits = Arc::new(AtomicUsize::new(0));
        let (seen, count) = (requests.clone(), hits.clone());
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                count.fetch_add(1, Ordering::SeqCst);
                let mut buffer = [0u8; 2048];
                let n = stream.read(&mut buffer).await.unwrap_or(0);
                seen.lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&buffer[..n]).into_owned());
                let _ = stream.write_all(&response).await;
                let _ = stream.shutdown().await;
            }
        });
        Server {
            address,
            requests,
            hits,
        }
    }

    fn http(status: &str, headers: &str, body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 {status}\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    fn ok(body: &str) -> Vec<u8> {
        http("200 OK", "content-type: application/json\r\n", body)
    }

    fn document(files: serde_json::Value) -> String {
        serde_json::json!({ "version": 1, "name": "local stack", "files": files }).to_string()
    }

    fn one_file() -> String {
        document(serde_json::json!([{ "id": "dev", "label": "Dev", "path": "/abs/missing.json" }]))
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bh-discovery-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn route_file(dir: &Path, name: &str, ports: &[u16]) -> String {
        let routes: Vec<_> = ports
            .iter()
            .enumerate()
            .map(|(i, port)| {
                serde_json::json!({
                    "id": format!("route{i}"),
                    "match": { "pathPrefix": format!("/v1/{i}") },
                    "target": format!("http://127.0.0.1:{port}")
                })
            })
            .collect();
        let path = dir.join(name);
        let body = serde_json::json!({ "version": 1, "name": name, "routes": routes });
        std::fs::write(&path, body.to_string()).unwrap();
        path.display().to_string()
    }

    fn closed_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    fn configure(dir: &Path, files: &[&String]) {
        let mut cfg = config::UiConfig::default();
        cfg.theme = "carbon".into();
        cfg.metro.port = 9100;
        cfg.apks.list_url = "https://example.com/list".into();
        cfg.routes.files = files.iter().map(|f| f.to_string()).collect();
        config::write_config(dir, &cfg).unwrap();
    }

    fn raw_config(dir: &Path) -> String {
        std::fs::read_to_string(config::config_path(dir)).unwrap()
    }

    #[tokio::test]
    async fn discovers_files_with_their_route_and_running_counts() {
        let dir = scratch("counts");
        let up = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let up_port = up.local_addr().unwrap().port();
        let good = route_file(&dir, "dev.json", &[up_port, closed_port()]);
        let invalid = dir.join("invalid.json").display().to_string();
        std::fs::write(&invalid, r#"{"version":2}"#).unwrap();
        let missing = dir.join("missing.json").display().to_string();
        let server = serve(ok(&document(serde_json::json!([
            { "id": "dev", "label": "Dev", "path": good, "hint": "make dev" },
            { "id": "staging", "label": "Staging", "path": invalid },
            { "id": "other", "label": "Other", "path": missing }
        ]))))
        .await;

        let found = discover(&format!("{}/", server.address)).await.unwrap();

        assert_eq!(found.name, "local stack");
        assert_eq!(found.address, server.address);
        assert_eq!(
            found.files[0],
            DiscoveredFile {
                id: "dev".into(),
                label: "Dev".into(),
                path: good,
                hint: Some("make dev".into()),
                routes: 2,
                up: 1,
                error: None,
            }
        );
        assert_eq!(
            found.files[1].error.as_deref(),
            Some("unsupported route file version 2 (supported: 1)")
        );
        assert_eq!((found.files[1].routes, found.files[1].up), (0, 0));
        assert!(found.files[2]
            .error
            .as_ref()
            .unwrap()
            .starts_with("cannot read route file"));
        assert!(server.requests.lock().unwrap()[0]
            .starts_with("GET /.well-known/beholder-routes HTTP/1.1\r\n"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn rejects_non_local_addresses_without_a_request() {
        for address in ["http://example.com:80", "https://localhost:8090", "nope"] {
            assert!(
                matches!(
                    discover(address).await,
                    Err(DiscoverFailure::InvalidAddress { .. })
                ),
                "{address}"
            );
        }
    }

    #[tokio::test]
    async fn reports_nothing_answered_for_refused_non_200_and_non_json() {
        let refused = format!("http://127.0.0.1:{}", closed_port());
        let missing = serve(http("404 Not Found", "", &one_file())).await;
        let created = serve(http("201 Created", "", &one_file())).await;
        let html = serve(ok("<html></html>")).await;
        for address in [
            refused,
            missing.address.clone(),
            created.address.clone(),
            html.address.clone(),
        ] {
            assert!(
                matches!(
                    discover(&address).await,
                    Err(DiscoverFailure::Unreachable { .. })
                ),
                "{address}"
            );
        }
    }

    #[tokio::test]
    async fn does_not_follow_redirects() {
        let target = serve(ok(&one_file())).await;
        let location = format!(
            "location: {}/.well-known/beholder-routes\r\n",
            target.address
        );
        let server = serve(http("302 Found", &location, "")).await;
        assert!(matches!(
            discover(&server.address).await,
            Err(DiscoverFailure::Unreachable { .. })
        ));
        assert_eq!(server.hits.load(Ordering::SeqCst), 1);
        assert_eq!(target.hits.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn gives_up_after_two_seconds() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let held = tokio::spawn(async move {
            let mut streams = Vec::new();
            while let Ok((stream, _)) = listener.accept().await {
                streams.push(stream);
            }
        });
        let started = Instant::now();
        let result = discover(&address).await;
        let elapsed = started.elapsed();
        held.abort();
        assert!(matches!(result, Err(DiscoverFailure::Unreachable { .. })));
        assert!(elapsed >= Duration::from_millis(1900), "{elapsed:?}");
        assert!(elapsed < Duration::from_secs(5), "{elapsed:?}");
    }

    #[tokio::test]
    async fn caps_the_response_body_at_64_kib() {
        let padded = |size: usize| {
            let body = one_file();
            format!("{body}{}", " ".repeat(size - body.len()))
        };
        let exact = serve(ok(&padded(64 * 1024))).await;
        assert!(discover(&exact.address).await.is_ok());

        let sized = serve(ok(&padded(64 * 1024 + 1))).await;
        let unsized_body = format!(
            "HTTP/1.1 200 OK\r\nconnection: close\r\n\r\n{}",
            padded(80 * 1024)
        );
        let streamed = serve(unsized_body.into_bytes()).await;
        for address in [sized.address.clone(), streamed.address.clone()] {
            assert_eq!(
                discover(&address).await,
                Err(DiscoverFailure::InvalidResponse {
                    message: "discovery document is larger than 64 KiB".into()
                })
            );
        }
    }

    #[tokio::test]
    async fn reports_an_invalid_document_with_its_message() {
        let server = serve(ok(r#"{"version":2}"#)).await;
        assert_eq!(
            discover(&server.address).await,
            Err(DiscoverFailure::InvalidResponse {
                message: "unsupported discovery version 2 (supported: 1)".into()
            })
        );
    }

    #[test]
    fn failures_serialize_with_a_kind() {
        assert_eq!(
            serde_json::to_value(DiscoverFailure::InvalidResponse {
                message: "m".into()
            })
            .unwrap(),
            serde_json::json!({ "kind": "invalidResponse", "message": "m" })
        );
        assert_eq!(
            serde_json::to_value(RouteConfigError::InvalidFile {
                message: "m".into()
            })
            .unwrap(),
            serde_json::json!({ "kind": "invalidFile", "message": "m" })
        );
    }

    #[tokio::test]
    async fn connecting_an_environment_replaces_its_siblings_only() {
        let dir = scratch("siblings");
        let own = route_file(&dir, "own.json", &[4000]);
        let dev = route_file(&dir, "dev.json", &[4001]);
        let staging = route_file(&dir, "staging.json", &[4002]);
        let last = route_file(&dir, "last.json", &[4003]);
        configure(&dir, &[&own, &dev, &last]);

        let siblings = [dev.clone(), staging.clone()];
        let (update, cfg) = connect(&dir, &staging, &siblings).await.unwrap();

        let expected = vec![own.clone(), last.clone(), staging.clone()];
        assert_eq!(update.files, expected);
        assert_eq!(update.name, "staging.json");
        assert_eq!(update.reset, vec![dev.clone(), staging.clone()]);
        assert_eq!(cfg.routes.files, expected);
        let saved = config::load(&dir).unwrap();
        assert_eq!(saved, cfg);
        assert_eq!(saved.theme, "carbon");
        assert_eq!(saved.metro.port, 9100);
        assert_eq!(saved.apks.list_url, "https://example.com/list");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn connecting_a_file_appends_it_once() {
        let dir = scratch("once");
        let a = route_file(&dir, "a.json", &[4000]);
        let b = route_file(&dir, "b.json", &[4001]);
        configure(&dir, &[&a]);

        connect(&dir, &b, &[]).await.unwrap();
        let before = raw_config(&dir);
        let (update, _) = connect(&dir, &b, &[]).await.unwrap();

        assert_eq!(update.files, vec![a.clone(), b.clone()]);
        assert!(update.reset.is_empty());
        assert_eq!(raw_config(&dir), before);

        let (kept, _) = connect(&dir, &a, &[a.clone(), b.clone()]).await.unwrap();
        assert_eq!(kept.files, vec![a]);
        assert_eq!(kept.reset, vec![b]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn an_invalid_file_changes_nothing() {
        let dir = scratch("invalid");
        let a = route_file(&dir, "a.json", &[4000]);
        let bad = dir.join("bad.json").display().to_string();
        std::fs::write(&bad, r#"{"version":2}"#).unwrap();
        configure(&dir, &[&a]);
        let before = raw_config(&dir);

        let result = connect(&dir, &bad, std::slice::from_ref(&a)).await;

        assert_eq!(
            result.unwrap_err(),
            RouteConfigError::InvalidFile {
                message: "unsupported route file version 2 (supported: 1)".into()
            }
        );
        assert_eq!(raw_config(&dir), before);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn an_unreadable_config_is_never_overwritten() {
        let dir = scratch("broken-config");
        let a = route_file(&dir, "a.json", &[4000]);
        let broken = "theme = \"carbon\"\n[routes\n";
        std::fs::write(config::config_path(&dir), broken).unwrap();

        let connected = connect(&dir, &a, &[]).await.unwrap_err();
        let removed = remove(&dir, &a).unwrap_err();

        for error in [connected, removed] {
            assert!(
                matches!(&error, RouteConfigError::Config { message } if message.starts_with("parse error")),
                "{error:?}"
            );
        }
        assert_eq!(raw_config(&dir), broken);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn connecting_creates_a_missing_config() {
        let dir = scratch("new-config");
        let a = route_file(&dir, "a.json", &[4000]);
        let app = dir.join("app");
        connect(&app, &a, &[]).await.unwrap();
        assert_eq!(config::load(&app).unwrap().routes.files, vec![a]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn removing_drops_one_path_and_keeps_the_rest() {
        let dir = scratch("remove");
        let (a, b, c) = (
            "/a.json".to_string(),
            "/b.json".to_string(),
            "/c.json".to_string(),
        );
        configure(&dir, &[&a, &b, &c]);

        let (update, _) = remove(&dir, &b).unwrap();

        assert_eq!(update.files, vec![a.clone(), c.clone()]);
        assert_eq!(update.reset, vec![b]);
        let saved = config::load(&dir).unwrap();
        assert_eq!(saved.routes.files, vec![a.clone(), c.clone()]);
        assert_eq!(saved.theme, "carbon");

        let before = raw_config(&dir);
        let (unchanged, _) = remove(&dir, "/gone.json").unwrap();
        assert!(unchanged.reset.is_empty());
        assert_eq!(raw_config(&dir), before);
        std::fs::remove_dir_all(&dir).ok();
    }
}
