use serde::Serialize;

const LIST_URL: &str =
    "https://dlakecdnsfaprdeus201.blob.core.windows.net/contenidos?restype=container&comp=list&prefix=APKs/";
const MAX_PAGES: usize = 100;

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct ApkMeta {
    pub version: Option<String>,
    pub env: Option<String>,
    pub build: Option<u32>,
    pub flavor: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApkEntry {
    pub name: String,
    pub url: String,
    pub version: Option<String>,
    pub env: Option<String>,
    pub build: Option<u32>,
    pub flavor: Option<String>,
    pub date: Option<String>,
    pub size_bytes: u64,
    pub last_modified: String,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadProgress {
    name: String,
    received: u64,
    total: u64,
}

pub fn parse_apk_name(name: &str) -> ApkMeta {
    let mut meta = ApkMeta::default();
    let base = name.strip_suffix(".apk").unwrap_or(name);
    let tokens: Vec<&str> = base.split('-').collect();
    let Some(bi) = tokens.iter().position(|t| t.eq_ignore_ascii_case("build")) else {
        return meta;
    };
    if bi < 1 || bi + 1 >= tokens.len() {
        return meta;
    }
    let Some(build) = tokens[bi + 1].parse::<u32>().ok() else {
        return meta;
    };
    if tokens.len() > 1 && tokens[1].len() > 1 {
        meta.version = tokens[1].strip_prefix('v').map(|s| s.to_string());
    }
    if bi >= 2 {
        let env_tok = tokens[bi - 1];
        if env_tok.eq_ignore_ascii_case("qa") || env_tok.eq_ignore_ascii_case("prod") {
            meta.env = Some(env_tok.to_ascii_uppercase());
        }
    }
    meta.build = Some(build);
    let after = &tokens[bi + 2..];
    if let Some(ri) = after.iter().position(|t| t.eq_ignore_ascii_case("rn")) {
        if ri > 0 {
            meta.flavor = Some(after[..ri].join("-"));
        }
        if after.len() > ri + 2 && after[ri + 1].eq_ignore_ascii_case("from") {
            meta.date = Some(after[ri + 2..].join("-"));
        }
    }
    meta
}

struct BlobRaw {
    name: String,
    url: String,
    last_modified: String,
    content_length: u64,
}

fn xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml_unescape(&xml[start..end]))
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn parse_listing(xml: &str) -> Vec<BlobRaw> {
    let mut out = vec![];
    let mut rest = xml;
    while let Some(start) = rest.find("<Blob>") {
        let after = &rest[start + "<Blob>".len()..];
        let Some(end) = after.find("</Blob>") else {
            break;
        };
        let block = &after[..end];
        out.push(BlobRaw {
            name: xml_tag(block, "Name").unwrap_or_default(),
            url: xml_tag(block, "Url").unwrap_or_default(),
            last_modified: xml_tag(block, "Last-Modified").unwrap_or_default(),
            content_length: xml_tag(block, "Content-Length")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
        });
        rest = &after[end + "</Blob>".len()..];
    }
    out
}

fn rfc1123_key(s: &str) -> (i32, u32, u32, u32, u32, u32) {
    let rest = s.split_once(", ").map(|(_, r)| r).unwrap_or(s);
    let parts: Vec<&str> = rest.split_whitespace().collect();
    if parts.len() < 4 {
        return (0, 0, 0, 0, 0, 0);
    }
    let month = match parts[1] {
        "Jan" => 1,
        "Feb" => 2,
        "Mar" => 3,
        "Apr" => 4,
        "May" => 5,
        "Jun" => 6,
        "Jul" => 7,
        "Aug" => 8,
        "Sep" => 9,
        "Oct" => 10,
        "Nov" => 11,
        "Dec" => 12,
        _ => 0,
    };
    let time: Vec<u32> = parts[3].split(':').map(|p| p.parse().unwrap_or(0)).collect();
    let t = |i: usize| time.get(i).copied().unwrap_or(0);
    (
        parts[2].parse().unwrap_or(0),
        month,
        parts[0].parse().unwrap_or(0),
        t(0),
        t(1),
        t(2),
    )
}

pub async fn list_apks() -> Result<Vec<ApkEntry>, String> {
    let client = reqwest::Client::new();
    let mut raw = vec![];
    let mut marker: Option<String> = None;
    let mut prev_marker: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let mut url = reqwest::Url::parse(LIST_URL).map_err(|e| e.to_string())?;
        if let Some(m) = &marker {
            url.query_pairs_mut().append_pair("marker", m);
        }
        let body = client
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        raw.extend(parse_listing(&body));
        let next = xml_tag(&body, "NextMarker").filter(|s| !s.is_empty());
        if next.is_none() || next == prev_marker {
            break;
        }
        prev_marker.clone_from(&next);
        marker = next;
    }
    let mut entries: Vec<ApkEntry> = raw
        .into_iter()
        .map(|b| {
            let meta = parse_apk_name(&b.name);
            ApkEntry {
                name: b.name,
                url: b.url,
                version: meta.version,
                env: meta.env,
                build: meta.build,
                flavor: meta.flavor,
                date: meta.date,
                size_bytes: b.content_length,
                last_modified: b.last_modified,
            }
        })
        .collect();
    entries.sort_by(|a, b| {
        rfc1123_key(&b.last_modified).cmp(&rfc1123_key(&a.last_modified))
    });
    Ok(entries)
}

pub async fn download_apk(app: &tauri::AppHandle, url: &str, name: &str) -> Result<String, String> {
    use futures_util::StreamExt;
    use tauri::{Emitter, Manager};
    use tokio::io::AsyncWriteExt;

    let safe = std::path::Path::new(name)
        .file_name()
        .and_then(|f| f.to_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("invalid apk file name: {name}"))?
        .to_string();
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("apks");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&safe);

    let response = reqwest::get(url)
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
            let _ = app.emit(
                "apk-download-progress",
                DownloadProgress {
                    name: safe.clone(),
                    received,
                    total,
                },
            );
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    let _ = app.emit(
        "apk-download-progress",
        DownloadProgress {
            name: safe.clone(),
            received,
            total,
        },
    );
    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_real_samples() {
        let cases = [
            (
                "advisor-v2.0.12-QA-build-2012-release-RN-from-10-07-2026.apk",
                "2.0.12",
                "QA",
                2012,
                "release",
                "10-07-2026",
            ),
            (
                "advisor-v0.0.0-jdv-QA-build-1-release-RN-from-20-04-2026.apk",
                "0.0.0",
                "QA",
                1,
                "release",
                "20-04-2026",
            ),
            (
                "advisor-v0.0.5-PROD-build-5-release-RN-from-07-07-2026.apk",
                "0.0.5",
                "PROD",
                5,
                "release",
                "07-07-2026",
            ),
            (
                "advisor-v0.0.0.1-QA-build-1-automation-RN-from-17-07-2026.apk",
                "0.0.0.1",
                "QA",
                1,
                "automation",
                "17-07-2026",
            ),
            (
                "advisor-v0.0.4-QA-build-4-release-RN-from-07-07-2026.apk",
                "0.0.4",
                "QA",
                4,
                "release",
                "07-07-2026",
            ),
        ];
        for (name, version, env, build, flavor, date) in cases {
            let meta = parse_apk_name(name);
            assert_eq!(meta.version.as_deref(), Some(version), "{name}");
            assert_eq!(meta.env.as_deref(), Some(env), "{name}");
            assert_eq!(meta.build, Some(build), "{name}");
            assert_eq!(meta.flavor.as_deref(), Some(flavor), "{name}");
            assert_eq!(meta.date.as_deref(), Some(date), "{name}");
        }
    }

    #[test]
    fn unparsable_name_yields_null_fields() {
        let meta = parse_apk_name("random-build-artifact.zip");
        assert_eq!(meta, ApkMeta::default());
        let meta = parse_apk_name("app-v1.2.3-QA-build-notanumber-release.apk");
        assert_eq!(meta, ApkMeta::default());
    }

    #[test]
    fn missing_optional_parts_still_parse() {
        let meta = parse_apk_name("advisor-v1.2.3-build-7-release-RN-from-01-01-2026.apk");
        assert_eq!(meta.version.as_deref(), Some("1.2.3"));
        assert_eq!(meta.env, None);
        assert_eq!(meta.build, Some(7));
        assert_eq!(meta.flavor.as_deref(), Some("release"));
        assert_eq!(meta.date.as_deref(), Some("01-01-2026"));
    }

    #[test]
    fn parses_listing_fixture() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<EnumerationResults ServiceEndpoint="https://dlakecdnsfaprdeus201.blob.core.windows.net">
  <Prefix>APKs/</Prefix>
  <MaxResults>2</MaxResults>
  <Blobs>
    <Blob>
      <Name>APKs/advisor-v0.0.4-QA-build-4-release-RN-from-07-07-2026.apk</Name>
      <Url>https://dlakecdnsfaprdeus201.blob.core.windows.net/contenidos/APKs/advisor-v0.0.4-QA-build-4-release-RN-from-07-07-2026.apk</Url>
      <Properties>
        <Last-Modified>Mon, 07 Jul 2026 09:12:44 GMT</Last-Modified>
        <Content-Length>85689296</Content-Length>
        <Content-MD5>1B2M2Y8AsgTpgAmY7PhCfg==</Content-MD5>
        <BlobType>BlockBlob</BlobType>
      </Properties>
    </Blob>
    <Blob>
      <Name>APKs/advisor-v0.0.5-PROD-build-5-release-RN-from-07-07-2026.apk</Name>
      <Url>https://dlakecdnsfaprdeus201.blob.core.windows.net/contenidos/APKs/advisor-v0.0.5-PROD-build-5-release-RN-from-07-07-2026.apk</Url>
      <Properties>
        <Last-Modified>Tue, 07 Jul 2026 10:30:00 GMT</Last-Modified>
        <Content-Length>220145971</Content-Length>
        <Content-MD5>x0.png==</Content-MD5>
        <BlobType>BlockBlob</BlobType>
      </Properties>
    </Blob>
  </Blobs>
  <NextMarker>/contenidos/APKs/advisor-v0.0.5</NextMarker>
</EnumerationResults>"#;
        let blobs = parse_listing(xml);
        assert_eq!(blobs.len(), 2);
        assert_eq!(
            blobs[0].name,
            "APKs/advisor-v0.0.4-QA-build-4-release-RN-from-07-07-2026.apk"
        );
        assert_eq!(
            blobs[0].url,
            "https://dlakecdnsfaprdeus201.blob.core.windows.net/contenidos/APKs/advisor-v0.0.4-QA-build-4-release-RN-from-07-07-2026.apk"
        );
        assert_eq!(blobs[0].last_modified, "Mon, 07 Jul 2026 09:12:44 GMT");
        assert_eq!(blobs[0].content_length, 85689296);
        assert_eq!(blobs[1].content_length, 220145971);
        assert_eq!(
            xml_tag(xml, "NextMarker").as_deref(),
            Some("/contenidos/APKs/advisor-v0.0.5")
        );
    }

    #[test]
    fn xml_unescape_decodes_entities() {
        assert_eq!(xml_unescape("a&amp;b"), "a&b");
        assert_eq!(xml_unescape("&lt;x&gt; &quot;q&quot;"), "<x> \"q\"");
    }

    #[test]
    fn rfc1123_keys_sort_chronologically() {
        let older = rfc1123_key("Mon, 07 Jul 2026 09:12:44 GMT");
        let newer = rfc1123_key("Tue, 07 Jul 2026 10:30:00 GMT");
        let much_later = rfc1123_key("Fri, 17 Jul 2026 08:00:00 GMT");
        assert!(older < newer);
        assert!(newer < much_later);
        assert_eq!(rfc1123_key("garbage"), (0, 0, 0, 0, 0, 0));
    }
}
