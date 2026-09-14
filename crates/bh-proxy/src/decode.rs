use flate2::read::{DeflateDecoder, MultiGzDecoder, ZlibDecoder};
use std::io::Read;

const DECODE_LIMIT: u64 = 64 * 1024 * 1024;
const BROTLI_BUFFER: usize = 4096;

pub fn decode_content_encoding(bytes: &[u8], encoding: Option<&str>) -> Option<Vec<u8>> {
    let encoding = encoding?;
    let mut codings: Vec<String> = encoding
        .split(',')
        .map(|token| {
            token
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
        .filter(|token| !token.is_empty())
        .collect();
    if codings.is_empty() {
        return None;
    }
    codings.reverse();
    let mut data = bytes.to_vec();
    for coding in &codings {
        data = match coding.as_str() {
            "gzip" | "x-gzip" => read_all(MultiGzDecoder::new(&data[..]))?,
            "deflate" => match read_all(ZlibDecoder::new(&data[..])) {
                Some(out) => out,
                None => read_all(DeflateDecoder::new(&data[..]))?,
            },
            "br" | "brotli" => read_all(brotli::Decompressor::new(&data[..], BROTLI_BUFFER))?,
            _ => return None,
        };
    }
    Some(data)
}

fn read_all<R: Read>(reader: R) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    reader
        .take(DECODE_LIMIT)
        .read_to_end(&mut out)
        .ok()
        .map(|_| out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::{DeflateEncoder, GzEncoder, ZlibEncoder};
    use std::io::Write;

    const FIXTURE: &str = r#"{"items":[{"id":1,"name":"café"},{"id":2,"name":"naïve"}],"total":2}"#;

    fn gzip(data: &[u8]) -> Vec<u8> {
        let mut enc = GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(data).unwrap();
        enc.finish().unwrap()
    }

    fn zlib(data: &[u8]) -> Vec<u8> {
        let mut enc = ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(data).unwrap();
        enc.finish().unwrap()
    }

    fn raw_deflate(data: &[u8]) -> Vec<u8> {
        let mut enc = DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(data).unwrap();
        enc.finish().unwrap()
    }

    fn brotli_pack(data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut params = brotli::enc::BrotliEncoderParams::default();
        params.quality = 6;
        brotli::BrotliCompress(&mut &data[..], &mut out, &params).unwrap();
        out
    }

    fn assert_decoded(result: Option<Vec<u8>>) {
        let out = result.expect("decode should succeed");
        assert_eq!(out, FIXTURE.as_bytes());
    }

    #[test]
    fn decodes_gzip() {
        assert_decoded(decode_content_encoding(&gzip(FIXTURE.as_bytes()), Some("gzip")));
    }

    #[test]
    fn decodes_x_gzip_alias() {
        assert_decoded(decode_content_encoding(&gzip(FIXTURE.as_bytes()), Some("x-gzip")));
    }

    #[test]
    fn decodes_gzip_with_parameter() {
        assert_decoded(decode_content_encoding(&gzip(FIXTURE.as_bytes()), Some("gzip; q=1")));
    }

    #[test]
    fn decodes_deflate_zlib_wrapped() {
        assert_decoded(decode_content_encoding(&zlib(FIXTURE.as_bytes()), Some("deflate")));
    }

    #[test]
    fn decodes_deflate_raw() {
        assert_decoded(decode_content_encoding(&raw_deflate(FIXTURE.as_bytes()), Some("deflate")));
    }

    #[test]
    fn decodes_brotli() {
        assert_decoded(decode_content_encoding(&brotli_pack(FIXTURE.as_bytes()), Some("br")));
    }

    #[test]
    fn decodes_stacked_codings_in_reverse_order() {
        let double = gzip(&gzip(FIXTURE.as_bytes()));
        assert_decoded(decode_content_encoding(&double, Some("gzip, gzip")));
    }

    #[test]
    fn passes_through_missing_or_unknown_encoding() {
        assert_eq!(decode_content_encoding(FIXTURE.as_bytes(), None), None);
        assert_eq!(decode_content_encoding(FIXTURE.as_bytes(), Some("")), None);
        assert_eq!(decode_content_encoding(FIXTURE.as_bytes(), Some("identity")), None);
        assert_eq!(decode_content_encoding(FIXTURE.as_bytes(), Some("zstd")), None);
    }

    #[test]
    fn corrupt_gzip_returns_none_for_raw_fallback() {
        assert_eq!(decode_content_encoding(b"not-gzip-at-all", Some("gzip")), None);
    }

    #[test]
    fn truncated_gzip_returns_none_for_raw_fallback() {
        let full = gzip(FIXTURE.as_bytes());
        let cut = &full[..full.len() - 10];
        assert_eq!(decode_content_encoding(cut, Some("gzip")), None);
    }

    #[test]
    fn corrupt_brotli_returns_none_for_raw_fallback() {
        assert_eq!(decode_content_encoding(b"\x21\xac\xff\xff\xff", Some("br")), None);
    }
}
