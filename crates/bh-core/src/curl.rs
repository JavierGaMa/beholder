use crate::types::HttpExchange;

fn sq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub fn to_curl(ex: &HttpExchange) -> String {
    let mut lines = Vec::new();
    lines.push(format!(
        "curl -X {} {}",
        ex.request.method,
        sq(&ex.request.url)
    ));
    for h in &ex.request.headers {
        let lower = h.name.to_ascii_lowercase();
        if lower == "host" || lower == "content-length" || lower == "connection" {
            continue;
        }
        lines.push(format!("  -H {}", sq(&format!("{}: {}", h.name, h.value))));
    }
    if let Some(b) = &ex.request.body {
        if !b.is_binary {
            lines.push(format!("  --data-raw {}", sq(&b.text)));
        }
    }
    lines.join(" \\\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BodyCapture, Header, HttpRequest, Timing};

    fn exchange(
        method: &str,
        url: &str,
        headers: Vec<Header>,
        body: Option<BodyCapture>,
    ) -> HttpExchange {
        HttpExchange {
            id: 1,
            request: HttpRequest {
                method: method.into(),
                url: url.into(),
                host: "api.test.dev".into(),
                path: "/v1/x".into(),
                headers,
                body,
                started_at: 0.0,
            },
            response: None,
            error: None,
            timing: Timing::default(),
            protocol: "http/1.1".into(),
        }
    }

    #[test]
    fn get_with_headers() {
        let ex = exchange(
            "GET",
            "https://api.test.dev/v1/x?a=1",
            vec![Header {
                name: "Authorization".into(),
                value: "Bearer tok".into(),
            }],
            None,
        );
        let out = to_curl(&ex);
        assert_eq!(
            out,
            "curl -X GET 'https://api.test.dev/v1/x?a=1' \\\n  -H 'Authorization: Bearer tok'"
        );
    }

    #[test]
    fn post_json_body() {
        let body = BodyCapture::from_bytes(b"{\"a\":1}", Some("application/json".into()), 100);
        let ex = exchange("POST", "https://api.test.dev/v1/x", vec![], Some(body));
        assert!(to_curl(&ex).contains("--data-raw '{\"a\":1}'"));
    }

    #[test]
    fn single_quote_escaping() {
        let body = BodyCapture::from_bytes(b"it's", None, 100);
        let ex = exchange("POST", "https://api.test.dev/x", vec![], Some(body));
        assert!(to_curl(&ex).contains("'it'\\''s'"));
    }

    #[test]
    fn skips_hop_by_hop_headers() {
        let ex = exchange(
            "GET",
            "https://api.test.dev/",
            vec![
                Header {
                    name: "Host".into(),
                    value: "api.test.dev".into(),
                },
                Header {
                    name: "Content-Length".into(),
                    value: "4".into(),
                },
                Header {
                    name: "X-Custom".into(),
                    value: "v".into(),
                },
            ],
            None,
        );
        let out = to_curl(&ex);
        assert!(!out.contains("Host"));
        assert!(!out.contains("Content-Length"));
        assert!(out.contains("X-Custom"));
    }
}
