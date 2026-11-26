use crate::routes::parse_target;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use thiserror::Error;

pub const DISCOVERY_VERSION: u64 = 1;
pub const DISCOVERY_PATH: &str = "/.well-known/beholder-routes";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Discovery {
    pub version: u32,
    pub name: String,
    pub files: Vec<DiscoveryFile>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiscoveryFile {
    pub id: String,
    pub label: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DiscoveryError {
    #[error("invalid discovery document: {0}")]
    Parse(String),
    #[error("unsupported discovery version {0} (supported: 1)")]
    UnsupportedVersion(String),
    #[error("discovery document lists no files")]
    NoFiles,
    #[error("duplicate file id `{0}`")]
    DuplicateId(String),
    #[error("file `{id}`: path `{path}` must be an absolute path to a .json file")]
    InvalidPath { id: String, path: String },
}

pub fn discovery_base(address: &str) -> Option<String> {
    let (host, port) = parse_target(address)?;
    Some(format!("http://{host}:{port}"))
}

pub fn parse_discovery(text: &str) -> Result<Discovery, DiscoveryError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| DiscoveryError::Parse(e.to_string()))?;
    if let Some(serde_json::Value::Number(version)) = value.get("version") {
        if version.as_u64() != Some(DISCOVERY_VERSION) {
            return Err(DiscoveryError::UnsupportedVersion(version.to_string()));
        }
    }
    if !value.is_object() {
        return Err(DiscoveryError::Parse("expected a JSON object".into()));
    }
    let discovery: Discovery =
        serde_json::from_value(value).map_err(|e| DiscoveryError::Parse(e.to_string()))?;
    if discovery.files.is_empty() {
        return Err(DiscoveryError::NoFiles);
    }
    let mut seen = HashSet::new();
    for file in &discovery.files {
        if !seen.insert(file.id.as_str()) {
            return Err(DiscoveryError::DuplicateId(file.id.clone()));
        }
        if !Path::new(&file.path).is_absolute() || !file.path.ends_with(".json") {
            return Err(DiscoveryError::InvalidPath {
                id: file.id.clone(),
                path: file.path.clone(),
            });
        }
    }
    Ok(discovery)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn file(id: &str, path: &str) -> serde_json::Value {
        json!({ "id": id, "label": id.to_uppercase(), "path": path })
    }

    fn document(files: Vec<serde_json::Value>) -> String {
        json!({ "version": 1, "name": "local stack", "files": files }).to_string()
    }

    #[test]
    fn normalizes_local_addresses() {
        for (address, base) in [
            ("http://localhost:8090", "http://localhost:8090"),
            ("http://localhost:8090/", "http://localhost:8090"),
            ("http://127.0.0.1:1", "http://127.0.0.1:1"),
        ] {
            assert_eq!(discovery_base(address).as_deref(), Some(base), "{address}");
        }
    }

    #[test]
    fn rejects_every_other_address() {
        for address in [
            "",
            "localhost:8090",
            "https://localhost:8090",
            "http://localhost",
            "http://localhost:0",
            "http://localhost:70000",
            "http://localhost:8090//",
            "http://localhost:8090/base",
            "http://localhost:8090?x=1",
            "http://localhost:8090#x",
            "http://user@localhost:8090",
            "http://127.0.0.1:80@example.com:80",
            "http://localhost.example.com:80",
            "http://example.com:80",
            "http://10.0.2.2:80",
            "http://0.0.0.0:80",
            "http://[::1]:80",
            " http://localhost:8090",
        ] {
            assert_eq!(discovery_base(address), None, "{address}");
        }
    }

    #[test]
    fn parses_every_field_and_keeps_the_hint_optional() {
        let text = document(vec![
            json!({ "id": "dev", "label": "Dev", "path": "/abs/path/routes-dev.json", "hint": "make dev" }),
            file("staging", "/abs/path/routes-staging.json"),
        ]);
        let discovery = parse_discovery(&text).unwrap();
        assert_eq!(discovery.version, 1);
        assert_eq!(discovery.name, "local stack");
        assert_eq!(
            discovery.files[0],
            DiscoveryFile {
                id: "dev".into(),
                label: "Dev".into(),
                path: "/abs/path/routes-dev.json".into(),
                hint: Some("make dev".into()),
            }
        );
        assert_eq!(discovery.files[1].hint, None);
    }

    #[test]
    fn rejects_other_versions_with_exact_message() {
        for version in [0, 2, 7] {
            let text = json!({ "version": version, "shape": "unknown" }).to_string();
            assert_eq!(
                parse_discovery(&text).unwrap_err().to_string(),
                format!("unsupported discovery version {version} (supported: 1)")
            );
        }
    }

    #[test]
    fn rejects_malformed_documents() {
        for text in [
            "{ nope",
            "[]",
            r#"{"name":"x","files":[]}"#,
            r#"{"version":"1","name":"x","files":[]}"#,
            r#"{"version":1,"files":[]}"#,
            r#"{"version":1,"name":"x"}"#,
            r#"{"version":1,"name":"x","files":[{"id":"a","path":"/a.json"}]}"#,
        ] {
            assert!(
                matches!(parse_discovery(text), Err(DiscoveryError::Parse(_))),
                "{text}"
            );
        }
    }

    #[test]
    fn rejects_an_empty_file_list() {
        assert_eq!(
            parse_discovery(&document(vec![])),
            Err(DiscoveryError::NoFiles)
        );
    }

    #[test]
    fn rejects_duplicate_ids() {
        let text = document(vec![file("dev", "/a.json"), file("dev", "/b.json")]);
        assert_eq!(
            parse_discovery(&text),
            Err(DiscoveryError::DuplicateId("dev".into()))
        );
    }

    #[test]
    fn rejects_paths_that_are_not_absolute_json_files() {
        for path in [
            "",
            "routes.json",
            "./routes.json",
            "~/routes.json",
            "/abs/path/routes.toml",
            "/abs/path/routes",
            "/abs/path/routes.json/",
        ] {
            assert_eq!(
                parse_discovery(&document(vec![file("dev", path)])),
                Err(DiscoveryError::InvalidPath {
                    id: "dev".into(),
                    path: path.into()
                }),
                "{path}"
            );
        }
    }
}
