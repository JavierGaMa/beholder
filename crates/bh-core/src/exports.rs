use crate::types::{Header, HttpExchange};
use serde::Serialize;

fn usable_headers(headers: &[Header]) -> Vec<&Header> {
    headers
        .iter()
        .filter(|h| {
            let lower = h.name.to_ascii_lowercase();
            lower != "host" && lower != "content-length" && lower != "connection"
        })
        .collect()
}

pub fn slugify(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

fn body_mode(mime: Option<&String>, text: &str) -> &'static str {
    let looks_json = mime.map(|m| m.contains("json")).unwrap_or(false)
        || text.trim_start().starts_with('{')
        || text.trim_start().starts_with('[');
    if looks_json {
        "json"
    } else {
        "text"
    }
}

fn escape_bruo_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\n', "\\n")
}

pub struct BrunoFile {
    pub path: String,
    pub content: String,
}

pub fn build_bruno_collection(exchanges: &[HttpExchange], name: &str) -> Vec<BrunoFile> {
    let mut files = vec![BrunoFile {
        path: "collection.bru".into(),
        content: format!(
            "meta {{\n  name: {}\n  version: 1.0\n}}\n",
            escape_bruo_value(name)
        ),
    }];

    let mut used_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    for ex in exchanges.iter().filter(|e| e.response.is_some()) {
        let req = &ex.request;
        let host = req.host.clone();
        if host.is_empty() {
            continue;
        }
        let base = format!("{}-{}", req.method.to_lowercase(), slugify(&req.path));
        let mut file_name = if base.is_empty() {
            "request".to_string()
        } else {
            base.chars().take(60).collect()
        };
        let mut counter = 2;
        while !used_names.insert(format!("{}/{}", host, file_name)) {
            file_name = format!("{}-{}", base.chars().take(56).collect::<String>(), counter);
            counter += 1;
        }
        let file_name = if file_name.is_empty() {
            "request".to_string()
        } else {
            file_name
        };

        let mut content = format!(
            "meta {{\n  name: {}\n  method: {}\n  url: {}\n}}\n\n",
            escape_bruo_value(&file_name),
            req.method,
            escape_bruo_value(&req.url)
        );

        let headers = usable_headers(&req.headers);
        if !headers.is_empty() {
            content.push_str("headers {\n");
            for h in headers {
                content.push_str(&format!(
                    "  {}: {}\n",
                    escape_bruo_value(&h.name),
                    escape_bruo_value(&h.value)
                ));
            }
            content.push_str("}\n\n");
        }

        if let Some(body) = &req.body {
            if !body.is_binary && !body.text.trim().is_empty() {
                let mode = body_mode(body.mime.as_ref(), &body.text);
                content.push_str(&format!(
                    "body:{} {{\n  {}\n}}\n",
                    mode,
                    escape_bruo_value(&body.text)
                ));
            }
        }

        files.push(BrunoFile {
            path: format!("{}/{}.bru", host, file_name),
            content,
        });
    }
    files
}

#[derive(Serialize)]
pub struct PostmanUrl {
    pub raw: String,
}

#[derive(Serialize)]
pub struct PostmanHeader {
    pub key: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct PostmanBody {
    pub mode: String,
    pub raw: String,
}

#[derive(Serialize)]
pub struct PostmanRequest {
    pub method: String,
    pub header: Vec<PostmanHeader>,
    pub url: PostmanUrl,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<PostmanBody>,
}

#[derive(Serialize)]
pub struct PostmanItem {
    pub name: String,
    pub request: PostmanRequest,
}

#[derive(Serialize)]
pub struct PostmanInfo {
    pub name: String,
    #[serde(rename = "_postman_id")]
    pub postman_id: String,
    #[serde(rename = "schema")]
    pub schema: String,
}

#[derive(Serialize)]
pub struct PostmanCollection {
    pub info: PostmanInfo,
    pub item: Vec<PostmanItem>,
}

pub fn build_postman_collection(exchanges: &[HttpExchange], name: &str) -> PostmanCollection {
    let items = exchanges
        .iter()
        .filter(|e| e.response.is_some())
        .map(|ex| {
            let req = &ex.request;
            PostmanItem {
                name: format!("{} {}{}", req.method, req.host, req.path),
                request: PostmanRequest {
                    method: req.method.clone(),
                    header: usable_headers(&req.headers)
                        .into_iter()
                        .map(|h| PostmanHeader {
                            key: h.name.clone(),
                            value: h.value.clone(),
                        })
                        .collect(),
                    url: PostmanUrl {
                        raw: req.url.clone(),
                    },
                    body: req.body.as_ref().and_then(|b| {
                        if b.is_binary || b.text.trim().is_empty() {
                            None
                        } else {
                            Some(PostmanBody {
                                mode: body_mode(b.mime.as_ref(), &b.text).to_string(),
                                raw: b.text.clone(),
                            })
                        }
                    }),
                },
            }
        })
        .collect();
    PostmanCollection {
        info: PostmanInfo {
            name: name.to_string(),
            postman_id: format!("beholder-{}", exchanges.iter().map(|e| e.id).sum::<u64>()),
            schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json".into(),
        },
        item: items,
    }
}

pub fn postman_collection_to_string(exchanges: &[HttpExchange], name: &str) -> String {
    serde_json::to_string_pretty(&build_postman_collection(exchanges, name)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BodyCapture, HttpRequest, HttpResponse, Timing};

    fn sample(
        id: u64,
        method: &str,
        url: &str,
        path: &str,
        body: Option<BodyCapture>,
    ) -> HttpExchange {
        let host = url.split('/').next().unwrap_or("h.dev").to_string();
        HttpExchange {
            id,
            request: HttpRequest {
                method: method.into(),
                url: format!("https://{}", url),
                host,
                path: path.into(),
                headers: vec![
                    Header {
                        name: "Host".into(),
                        value: "ignored".into(),
                    },
                    Header {
                        name: "Authorization".into(),
                        value: "Bearer t".into(),
                    },
                ],
                body,
                started_at: 0.0,
            },
            response: Some(HttpResponse {
                status: 200,
                headers: vec![],
                body: None,
                ended_at: 1.0,
            }),
            error: None,
            timing: Timing::default(),
            protocol: "HTTP/1.1".into(),
        }
    }

    #[test]
    fn bruno_deterministic_paths_per_domain() {
        let body = BodyCapture::from_bytes(b"{\"a\":1}", Some("application/json".into()), 100);
        let exchanges = vec![
            sample(1, "GET", "api.dev/v1/users", "/v1/users", None),
            sample(2, "GET", "api.dev/v1/users", "/v1/users", None),
            sample(3, "POST", "api.dev/v1/session", "/v1/session", Some(body)),
        ];
        let files = build_bruno_collection(&exchanges, "Capture");
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"collection.bru"));
        assert!(paths.contains(&"api.dev/get-v1-users.bru"));
        assert!(paths.contains(&"api.dev/get-v1-users-2.bru"));
        assert!(paths.contains(&"api.dev/post-v1-session.bru"));
        let post = files
            .iter()
            .find(|f| f.path == "api.dev/post-v1-session.bru")
            .unwrap();
        assert!(post.content.contains("method: POST"));
        assert!(post.content.contains("body:json"));
        assert!(post.content.contains("Authorization: Bearer t"));
        assert!(!post.content.contains("Host"));
    }

    #[test]
    fn bruno_escapes_and_skips_hop_headers() {
        let files = build_bruno_collection(&[sample(1, "GET", "a.dev/x", "/x", None)], "n");
        let f = &files[1];
        assert!(!f.content.contains("Host:"));
        assert!(!f.content.contains("Content-Length"));
    }

    #[test]
    fn postman_v21_structure() {
        let body = BodyCapture::from_bytes(b"{\"a\":1}", Some("application/json".into()), 100);
        let exchanges = vec![sample(1, "POST", "api.dev/login", "/login", Some(body))];
        let json = postman_collection_to_string(&exchanges, "Beholder export");
        assert!(json.contains(
            "\"schema\": \"https://schema.getpostman.com/json/collection/v2.1.0/collection.json\""
        ));
        assert!(json.contains("\"name\": \"POST api.dev/login\""));
        assert!(json.contains("\"mode\": \"json\""));
        assert!(!json.contains("\"Host\""));
    }
}
