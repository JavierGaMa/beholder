use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use thiserror::Error;

pub const ROUTE_FILE_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RouteFile {
    pub version: u32,
    pub name: String,
    pub routes: Vec<Route>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    #[serde(skip)]
    pub key: String,
    pub id: String,
    #[serde(rename = "match")]
    pub matcher: RouteMatch,
    pub target: String,
    #[serde(default = "strip_prefix_default")]
    pub strip_prefix: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteMatch {
    pub path_prefix: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub route_id: String,
    pub target: String,
    pub path_and_query: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RouteError {
    #[error("invalid route file: {0}")]
    Parse(String),
    #[error("unsupported route file version {0} (supported: 1)")]
    UnsupportedVersion(String),
    #[error("duplicate route id `{0}`")]
    DuplicateId(String),
    #[error("route `{id}`: pathPrefix `{prefix}` must start with /")]
    InvalidPathPrefix { id: String, prefix: String },
    #[error("route `{id}`: target `{target}` must be http://127.0.0.1:<port> or http://localhost:<port>")]
    InvalidTarget { id: String, target: String },
}

fn strip_prefix_default() -> bool {
    true
}

pub fn parse_target(target: &str) -> Option<(&str, u16)> {
    let rest = target.strip_prefix("http://")?;
    let authority = rest.strip_suffix('/').unwrap_or(rest);
    let (host, port) = authority.split_once(':')?;
    if host != "127.0.0.1" && host != "localhost" {
        return None;
    }
    if !port.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let port = port.parse::<u16>().ok().filter(|p| *p != 0)?;
    Some((host, port))
}

pub fn parse_route_file(text: &str) -> Result<RouteFile, RouteError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| RouteError::Parse(e.to_string()))?;
    if let Some(serde_json::Value::Number(version)) = value.get("version") {
        if version.as_u64() != Some(ROUTE_FILE_VERSION) {
            return Err(RouteError::UnsupportedVersion(version.to_string()));
        }
    }
    let mut file: RouteFile =
        serde_json::from_value(value).map_err(|e| RouteError::Parse(e.to_string()))?;
    let mut seen = HashSet::new();
    for route in &mut file.routes {
        if !seen.insert(route.id.clone()) {
            return Err(RouteError::DuplicateId(route.id.clone()));
        }
        if !route.matcher.path_prefix.starts_with('/') {
            return Err(RouteError::InvalidPathPrefix {
                id: route.id.clone(),
                prefix: route.matcher.path_prefix.clone(),
            });
        }
        if parse_target(&route.target).is_none() {
            return Err(RouteError::InvalidTarget {
                id: route.id.clone(),
                target: route.target.clone(),
            });
        }
        route.key = route.id.clone();
    }
    Ok(file)
}

impl Route {
    fn matches(&self, host: &str, path_and_query: &str) -> bool {
        if let Some(expected) = &self.matcher.host {
            if !expected.eq_ignore_ascii_case(host) {
                return false;
            }
        }
        let prefix = &self.matcher.path_prefix;
        let Some(head) = path_and_query.get(..prefix.len()) else {
            return false;
        };
        let rest = &path_and_query[prefix.len()..];
        head.eq_ignore_ascii_case(prefix)
            && (prefix.ends_with('/')
                || rest.is_empty()
                || rest.starts_with('/')
                || rest.starts_with('?'))
    }

    fn rewrite(&self, path_and_query: &str) -> String {
        if !self.strip_prefix {
            return path_and_query.to_string();
        }
        let rest = &path_and_query[self.matcher.path_prefix.len()..];
        if rest.starts_with('/') {
            rest.to_string()
        } else {
            format!("/{rest}")
        }
    }
}

pub fn resolve(
    routes: &[Route],
    enabled: &HashSet<String>,
    host: &str,
    path_and_query: &str,
) -> Option<Resolved> {
    let route = routes
        .iter()
        .filter(|r| enabled.contains(&r.key) && r.matches(host, path_and_query))
        .reduce(|best, r| {
            if r.matcher.path_prefix.len() > best.matcher.path_prefix.len() {
                r
            } else {
                best
            }
        })?;
    let (target_host, port) = parse_target(&route.target)?;
    Some(Resolved {
        route_id: route.id.clone(),
        target: format!("http://{target_host}:{port}"),
        path_and_query: route.rewrite(path_and_query),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn route(id: &str, prefix: &str, port: u16) -> Route {
        Route {
            key: id.to_string(),
            id: id.to_string(),
            matcher: RouteMatch {
                path_prefix: prefix.to_string(),
                host: None,
            },
            target: format!("http://127.0.0.1:{port}"),
            strip_prefix: true,
            health: None,
        }
    }

    fn enabled(keys: &[&str]) -> HashSet<String> {
        keys.iter().map(|k| k.to_string()).collect()
    }

    fn rewritten(prefix: &str, path: &str) -> Option<String> {
        resolve(
            &[route("a", prefix, 4000)],
            &enabled(&["a"]),
            "api.example.com",
            path,
        )
        .map(|r| r.path_and_query)
    }

    fn file_with(route: serde_json::Value) -> String {
        json!({ "version": 1, "name": "local stack", "routes": [route] }).to_string()
    }

    fn with_target(target: &str) -> Result<RouteFile, RouteError> {
        parse_route_file(&file_with(json!({
            "id": "orders",
            "match": { "pathPrefix": "/v1/orders" },
            "target": target
        })))
    }

    #[test]
    fn parses_every_field() {
        let file = parse_route_file(&file_with(json!({
            "id": "orders",
            "match": { "pathPrefix": "/v1/orders", "host": "optional.example.com" },
            "target": "http://127.0.0.1:10100",
            "stripPrefix": false,
            "health": "/health"
        })))
        .unwrap();
        assert_eq!(file.version, 1);
        assert_eq!(file.name, "local stack");
        let route = &file.routes[0];
        assert_eq!(route.id, "orders");
        assert_eq!(route.key, "orders");
        assert_eq!(route.matcher.path_prefix, "/v1/orders");
        assert_eq!(route.matcher.host.as_deref(), Some("optional.example.com"));
        assert_eq!(route.target, "http://127.0.0.1:10100");
        assert!(!route.strip_prefix);
        assert_eq!(route.health.as_deref(), Some("/health"));
    }

    #[test]
    fn host_and_health_are_optional_and_strip_defaults_to_true() {
        let file = with_target("http://localhost:10100").unwrap();
        let route = &file.routes[0];
        assert_eq!(route.matcher.host, None);
        assert_eq!(route.health, None);
        assert!(route.strip_prefix);
    }

    #[test]
    fn rejects_other_versions_with_exact_message() {
        for version in [0, 2, 7] {
            let text = json!({ "version": version, "shape": "unknown" }).to_string();
            assert_eq!(
                parse_route_file(&text).unwrap_err().to_string(),
                format!("unsupported route file version {version} (supported: 1)")
            );
        }
    }

    #[test]
    fn rejects_malformed_files() {
        assert!(matches!(
            parse_route_file("{ nope"),
            Err(RouteError::Parse(m)) if m != "not implemented"
        ));
        assert!(matches!(
            parse_route_file(r#"{"name":"x","routes":[]}"#),
            Err(RouteError::Parse(m)) if m.contains("version")
        ));
    }

    #[test]
    fn accepts_only_local_http_targets_with_explicit_port() {
        for target in [
            "http://127.0.0.1:10100",
            "http://localhost:80",
            "http://localhost:10100/",
        ] {
            assert!(with_target(target).is_ok(), "{target}");
        }
        for target in [
            "https://127.0.0.1:10100",
            "http://127.0.0.1",
            "http://localhost",
            "http://127.0.0.1:",
            "http://127.0.0.1:0",
            "http://127.0.0.1:70000",
            "http://127.0.0.1:+80",
            "http://example.com:80",
            "http://10.0.2.2:80",
            "http://0.0.0.0:80",
            "http://[::1]:80",
            "http://localhost.example.com:80",
            "http://127.0.0.1:80@example.com:80",
            "http://user@127.0.0.1:80",
            "http://127.0.0.1:80/base",
            "http://127.0.0.1:80?x=1",
            "127.0.0.1:80",
            "ws://127.0.0.1:80",
        ] {
            assert!(
                matches!(with_target(target), Err(RouteError::InvalidTarget { .. })),
                "{target}"
            );
        }
    }

    #[test]
    fn rejects_prefix_without_leading_slash() {
        for prefix in ["", "v1/orders"] {
            let text = file_with(json!({
                "id": "orders",
                "match": { "pathPrefix": prefix },
                "target": "http://127.0.0.1:10100"
            }));
            assert!(matches!(
                parse_route_file(&text),
                Err(RouteError::InvalidPathPrefix { .. })
            ));
        }
    }

    #[test]
    fn rejects_duplicate_ids() {
        let one = json!({
            "id": "orders",
            "match": { "pathPrefix": "/v1/orders" },
            "target": "http://127.0.0.1:10100"
        });
        let text = json!({ "version": 1, "name": "x", "routes": [one, one] }).to_string();
        assert_eq!(
            parse_route_file(&text),
            Err(RouteError::DuplicateId("orders".into()))
        );
    }

    #[test]
    fn matches_only_at_a_segment_boundary() {
        assert!(rewritten("/v1/orders", "/v1/orders").is_some());
        assert!(rewritten("/v1/orders", "/v1/orders/api").is_some());
        assert!(rewritten("/v1/orders", "/v1/orders?x=1").is_some());
        assert_eq!(rewritten("/v1/orders", "/v1/ordersX"), None);
        assert_eq!(rewritten("/v1/orders", "/v1/order"), None);
        assert_eq!(rewritten("/v1/orders", "/other/v1/orders"), None);
        assert_eq!(rewritten("/v1/orders", "/v1/ord\u{e9}rs"), None);
        assert_eq!(rewritten("/v1/orders", "/v1/order\u{e9}"), None);
    }

    #[test]
    fn matches_prefix_case_insensitively() {
        assert_eq!(
            rewritten("/v1/Billing", "/V1/bILLING/api/Items").as_deref(),
            Some("/api/Items")
        );
    }

    #[test]
    fn strips_prefix_and_preserves_query() {
        assert_eq!(
            rewritten("/v1/orders", "/v1/orders/api/Items?x=1").as_deref(),
            Some("/api/Items?x=1")
        );
        assert_eq!(rewritten("/v1/orders", "/v1/orders").as_deref(), Some("/"));
        assert_eq!(rewritten("/v1/orders", "/v1/orders/").as_deref(), Some("/"));
        assert_eq!(
            rewritten("/v1/orders", "/v1/orders?x=1&y=%20").as_deref(),
            Some("/?x=1&y=%20")
        );
    }

    #[test]
    fn prefix_with_trailing_slash_is_its_own_boundary() {
        assert_eq!(
            rewritten("/v1/orders/", "/v1/orders/api").as_deref(),
            Some("/api")
        );
        assert_eq!(rewritten("/", "/api?x=1").as_deref(), Some("/api?x=1"));
        assert_eq!(rewritten("/v1/orders/", "/v1/orders"), None);
    }

    #[test]
    fn keeps_full_path_without_strip_prefix() {
        let mut r = route("a", "/v1/orders", 4000);
        r.strip_prefix = false;
        let resolved = resolve(&[r], &enabled(&["a"]), "h", "/v1/orders/api?x=1").unwrap();
        assert_eq!(resolved.path_and_query, "/v1/orders/api?x=1");
    }

    #[test]
    fn reports_route_id_and_normalized_target() {
        let mut r = route("orders", "/v1", 4000);
        r.key = "/routes.json::orders".into();
        r.target = "http://localhost:4000/".into();
        let resolved = resolve(&[r], &enabled(&["/routes.json::orders"]), "h", "/v1").unwrap();
        assert_eq!(resolved.route_id, "orders");
        assert_eq!(resolved.target, "http://localhost:4000");
    }

    #[test]
    fn ignores_disabled_routes() {
        let routes = [route("a", "/v1", 4000), route("b", "/v1/orders", 4001)];
        assert_eq!(resolve(&routes, &enabled(&[]), "h", "/v1/orders"), None);
        assert_eq!(
            resolve(&routes, &enabled(&["a"]), "h", "/v1/orders")
                .unwrap()
                .route_id,
            "a"
        );
    }

    #[test]
    fn host_match_is_exact_and_case_insensitive() {
        let mut r = route("a", "/v1", 4000);
        r.matcher.host = Some("API.example.com".into());
        let routes = [r];
        let on = enabled(&["a"]);
        assert!(resolve(&routes, &on, "api.Example.com", "/v1").is_some());
        assert_eq!(resolve(&routes, &on, "other.example.com", "/v1"), None);
        assert_eq!(resolve(&routes, &on, "www.api.example.com", "/v1"), None);
    }

    #[test]
    fn longest_prefix_wins_regardless_of_order() {
        let on = enabled(&["short", "long"]);
        let short = route("short", "/v1", 4000);
        let long = route("long", "/v1/orders", 4001);
        for routes in [[short.clone(), long.clone()], [long, short]] {
            assert_eq!(
                resolve(&routes, &on, "h", "/v1/orders/1").unwrap().route_id,
                "long"
            );
        }
    }

    #[test]
    fn first_route_wins_between_equal_prefixes() {
        let routes = [route("a", "/v1", 4000), route("b", "/V1", 4001)];
        let resolved = resolve(&routes, &enabled(&["a", "b"]), "h", "/v1").unwrap();
        assert_eq!(resolved.route_id, "a");
    }
}
