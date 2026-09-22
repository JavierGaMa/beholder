use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DbFile {
    pub name: String,
    pub size_bytes: u64,
    pub has_wal: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotInfo {
    pub local_path: String,
    pub size_bytes: u64,
    pub pulled_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableSummary {
    pub name: String,
    pub row_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableColumn {
    pub name: String,
    pub decl_type: Option<String>,
}

pub type TableRow = serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TablePage {
    pub columns: Vec<TableColumn>,
    pub rows: Vec<TableRow>,
    pub total_rows: i64,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Error)]
pub enum DbError {
    #[error("adb not found: {0}")]
    AdbNotFound(String),
    #[error("command failed ({program} {args:?}): {stderr}")]
    CommandFailed {
        program: String,
        args: Vec<String>,
        stderr: String,
    },
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Other(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_file_serializes_snake_case() {
        let v = serde_json::to_value(DbFile {
            name: "app.db".into(),
            size_bytes: 4096,
            has_wal: true,
        })
        .unwrap();
        assert_eq!(v["name"], "app.db");
        assert_eq!(v["size_bytes"], 4096);
        assert_eq!(v["has_wal"], true);
    }

    #[test]
    fn snapshot_info_serializes_snake_case() {
        let v = serde_json::to_value(SnapshotInfo {
            local_path: "/tmp/app.db".into(),
            size_bytes: 8192,
            pulled_at_epoch_ms: 1726900000000,
        })
        .unwrap();
        assert_eq!(v["local_path"], "/tmp/app.db");
        assert_eq!(v["size_bytes"], 8192);
        assert_eq!(v["pulled_at_epoch_ms"], 1726900000000u64);
    }

    #[test]
    fn table_types_serialize_snake_case() {
        let summary = serde_json::to_value(TableSummary {
            name: "users".into(),
            row_count: 7,
        })
        .unwrap();
        assert_eq!(summary["name"], "users");
        assert_eq!(summary["row_count"], 7);

        let column = serde_json::to_value(TableColumn {
            name: "id".into(),
            decl_type: Some("INTEGER".into()),
        })
        .unwrap();
        assert_eq!(column["name"], "id");
        assert_eq!(column["decl_type"], "INTEGER");

        let column = serde_json::to_value(TableColumn {
            name: "id".into(),
            decl_type: None,
        })
        .unwrap();
        assert_eq!(column["decl_type"], serde_json::Value::Null);

        let page = serde_json::to_value(TablePage {
            columns: vec![TableColumn {
                name: "v".into(),
                decl_type: Some("TEXT".into()),
            }],
            rows: vec![serde_json::json!({"v": "a"})],
            total_rows: 1,
            offset: 0,
            limit: 50,
        })
        .unwrap();
        assert_eq!(page["total_rows"], 1);
        assert_eq!(page["offset"], 0);
        assert_eq!(page["limit"], 50);
        assert_eq!(page["rows"][0]["v"], "a");
    }
}
