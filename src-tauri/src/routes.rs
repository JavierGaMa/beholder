use bh_core::Route;
use bh_proxy::SharedRoutes;
use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;

const HEALTH_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Debug, Clone)]
pub struct LoadedFile {
    pub path: String,
    pub name: String,
    pub error: Option<String>,
    pub routes: Vec<Route>,
}

#[derive(Debug, Clone, Default)]
pub struct RouteCatalog {
    pub sources: Vec<String>,
    pub files: Vec<LoadedFile>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RouteStatus {
    pub key: String,
    pub id: String,
    pub path_prefix: String,
    pub host: Option<String>,
    pub target: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RouteFileStatus {
    pub path: String,
    pub name: String,
    pub error: Option<String>,
    pub routes: Vec<RouteStatus>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Health {
    Up,
    Down,
}

pub async fn refresh(
    table: &SharedRoutes,
    catalog: &mut Option<RouteCatalog>,
    paths: &[String],
    force: bool,
) {
    if !force && catalog.as_ref().is_some_and(|c| c.sources == paths) {
        return;
    }
    let mut files: Vec<LoadedFile> = Vec::new();
    for path in paths {
        if files.iter().all(|f| &f.path != path) {
            files.push(load_file(path).await);
        }
    }
    table.write().unwrap_or_else(|e| e.into_inner()).routes =
        files.iter().flat_map(|f| f.routes.clone()).collect();
    *catalog = Some(RouteCatalog {
        sources: paths.to_vec(),
        files,
    });
}

pub async fn load_file(path: &str) -> LoadedFile {
    let parsed = match tokio::fs::read_to_string(path).await {
        Ok(text) => bh_core::parse_route_file(&text).map_err(|e| e.to_string()),
        Err(e) => Err(format!("cannot read route file: {e}")),
    };
    match parsed {
        Ok(file) => LoadedFile {
            path: path.to_string(),
            name: file.name,
            error: None,
            routes: file
                .routes
                .into_iter()
                .map(|mut route| {
                    route.key = format!("{path}::{}", route.id);
                    route
                })
                .collect(),
        },
        Err(error) => LoadedFile {
            path: path.to_string(),
            name: std::path::Path::new(path)
                .file_name()
                .map_or_else(|| path.to_string(), |n| n.to_string_lossy().into_owned()),
            error: Some(error),
            routes: Vec::new(),
        },
    }
}

pub fn snapshot(table: &SharedRoutes, catalog: &Option<RouteCatalog>) -> Vec<RouteFileStatus> {
    let active = table.read().unwrap_or_else(|e| e.into_inner());
    catalog
        .iter()
        .flat_map(|c| &c.files)
        .map(|file| RouteFileStatus {
            path: file.path.clone(),
            name: file.name.clone(),
            error: file.error.clone(),
            routes: file
                .routes
                .iter()
                .map(|route| RouteStatus {
                    key: route.key.clone(),
                    id: route.id.clone(),
                    path_prefix: route.matcher.path_prefix.clone(),
                    host: route.matcher.host.clone(),
                    target: route.target.clone(),
                    enabled: active.enabled.contains(&route.key),
                })
                .collect(),
        })
        .collect()
}

pub fn set_enabled(table: &SharedRoutes, key: String, enabled: bool) {
    let mut active = table.write().unwrap_or_else(|e| e.into_inner());
    if enabled {
        active.enabled.insert(key);
    } else {
        active.enabled.remove(&key);
    }
}

pub fn set_all_enabled(table: &SharedRoutes, enabled: bool) {
    let mut active = table.write().unwrap_or_else(|e| e.into_inner());
    active.enabled = if enabled {
        active.routes.iter().map(|r| r.key.clone()).collect()
    } else {
        Default::default()
    };
}

pub async fn apply(
    table: &SharedRoutes,
    catalog: &mut Option<RouteCatalog>,
    paths: &[String],
    reset: &[String],
) {
    let prefixes: Vec<String> = reset.iter().map(|path| format!("{path}::")).collect();
    table
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .enabled
        .retain(|key| !prefixes.iter().any(|prefix| key.starts_with(prefix)));
    refresh(table, catalog, paths, true).await;
}

pub async fn health(table: &SharedRoutes) -> BTreeMap<String, Health> {
    let routes = table
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .routes
        .clone();
    probe_all(&routes).await
}

pub async fn probe_all(routes: &[Route]) -> BTreeMap<String, Health> {
    let targets: Vec<(String, String)> = routes
        .iter()
        .map(|r| (r.key.clone(), r.target.clone()))
        .collect();
    let mut probes = tokio::task::JoinSet::new();
    for (key, target) in targets {
        probes.spawn(async move { (key, probe(&target).await) });
    }
    let mut report = BTreeMap::new();
    while let Some(done) = probes.join_next().await {
        if let Ok((key, health)) = done {
            report.insert(key, health);
        }
    }
    report
}

async fn probe(target: &str) -> Health {
    let Some((host, port)) = bh_core::parse_target(target) else {
        return Health::Down;
    };
    match tokio::time::timeout(HEALTH_TIMEOUT, tokio::net::TcpStream::connect((host, port))).await {
        Ok(Ok(_)) => Health::Up,
        _ => Health::Down,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bh-routes-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &std::path::Path, name: &str, content: &str) -> String {
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path.display().to_string()
    }

    fn file(name: &str, routes: &[(&str, u16)]) -> String {
        let routes: Vec<_> = routes
            .iter()
            .map(|(id, port)| {
                serde_json::json!({
                    "id": id,
                    "match": { "pathPrefix": format!("/v1/{id}") },
                    "target": format!("http://127.0.0.1:{port}")
                })
            })
            .collect();
        serde_json::json!({ "version": 1, "name": name, "routes": routes }).to_string()
    }

    fn enabled(table: &SharedRoutes) -> Vec<String> {
        let mut keys: Vec<_> = table.read().unwrap().enabled.iter().cloned().collect();
        keys.sort();
        keys
    }

    #[tokio::test]
    async fn loads_files_with_every_route_disabled_and_keyed_by_path() {
        let dir = scratch("load");
        let a = write(&dir, "a.json", &file("local stack", &[("orders", 4000)]));
        let b = write(&dir, "b.json", &file("second stack", &[("orders", 4001)]));
        let table = SharedRoutes::default();
        let mut catalog = None;
        refresh(&table, &mut catalog, &[a.clone(), b.clone()], true).await;

        let files = snapshot(&table, &catalog);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, a);
        assert_eq!(files[0].name, "local stack");
        assert_eq!(files[0].error, None);
        assert_eq!(
            files[0].routes,
            vec![RouteStatus {
                key: format!("{a}::orders"),
                id: "orders".into(),
                path_prefix: "/v1/orders".into(),
                host: None,
                target: "http://127.0.0.1:4000".into(),
                enabled: false,
            }]
        );
        assert_eq!(files[1].routes[0].key, format!("{b}::orders"));
        assert_eq!(table.read().unwrap().routes.len(), 2);
        assert!(enabled(&table).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn broken_files_are_listed_with_their_error_and_contribute_nothing() {
        let dir = scratch("broken");
        let good = write(&dir, "good.json", &file("local stack", &[("orders", 4000)]));
        let bad = write(&dir, "bad.json", "{ nope");
        let future = write(&dir, "future.json", r#"{"version":2}"#);
        let missing = dir.join("missing.json").display().to_string();
        let table = SharedRoutes::default();
        let mut catalog = None;
        let paths = [bad, future, missing, good];
        refresh(&table, &mut catalog, &paths, true).await;

        let files = snapshot(&table, &catalog);
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].name, "bad.json");
        assert!(files[0]
            .error
            .as_ref()
            .unwrap()
            .starts_with("invalid route file"));
        assert_eq!(
            files[1].error.as_deref(),
            Some("unsupported route file version 2 (supported: 1)")
        );
        assert!(files[2]
            .error
            .as_ref()
            .unwrap()
            .starts_with("cannot read route file"));
        assert!(files[..3].iter().all(|f| f.routes.is_empty()));
        assert_eq!(files[3].routes.len(), 1);
        assert_eq!(table.read().unwrap().routes.len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn rereads_only_when_forced_or_when_the_file_list_changes() {
        let dir = scratch("refresh");
        let a = write(&dir, "a.json", &file("first", &[("orders", 4000)]));
        let table = SharedRoutes::default();
        let mut catalog = None;
        refresh(&table, &mut catalog, std::slice::from_ref(&a), false).await;
        assert_eq!(snapshot(&table, &catalog)[0].name, "first");

        write(&dir, "a.json", &file("second", &[("orders", 4000)]));
        refresh(&table, &mut catalog, std::slice::from_ref(&a), false).await;
        assert_eq!(snapshot(&table, &catalog)[0].name, "first");
        refresh(&table, &mut catalog, std::slice::from_ref(&a), true).await;
        assert_eq!(snapshot(&table, &catalog)[0].name, "second");

        refresh(&table, &mut catalog, &[], false).await;
        assert!(snapshot(&table, &catalog).is_empty());
        assert!(table.read().unwrap().routes.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn repeated_paths_load_once() {
        let dir = scratch("repeat");
        let a = write(&dir, "a.json", &file("first", &[("orders", 4000)]));
        let table = SharedRoutes::default();
        let mut catalog = None;
        refresh(&table, &mut catalog, &[a.clone(), a], false).await;
        assert_eq!(snapshot(&table, &catalog).len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn toggles_survive_a_reload() {
        let dir = scratch("toggle");
        let a = write(
            &dir,
            "a.json",
            &file("s", &[("orders", 4000), ("catalog", 4001)]),
        );
        let table = SharedRoutes::default();
        let mut catalog = None;
        set_enabled(&table, format!("{a}::orders"), true);
        refresh(&table, &mut catalog, std::slice::from_ref(&a), true).await;
        let flags = |catalog: &Option<RouteCatalog>, table: &SharedRoutes| -> Vec<bool> {
            snapshot(table, catalog)[0]
                .routes
                .iter()
                .map(|r| r.enabled)
                .collect()
        };
        assert_eq!(flags(&catalog, &table), [true, false]);

        set_all_enabled(&table, true);
        assert_eq!(flags(&catalog, &table), [true, true]);
        set_enabled(&table, format!("{a}::orders"), false);
        assert_eq!(flags(&catalog, &table), [false, true]);
        refresh(&table, &mut catalog, std::slice::from_ref(&a), true).await;
        assert_eq!(flags(&catalog, &table), [false, true]);
        set_all_enabled(&table, false);
        assert!(enabled(&table).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn health_reports_whether_each_target_accepts_connections() {
        let dir = scratch("health");
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let up = listener.local_addr().unwrap().port();
        let down = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let a = write(
            &dir,
            "a.json",
            &file("s", &[("orders", up), ("catalog", down)]),
        );
        let table = SharedRoutes::default();
        let mut catalog = None;
        refresh(&table, &mut catalog, std::slice::from_ref(&a), true).await;

        let report = health(&table).await;
        assert_eq!(report.get(&format!("{a}::orders")), Some(&Health::Up));
        assert_eq!(report.get(&format!("{a}::catalog")), Some(&Health::Down));
        assert_eq!(serde_json::to_string(&Health::Up).unwrap(), r#""up""#);
        assert_eq!(serde_json::to_string(&Health::Down).unwrap(), r#""down""#);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn applying_a_new_file_list_disables_the_routes_of_reset_files() {
        let dir = scratch("apply");
        let a = write(&dir, "a.json", &file("a", &[("orders", 4000)]));
        let b = write(&dir, "b.json", &file("b", &[("orders", 4001)]));
        let c = write(&dir, "c.json", &file("c", &[("orders", 4002)]));
        let table = SharedRoutes::default();
        let mut catalog = None;
        refresh(&table, &mut catalog, &[a.clone(), b.clone()], true).await;
        set_enabled(&table, format!("{a}::orders"), true);
        set_enabled(&table, format!("{b}::orders"), true);
        set_enabled(&table, format!("{c}::orders"), true);

        let paths = [a.clone(), c.clone()];
        apply(&table, &mut catalog, &paths, &[b, c]).await;

        assert_eq!(enabled(&table), [format!("{a}::orders")]);
        let files = snapshot(&table, &catalog);
        assert_eq!(files.len(), 2);
        assert_eq!(files[1].name, "c");
        assert_eq!(table.read().unwrap().routes.len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }
}
