use crate::types::{DbError, TableColumn, TablePage, TableSummary};
use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde_json::{Map, Value};
use std::path::Path;

pub fn open_snapshot(path: &Path) -> Result<Connection, DbError> {
    Connection::open(path)
        .map_err(|e| DbError::Other(format!("open snapshot {}: {e}", path.display())))
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, DbError> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
    .map_err(|e| DbError::Other(format!("lookup table {table}: {e}")))
}

pub fn tables(conn: &Connection) -> Result<Vec<TableSummary>, DbError> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
        )
        .map_err(|e| DbError::Other(format!("list tables: {e}")))?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| DbError::Other(format!("list tables: {e}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| DbError::Other(format!("list tables: {e}")))?;
    drop(stmt);
    let mut summaries = Vec::with_capacity(names.len());
    for name in names {
        let count: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {}", quote_ident(&name)),
                [],
                |row| row.get(0),
            )
            .map_err(|e| DbError::Other(format!("count rows of {name}: {e}")))?;
        summaries.push(TableSummary {
            name,
            row_count: count,
        });
    }
    Ok(summaries)
}

pub fn table_columns(conn: &Connection, table: &str) -> Result<Vec<TableColumn>, DbError> {
    if !table_exists(conn, table)? {
        return Err(DbError::NotFound(format!(
            "table {table} not found in snapshot"
        )));
    }
    let sql = format!("PRAGMA table_info({})", quote_ident(table));
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| DbError::Other(format!("table_info {table}: {e}")))?;
    let columns = stmt
        .query_map([], |row| {
            Ok(TableColumn {
                name: row.get::<_, String>(1)?,
                decl_type: row.get::<_, Option<String>>(2)?,
            })
        })
        .map_err(|e| DbError::Other(format!("table_info {table}: {e}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| DbError::Other(format!("table_info {table}: {e}")))?;
    Ok(columns)
}

fn value_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::from(format!("<{} bytes>", b.len())),
    }
}

pub fn table_rows(
    conn: &Connection,
    table: &str,
    limit: i64,
    offset: i64,
) -> Result<TablePage, DbError> {
    let columns = table_columns(conn, table)?;
    let quoted = quote_ident(table);
    let total_rows: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {quoted}"), [], |row| {
            row.get(0)
        })
        .map_err(|e| DbError::Other(format!("count rows of {table}: {e}")))?;
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {quoted} LIMIT ?1 OFFSET ?2"))
        .map_err(|e| DbError::Other(format!("read rows of {table}: {e}")))?;
    let column_names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
    let rows = stmt
        .query_map([limit, offset], |row| {
            let mut object = Map::with_capacity(column_names.len());
            for (idx, name) in column_names.iter().enumerate() {
                object.insert(name.clone(), value_to_json(row.get_ref(idx)?));
            }
            Ok(Value::Object(object))
        })
        .map_err(|e| DbError::Other(format!("read rows of {table}: {e}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| DbError::Other(format!("read rows of {table}: {e}")))?;
    Ok(TablePage {
        columns,
        rows,
        total_rows,
        offset,
        limit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "bh-db-snap-{}-{tag}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn wal_only_rows_are_visible_in_copied_snapshot() {
        let dir = temp_dir("wal");
        let src = dir.join("app.db");
        let conn = Connection::open(&src).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute("CREATE TABLE items (v TEXT)", []).unwrap();
        for i in 0..5 {
            conn.execute("INSERT INTO items VALUES (?1)", [format!("row-{i}")])
                .unwrap();
        }

        let copy_dir = dir.join("copy");
        std::fs::create_dir_all(&copy_dir).unwrap();
        for suffix in ["", "-wal", "-shm"] {
            let from = dir.join(format!("app.db{suffix}"));
            if from.exists() {
                std::fs::copy(from, copy_dir.join(format!("app.db{suffix}"))).unwrap();
            }
        }
        assert!(copy_dir.join("app.db-wal").exists());

        let snap = open_snapshot(&copy_dir.join("app.db")).unwrap();
        let page = table_rows(&snap, "items", 100, 0).unwrap();
        assert_eq!(page.total_rows, 5);
        assert_eq!(page.rows.len(), 5);
        assert_eq!(page.rows[4]["v"], "row-4");

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn maps_null_integer_real_text_and_blob_values() {
        let dir = temp_dir("values");
        let path = dir.join("app.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute(
            "CREATE TABLE t (id INTEGER, note TEXT, ratio REAL, payload BLOB)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO t VALUES (1, ?1, 1.5, X'CAFEBABE01')",
            ["ñandú 数据库"],
        )
        .unwrap();
        conn.execute("INSERT INTO t VALUES (NULL, NULL, NULL, NULL)", [])
            .unwrap();

        let page = table_rows(&conn, "t", 10, 0).unwrap();
        assert_eq!(page.total_rows, 2);
        assert_eq!(page.rows[0]["id"], 1);
        assert_eq!(page.rows[0]["note"], "ñandú 数据库");
        assert_eq!(page.rows[0]["ratio"], 1.5);
        assert_eq!(page.rows[0]["payload"], "<5 bytes>");
        assert_eq!(page.rows[1]["id"], Value::Null);
        assert_eq!(page.rows[1]["note"], Value::Null);
        assert_eq!(page.rows[1]["ratio"], Value::Null);
        assert_eq!(page.rows[1]["payload"], Value::Null);

        let columns = table_columns(&conn, "t").unwrap();
        assert_eq!(
            columns,
            vec![
                TableColumn {
                    name: "id".into(),
                    decl_type: Some("INTEGER".into())
                },
                TableColumn {
                    name: "note".into(),
                    decl_type: Some("TEXT".into())
                },
                TableColumn {
                    name: "ratio".into(),
                    decl_type: Some("REAL".into())
                },
                TableColumn {
                    name: "payload".into(),
                    decl_type: Some("BLOB".into())
                },
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn paginates_rows_with_exact_totals() {
        let dir = temp_dir("pages");
        let path = dir.join("app.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute("CREATE TABLE nums (n INTEGER)", []).unwrap();
        for i in 0..7 {
            conn.execute("INSERT INTO nums VALUES (?1)", [i]).unwrap();
        }

        let first = table_rows(&conn, "nums", 3, 0).unwrap();
        assert_eq!(first.total_rows, 7);
        assert_eq!(first.rows.len(), 3);
        assert_eq!(first.rows[0]["n"], 0);
        assert_eq!(first.offset, 0);
        assert_eq!(first.limit, 3);

        let second = table_rows(&conn, "nums", 3, 3).unwrap();
        assert_eq!(second.rows.len(), 3);
        assert_eq!(second.rows[0]["n"], 3);

        let last = table_rows(&conn, "nums", 3, 6).unwrap();
        assert_eq!(last.rows.len(), 1);
        assert_eq!(last.rows[0]["n"], 6);

        let beyond = table_rows(&conn, "nums", 3, 60).unwrap();
        assert_eq!(beyond.total_rows, 7);
        assert!(beyond.rows.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tables_excludes_sqlite_internals_and_reports_counts() {
        let dir = temp_dir("tables");
        let path = dir.join("app.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute("CREATE TABLE beta (v TEXT)", []).unwrap();
        conn.execute("INSERT INTO beta VALUES ('x')", []).unwrap();
        conn.execute("INSERT INTO beta VALUES ('y')", []).unwrap();
        conn.execute("CREATE TABLE alpha (v TEXT)", []).unwrap();
        conn.execute("INSERT INTO alpha VALUES ('x')", []).unwrap();
        conn.execute(
            "CREATE TABLE counters (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO counters (v) VALUES ('x')", [])
            .unwrap();

        let summaries = tables(&conn).unwrap();
        assert_eq!(
            summaries,
            vec![
                TableSummary {
                    name: "alpha".into(),
                    row_count: 1
                },
                TableSummary {
                    name: "beta".into(),
                    row_count: 2
                },
                TableSummary {
                    name: "counters".into(),
                    row_count: 1
                },
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn quotes_exotic_table_and_column_names() {
        let dir = temp_dir("quoting");
        let path = dir.join("app.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute("CREATE TABLE \"weird \"\"quoted\"\" name\" (v INTEGER)", [])
            .unwrap();
        conn.execute("INSERT INTO \"weird \"\"quoted\"\" name\" VALUES (1)", [])
            .unwrap();
        conn.execute("CREATE TABLE \"order\" (\"select\" INTEGER)", [])
            .unwrap();
        conn.execute("INSERT INTO \"order\" VALUES (2)", [])
            .unwrap();

        let summaries = tables(&conn).unwrap();
        let names: Vec<&str> = summaries.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"order"));
        assert!(names.contains(&"weird \"quoted\" name"));
        assert_eq!(
            summaries
                .iter()
                .find(|s| s.name == "order")
                .unwrap()
                .row_count,
            1
        );

        let page = table_rows(&conn, "weird \"quoted\" name", 10, 0).unwrap();
        assert_eq!(page.total_rows, 1);
        assert_eq!(page.rows[0]["v"], 1);
        assert_eq!(page.columns[0].name, "v");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_table_returns_not_found() {
        let dir = temp_dir("notfound");
        let path = dir.join("app.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute("CREATE TABLE real (v INTEGER)", []).unwrap();
        let err = table_rows(&conn, "nope; DROP TABLE real", 10, 0).unwrap_err();
        assert!(matches!(err, DbError::NotFound(m) if m.contains("nope")));
        let err = table_columns(&conn, "also missing").unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
        assert!(conn
            .query_row("SELECT COUNT(*) FROM real", [], |r| r.get::<_, i64>(0))
            .is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
