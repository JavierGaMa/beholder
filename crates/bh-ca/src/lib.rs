use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CaError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("cert generation error: {0}")]
    Generation(String),
    #[error("parse error: {0}")]
    Parse(String),
}

pub struct Ca {
    pub cert_pem: String,
    pub key_pem: String,
}

pub fn generate_ca() -> Result<Ca, CaError> {
    let mut params = rcgen::CertificateParams::default();
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "Beholder CA");
    let key = rcgen::KeyPair::generate().map_err(|e| CaError::Generation(e.to_string()))?;
    let cert = params
        .self_signed(&key)
        .map_err(|e| CaError::Generation(e.to_string()))?;
    Ok(Ca {
        cert_pem: cert.pem(),
        key_pem: key.serialize_pem(),
    })
}

fn cert_has_san(cert_pem: &str) -> bool {
    let Ok(block) = pem::parse(cert_pem) else {
        return false;
    };
    let Ok((_, cert)) = x509_parser::parse_x509_certificate(block.contents()) else {
        return false;
    };
    cert.extensions()
        .iter()
        .any(|ext| format!("{}", ext.oid) == "2.5.29.17")
}

pub fn load_or_create(dir: &Path) -> Result<Ca, CaError> {
    let cert_path = dir.join("beholder-ca.pem");
    let key_path = dir.join("beholder-ca.key");
    if cert_path.exists() && key_path.exists() {
        let ca = Ca {
            cert_pem: std::fs::read_to_string(&cert_path)?,
            key_pem: std::fs::read_to_string(&key_path)?,
        };
        if !cert_has_san(&ca.cert_pem) {
            return Ok(ca);
        }
    }
    let ca = generate_ca()?;
    std::fs::create_dir_all(dir)?;
    std::fs::write(&cert_path, &ca.cert_pem)?;
    std::fs::write(&key_path, &ca.key_pem)?;
    set_owner_only_permissions(&cert_path);
    set_owner_only_permissions(&key_path);
    Ok(ca)
}

#[cfg(unix)]
fn set_owner_only_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn set_owner_only_permissions(_path: &Path) {}

fn subject_der(cert_pem: &str) -> Result<Vec<u8>, CaError> {
    let block = pem::parse(cert_pem).map_err(|e| CaError::Parse(e.to_string()))?;
    let (_, cert) = x509_parser::parse_x509_certificate(block.contents())
        .map_err(|e| CaError::Parse(e.to_string()))?;
    Ok(cert.tbs_certificate.subject.as_raw().to_vec())
}

pub fn system_cert_filename(cert_pem: &str) -> Result<String, CaError> {
    let der = subject_der(cert_pem)?;
    let digest = md5::compute(&der);
    let le = u32::from_le_bytes([digest.0[0], digest.0[1], digest.0[2], digest.0[3]]);
    Ok(format!("{:08x}.0", le))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_is_hash_format() {
        let ca = generate_ca().unwrap();
        let name = system_cert_filename(&ca.cert_pem).unwrap();
        assert_eq!(name.len(), 10);
        assert!(name.ends_with(".0"));
        assert!(name[..8].chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn filename_is_deterministic_per_ca() {
        let ca = generate_ca().unwrap();
        assert_eq!(
            system_cert_filename(&ca.cert_pem).unwrap(),
            system_cert_filename(&ca.cert_pem).unwrap()
        );
    }

    #[test]
    fn load_or_create_roundtrip() {
        let dir = std::env::temp_dir().join(format!("bh-ca-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let first = load_or_create(&dir).unwrap();
        let second = load_or_create(&dir).unwrap();
        assert_eq!(first.cert_pem, second.cert_pem);
        assert_eq!(first.key_pem, second.key_pem);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generated_ca_has_no_san() {
        let ca = generate_ca().unwrap();
        assert!(!cert_has_san(&ca.cert_pem));
    }

    #[test]
    fn legacy_ca_with_san_is_regenerated() {
        let dir = std::env::temp_dir().join(format!("bh-ca-legacy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut params = rcgen::CertificateParams::new(vec!["Beholder CA".to_string()]).unwrap();
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let key = rcgen::KeyPair::generate().unwrap();
        let cert = params.self_signed(&key).unwrap();
        assert!(cert_has_san(&cert.pem()));
        std::fs::write(dir.join("beholder-ca.pem"), cert.pem()).unwrap();
        std::fs::write(dir.join("beholder-ca.key"), key.serialize_pem()).unwrap();

        let migrated = load_or_create(&dir).unwrap();
        assert!(!cert_has_san(&migrated.cert_pem));
        assert_ne!(migrated.cert_pem, cert.pem());
        std::fs::remove_dir_all(&dir).ok();
    }
}
