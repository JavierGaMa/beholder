use crate::types::{DbError, OrderDir, QueryResult, TableColumn, TablePage, TableSummary};
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
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

fn escape_like_literal(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn normalized_search(search: Option<&str>) -> Option<String> {
    let trimmed = search.map(str::trim).unwrap_or("");
    if trimmed.is_empty() {
        return None;
    }
    Some(format!("%{}%", escape_like_literal(trimmed)))
}

fn resolve_order(
    table: &str,
    columns: &[TableColumn],
    order_by: Option<&str>,
    order_dir: Option<OrderDir>,
) -> Result<Option<(String, OrderDir)>, DbError> {
    match (order_by, order_dir) {
        (None, None) => Ok(None),
        (Some(col), Some(dir)) => match columns.iter().find(|c| c.name == col) {
            Some(found) => Ok(Some((found.name.clone(), dir))),
            None => {
                let valid = columns
                    .iter()
                    .map(|c| c.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                Err(DbError::Other(format!(
                    "cannot order {table} by '{col}': not a column of this table; valid columns: {valid}"
                )))
            }
        },
        (Some(_), None) | (None, Some(_)) => Err(DbError::Other(
            "order_by and order_dir must be provided together".into(),
        )),
    }
}

pub fn table_rows(
    conn: &Connection,
    table: &str,
    limit: i64,
    offset: i64,
    search: Option<&str>,
    order_by: Option<&str>,
    order_dir: Option<OrderDir>,
) -> Result<TablePage, DbError> {
    let columns = table_columns(conn, table)?;
    let order = resolve_order(table, &columns, order_by, order_dir)?;
    let quoted = quote_ident(table);

    let (where_clause, mut params): (String, Vec<rusqlite::types::Value>) =
        match normalized_search(search) {
            Some(pattern) if !columns.is_empty() => {
                let predicates = columns
                    .iter()
                    .map(|c| format!("CAST({} AS TEXT) LIKE ? ESCAPE '\\'", quote_ident(&c.name)))
                    .collect::<Vec<_>>()
                    .join(" OR ");
                let params = columns
                    .iter()
                    .map(|_| rusqlite::types::Value::Text(pattern.clone()))
                    .collect::<Vec<_>>();
                (format!(" WHERE {predicates}"), params)
            }
            _ => (String::new(), Vec::new()),
        };

    let total_rows: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM {quoted}{where_clause}"),
            rusqlite::params_from_iter(params.iter()),
            |row| row.get(0),
        )
        .map_err(|e| DbError::Other(format!("count rows of {table}: {e}")))?;

    let order_clause = match &order {
        Some((col, dir)) => format!(
            " ORDER BY {} {}",
            quote_ident(col),
            match dir {
                OrderDir::Asc => "ASC",
                OrderDir::Desc => "DESC",
            }
        ),
        None => String::new(),
    };
    params.push(rusqlite::types::Value::Integer(limit));
    params.push(rusqlite::types::Value::Integer(offset));

    let mut stmt = conn
        .prepare(&format!(
            "SELECT * FROM {quoted}{where_clause}{order_clause} LIMIT ? OFFSET ?"
        ))
        .map_err(|e| DbError::Other(format!("read rows of {table}: {e}")))?;
    let column_names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
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

pub const QUERY_ROW_CAP: usize = 500;

fn starts_with_select_keyword(sql: &str) -> bool {
    let bytes = sql.as_bytes();
    bytes.len() >= 6
        && bytes[..6].eq_ignore_ascii_case(b"select")
        && (bytes.len() == 6 || !(bytes[6].is_ascii_alphanumeric() || bytes[6] == b'_'))
}

fn first_word(sql: &str) -> &str {
    sql.split_whitespace()
        .next()
        .unwrap_or("")
        .trim_end_matches(|c: char| !c.is_alphanumeric() && c != '_')
}

fn read_only_authorizer(ctx: AuthContext<'_>) -> Authorization {
    match ctx.action {
        AuthAction::Select
        | AuthAction::Read { .. }
        | AuthAction::Function { .. }
        | AuthAction::Recursive => Authorization::Allow,
        _ => Authorization::Deny,
    }
}

pub fn run_query(conn: &Connection, sql: &str) -> Result<QueryResult, DbError> {
    let started = std::time::Instant::now();
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err(DbError::Other(
            "read-only console: statement is empty; only SELECT statements are allowed".into(),
        ));
    }
    if !starts_with_select_keyword(trimmed) {
        return Err(DbError::Other(format!(
            "read-only console: only SELECT statements are allowed; rejected '{}'",
            first_word(trimmed)
        )));
    }
    conn.authorizer(Some(read_only_authorizer));
    let prepared = conn.prepare(trimmed);
    conn.authorizer(None::<fn(AuthContext<'_>) -> Authorization>);
    let mut stmt = prepared.map_err(|e| {
        DbError::Other(format!("read-only console: prepare rejected the statement: {e}"))
    })?;
    if !stmt.readonly() {
        return Err(DbError::Other(
            "read-only console: statement is not read-only".into(),
        ));
    }
    let column_names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
    let column_count = column_names.len();
    let mut rows_out: Vec<Vec<Value>> = Vec::new();
    let mut truncated = false;
    let mut rows = stmt
        .query([])
        .map_err(|e| DbError::Other(format!("read-only console: run failed: {e}")))?;
    loop {
        let row = rows
            .next()
            .map_err(|e| DbError::Other(format!("read-only console: run failed: {e}")))?;
        let Some(row) = row else {
            break;
        };
        if rows_out.len() >= QUERY_ROW_CAP {
            truncated = true;
            break;
        }
        let mut cells = Vec::with_capacity(column_count);
        for idx in 0..column_count {
            let value = row
                .get_ref(idx)
                .map_err(|e| DbError::Other(format!("read-only console: read cell: {e}")))?;
            cells.push(value_to_json(value));
        }
        rows_out.push(cells);
    }
    let row_count = rows_out.len();
    Ok(QueryResult {
        columns: column_names,
        rows: rows_out,
        row_count,
        truncated,
        elapsed_ms: started.elapsed().as_millis() as u64,
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
        let page = table_rows(&snap, "items", 100, 0, None, None, None).unwrap();
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

        let page = table_rows(&conn, "t", 10, 0, None, None, None).unwrap();
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

        let first = table_rows(&conn, "nums", 3, 0, None, None, None).unwrap();
        assert_eq!(first.total_rows, 7);
        assert_eq!(first.rows.len(), 3);
        assert_eq!(first.rows[0]["n"], 0);
        assert_eq!(first.offset, 0);
        assert_eq!(first.limit, 3);

        let second = table_rows(&conn, "nums", 3, 3, None, None, None).unwrap();
        assert_eq!(second.rows.len(), 3);
        assert_eq!(second.rows[0]["n"], 3);

        let last = table_rows(&conn, "nums", 3, 6, None, None, None).unwrap();
        assert_eq!(last.rows.len(), 1);
        assert_eq!(last.rows[0]["n"], 6);

        let beyond = table_rows(&conn, "nums", 3, 60, None, None, None).unwrap();
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

        let page = table_rows(&conn, "weird \"quoted\" name", 10, 0, None, None, None).unwrap();
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
        let err = table_rows(&conn, "nope; DROP TABLE real", 10, 0, None, None, None).unwrap_err();
        assert!(matches!(err, DbError::NotFound(m) if m.contains("nope")));
        let err = table_columns(&conn, "also missing").unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
        assert!(conn
            .query_row("SELECT COUNT(*) FROM real", [], |r| r.get::<_, i64>(0))
            .is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn seed_users(conn: &Connection) {
        conn.execute(
            "CREATE TABLE users (id INTEGER, name TEXT, note TEXT)",
            [],
        )
        .unwrap();
        let rows: Vec<(i64, &str, Option<&str>)> = vec![
            (1, "Ada Lovelace", Some("x%y")),
            (2, "grace hopper", Some("xzy")),
            (3, "Alan Turing", None),
            (4, "LINUS torvalds", Some("x_y")),
            (9, "Margaret Hamilton", Some("a\\b")),
            (10, "linus beta", Some("plain")),
        ];
        for (id, name, note) in rows {
            conn.execute(
                "INSERT INTO users VALUES (?1, ?2, ?3)",
                rusqlite::params![id, name, note],
            )
            .unwrap();
        }
    }

    fn users_db(tag: &str) -> (std::path::PathBuf, Connection) {
        let dir = temp_dir(tag);
        let path = dir.join("app.db");
        let conn = Connection::open(&path).unwrap();
        seed_users(&conn);
        (dir, conn)
    }

    fn names(page: &TablePage) -> Vec<String> {
        page.rows
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn search_matches_case_insensitively_across_text_and_numeric_columns() {
        let (dir, conn) = users_db("search-ci");
        let page = table_rows(&conn, "users", 50, 0, Some("ada"), None, None).unwrap();
        assert_eq!(page.total_rows, 1);
        assert_eq!(names(&page), vec!["Ada Lovelace"]);

        let page = table_rows(&conn, "users", 50, 0, Some("ADA"), None, None).unwrap();
        assert_eq!(page.total_rows, 1);

        let page = table_rows(&conn, "users", 50, 0, Some("hamilton"), None, None).unwrap();
        assert_eq!(page.total_rows, 1);
        assert_eq!(names(&page), vec!["Margaret Hamilton"]);

        let page = table_rows(&conn, "users", 50, 0, Some("1"), None, None).unwrap();
        assert_eq!(page.total_rows, 2);
        let ids: Vec<i64> = page
            .rows
            .iter()
            .map(|r| r["id"].as_i64().unwrap())
            .collect();
        assert_eq!(ids, vec![1, 10]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_treats_like_wildcards_as_literals() {
        let (dir, conn) = users_db("search-literal");

        let page = table_rows(&conn, "users", 50, 0, Some("x%y"), None, None).unwrap();
        assert_eq!(page.total_rows, 1);
        assert_eq!(names(&page), vec!["Ada Lovelace"]);

        let page = table_rows(&conn, "users", 50, 0, Some("x_y"), None, None).unwrap();
        assert_eq!(page.total_rows, 1);
        assert_eq!(names(&page), vec!["LINUS torvalds"]);

        let page = table_rows(&conn, "users", 50, 0, Some("a\\b"), None, None).unwrap();
        assert_eq!(page.total_rows, 1);
        assert_eq!(names(&page), vec!["Margaret Hamilton"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_without_hits_returns_empty_page_and_zero_total() {
        let (dir, conn) = users_db("search-empty");
        let page = table_rows(&conn, "users", 50, 0, Some("zzz-not-there"), None, None).unwrap();
        assert_eq!(page.total_rows, 0);
        assert!(page.rows.is_empty());

        let page = table_rows(&conn, "users", 50, 0, Some("   "), None, None).unwrap();
        assert_eq!(page.total_rows, 6);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_skips_rows_with_only_null_cells_like_null_is_null() {
        let dir = temp_dir("search-null");
        let path = dir.join("app.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute("CREATE TABLE nulls (a TEXT, b TEXT)", []).unwrap();
        conn.execute("INSERT INTO nulls VALUES (NULL, NULL)", []).unwrap();
        conn.execute("INSERT INTO nulls VALUES ('found', NULL)", []).unwrap();
        conn.execute("INSERT INTO nulls VALUES (NULL, 'needle')", [])
            .unwrap();

        for term in ["needle", "found", "n"] {
            let page = table_rows(&conn, "nulls", 50, 0, Some(term), None, None).unwrap();
            assert!(page.rows.iter().all(|r| !r["a"].is_null() || !r["b"].is_null()));
            match term {
                "needle" => assert_eq!(page.total_rows, 1),
                "found" => assert_eq!(page.total_rows, 1),
                "n" => assert_eq!(page.total_rows, 2),
                _ => unreachable!(),
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn orders_text_and_numeric_columns_in_both_directions() {
        let (dir, conn) = users_db("order");

        let page = table_rows(
            &conn,
            "users",
            50,
            0,
            None,
            Some("id"),
            Some(OrderDir::Asc),
        )
        .unwrap();
        let ids: Vec<i64> = page.rows.iter().map(|r| r["id"].as_i64().unwrap()).collect();
        assert_eq!(ids, vec![1, 2, 3, 4, 9, 10]);

        let page = table_rows(
            &conn,
            "users",
            50,
            0,
            None,
            Some("id"),
            Some(OrderDir::Desc),
        )
        .unwrap();
        let ids: Vec<i64> = page.rows.iter().map(|r| r["id"].as_i64().unwrap()).collect();
        assert_eq!(ids, vec![10, 9, 4, 3, 2, 1]);

        let page = table_rows(
            &conn,
            "users",
            50,
            0,
            None,
            Some("name"),
            Some(OrderDir::Asc),
        )
        .unwrap();
        assert_eq!(
            names(&page).first().map(String::as_str),
            Some("Ada Lovelace")
        );
        assert_eq!(names(&page).last().map(String::as_str), Some("linus beta"));

        let page = table_rows(
            &conn,
            "users",
            50,
            0,
            None,
            Some("name"),
            Some(OrderDir::Desc),
        )
        .unwrap();
        assert_eq!(names(&page).first().map(String::as_str), Some("linus beta"));
        assert_eq!(
            names(&page).last().map(String::as_str),
            Some("Ada Lovelace")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_order_column_error_lists_valid_columns() {
        let (dir, conn) = users_db("order-invalid");
        let err = table_rows(
            &conn,
            "users",
            50,
            0,
            None,
            Some("DROP TABLE users"),
            Some(OrderDir::Asc),
        )
        .unwrap_err();
        assert!(matches!(err, DbError::Other(ref m) if m.contains("valid columns")
            && m.contains("id") && m.contains("name") && m.contains("note")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn order_column_and_direction_must_come_together() {
        let (dir, conn) = users_db("order-pair");
        let err = table_rows(&conn, "users", 50, 0, None, Some("id"), None).unwrap_err();
        assert!(matches!(err, DbError::Other(ref m) if m.contains("together")));
        let err = table_rows(&conn, "users", 50, 0, None, None, Some(OrderDir::Asc))
            .unwrap_err();
        assert!(matches!(err, DbError::Other(ref m) if m.contains("together")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_order_and_pagination_combine() {
        let (dir, conn) = users_db("combine");
        let page = table_rows(
            &conn,
            "users",
            1,
            1,
            Some("linus"),
            Some("id"),
            Some(OrderDir::Desc),
        )
        .unwrap();
        assert_eq!(page.total_rows, 2);
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0]["id"], 4);
        assert_eq!(page.rows[0]["name"], "LINUS torvalds");
        assert_eq!(page.offset, 1);
        assert_eq!(page.limit, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn user_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
            .unwrap()
    }

    fn assert_read_only_rejection(err: &DbError, keyword: &str) {
        match err {
            DbError::Other(m) => assert!(
                m.contains("read-only") && m.contains(keyword),
                "unexpected error message: {m}"
            ),
            other => panic!("expected DbError::Other, got {other:?}"),
        }
    }

    #[test]
    fn run_query_select_returns_columns_and_rows() {
        let (dir, conn) = users_db("q-select");
        let res = run_query(&conn, "SELECT id, name FROM users ORDER BY id").unwrap();
        assert_eq!(res.columns, vec!["id", "name"]);
        assert_eq!(res.row_count, 6);
        assert_eq!(res.rows.len(), 6);
        assert_eq!(res.rows[0][0], 1);
        assert_eq!(res.rows[0][1], "Ada Lovelace");
        assert_eq!(res.rows[5][0], 10);
        assert!(!res.truncated);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_select_on_empty_table_returns_columns_without_rows() {
        let dir = temp_dir("q-empty-table");
        let path = dir.join("app.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute("CREATE TABLE blank (a INTEGER, b TEXT)", [])
            .unwrap();
        let res = run_query(&conn, "SELECT * FROM blank").unwrap();
        assert_eq!(res.columns, vec!["a", "b"]);
        assert_eq!(res.row_count, 0);
        assert!(res.rows.is_empty());
        assert!(!res.truncated);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_rejects_insert() {
        let (dir, conn) = users_db("q-insert");
        let err = run_query(&conn, "INSERT INTO users VALUES (99, 'x', NULL)").unwrap_err();
        assert_read_only_rejection(&err, "INSERT");
        assert_eq!(user_count(&conn), 6);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_rejects_update() {
        let (dir, conn) = users_db("q-update");
        let err = run_query(&conn, "UPDATE users SET name = 'x' WHERE id = 1").unwrap_err();
        assert_read_only_rejection(&err, "UPDATE");
        let name: String = conn
            .query_row("SELECT name FROM users WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Ada Lovelace");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_rejects_delete() {
        let (dir, conn) = users_db("q-delete");
        let err = run_query(&conn, "DELETE FROM users").unwrap_err();
        assert_read_only_rejection(&err, "DELETE");
        assert_eq!(user_count(&conn), 6);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_rejects_drop_table() {
        let (dir, conn) = users_db("q-drop");
        let err = run_query(&conn, "DROP TABLE users").unwrap_err();
        assert_read_only_rejection(&err, "DROP");
        assert!(table_exists(&conn, "users").unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_rejects_create_table() {
        let (dir, conn) = users_db("q-create");
        let err = run_query(&conn, "CREATE TABLE evil (v TEXT)").unwrap_err();
        assert_read_only_rejection(&err, "CREATE");
        assert!(!table_exists(&conn, "evil").unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_rejects_pragma_and_attach() {
        let (dir, conn) = users_db("q-pragma");
        let err = run_query(&conn, "PRAGMA journal_mode = WAL").unwrap_err();
        assert_read_only_rejection(&err, "PRAGMA");
        let err = run_query(&conn, "ATTACH DATABASE 'x.db' AS x").unwrap_err();
        assert_read_only_rejection(&err, "ATTACH");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_rejects_multiple_statements() {
        let (dir, conn) = users_db("q-multi");
        let err = run_query(&conn, "SELECT 1; DROP TABLE users").unwrap_err();
        assert_read_only_rejection(&err, "read-only console");
        assert!(matches!(err, DbError::Other(ref m) if m.contains("not authorized")));
        assert!(table_exists(&conn, "users").unwrap());
        let err = run_query(&conn, "SELECT 1; SELECT 2").unwrap_err();
        assert_read_only_rejection(&err, "read-only console");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_caps_rows_at_500_and_reports_truncation() {
        let dir = temp_dir("q-cap");
        let path = dir.join("app.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute("CREATE TABLE big (n INTEGER)", []).unwrap();
        conn.execute("CREATE TABLE exact (n INTEGER)", []).unwrap();
        for i in 0..503 {
            conn.execute("INSERT INTO big VALUES (?1)", [i]).unwrap();
        }
        for i in 0..500 {
            conn.execute("INSERT INTO exact VALUES (?1)", [i]).unwrap();
        }
        let res = run_query(&conn, "SELECT n FROM big ORDER BY n").unwrap();
        assert_eq!(res.row_count, 500);
        assert_eq!(res.rows.len(), 500);
        assert!(res.truncated);
        assert_eq!(res.rows[0][0], 0);
        assert_eq!(res.rows[499][0], 499);
        let res = run_query(&conn, "SELECT n FROM exact ORDER BY n").unwrap();
        assert_eq!(res.row_count, 500);
        assert_eq!(res.rows.len(), 500);
        assert!(!res.truncated);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_maps_blob_and_null_cells() {
        let dir = temp_dir("q-cells");
        let path = dir.join("app.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute("CREATE TABLE t (payload BLOB, note TEXT)", [])
            .unwrap();
        conn.execute("INSERT INTO t VALUES (X'CAFEBABE01', NULL)", [])
            .unwrap();
        let res = run_query(&conn, "SELECT payload, note FROM t").unwrap();
        assert_eq!(res.rows[0][0], "<5 bytes>");
        assert_eq!(res.rows[0][1], Value::Null);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_reports_sqlite_errors_with_message() {
        let (dir, conn) = users_db("q-sqlerr");
        let err = run_query(&conn, "SELECT * FROM missing_table").unwrap_err();
        assert!(matches!(err, DbError::Other(ref m) if m.contains("no such table")));
        let err = run_query(&conn, "SELECT n FROM users WHERE").unwrap_err();
        assert!(matches!(err, DbError::Other(ref m) if m.len() > "read-only console: prepare rejected the statement: ".len()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_query_empty_blank_and_lookalike_prefixes_are_rejected() {
        let (dir, conn) = users_db("q-prefix");
        for sql in ["", "   ", "; SELECT 1", "SELECTED 1", "SELECTION"] {
            let err = run_query(&conn, sql).unwrap_err();
            assert!(matches!(err, DbError::Other(ref m) if m.contains("read-only console")), "sql {sql:?}");
        }
        let res = run_query(&conn, "select 1").unwrap();
        assert_eq!(res.columns, vec!["1"]);
        assert_eq!(res.row_count, 1);
        assert_eq!(res.rows[0][0], 1);
        let res = run_query(&conn, "  \n\t SELECT * FROM users LIMIT 2").unwrap();
        assert_eq!(res.row_count, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
