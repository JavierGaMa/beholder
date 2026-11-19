use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
}

pub const TOOL_CATALOG: &[ToolSpec] = &[
    ToolSpec {
        name: "beholder_focus",
        description: "Current Beholder focus: active target, capture state, request/failure counts, pinned items. Call this first.",
    },
    ToolSpec {
        name: "beholder_requests",
        description: "Compact request lines (id method path status ms). Default: failures plus pinned, newest window of 50.",
    },
    ToolSpec {
        name: "beholder_request",
        description: "Full detail of one exchange by id, bodies truncated by default.",
    },
    ToolSpec {
        name: "beholder_console",
        description: "Recent console (logcat) lines of the focus app, crashes always included.",
    },
    ToolSpec {
        name: "beholder_to_curl",
        description: "cURL replay command for one exchange by id.",
    },
    ToolSpec {
        name: "beholder_locate",
        description: "Locate where this request's endpoint appears in the current repo (ripgrep over cwd), returns file:line matches.",
    },
    ToolSpec {
        name: "beholder_metrics",
        description: "Session traffic metrics: lifetime totals (requests, failures, downloaded/uploaded wire bytes) plus top domains in the visible window with p95 latency. Call to answer data-usage or slowness questions.",
    },
    ToolSpec {
        name: "beholder_snapshots",
        description: "List saved metric snapshots (id, label, request count, downloaded bytes). Compare two via beholder_snapshot detail.",
    },
    ToolSpec {
        name: "beholder_snapshot",
        description: "Full detail of one saved metric snapshot by id: totals and per-domain breakdown.",
    },
    ToolSpec {
        name: "beholder_db_query",
        description: "Run a read-only SQL query (SELECT only; writes rejected) against a pulled device-DB snapshot. Only databases pulled while Beholder ran the agent bridge are available.",
    },
];

pub fn catalog() -> &'static [ToolSpec] {
    TOOL_CATALOG
}

#[cfg(test)]
mod tests {
    use super::*;

    const BEHOLDER_MCP_MAIN: &str = include_str!("../../beholder-mcp/src/main.rs");

    fn quoted_tool_names(source: &str) -> Vec<&str> {
        let mut names: Vec<&str> = Vec::new();
        let mut rest = source;
        while let Some(pos) = rest.find("\"beholder_") {
            let after = &rest[pos + 1..];
            let Some(end) = after.find('"') else { break };
            names.push(&after[..end]);
            rest = &rest[pos + 1 + end..];
        }
        names.sort_unstable();
        names.dedup();
        names
    }

    #[test]
    fn catalog_is_not_empty_and_names_are_unique() {
        let names: Vec<&str> = TOOL_CATALOG.iter().map(|t| t.name).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert!(!TOOL_CATALOG.is_empty());
        assert_eq!(names.len(), sorted.len());
    }

    #[test]
    fn catalog_names_match_the_stdio_mcp_dispatch() {
        let dispatch = quoted_tool_names(BEHOLDER_MCP_MAIN);
        let mut catalog_names: Vec<&str> = TOOL_CATALOG.iter().map(|t| t.name).collect();
        catalog_names.sort_unstable();
        assert_eq!(catalog_names, dispatch);
    }

    #[test]
    fn catalog_descriptions_match_the_stdio_mcp_descriptor() {
        for tool in TOOL_CATALOG {
            assert!(
                BEHOLDER_MCP_MAIN.contains(tool.description),
                "description drifted for {}",
                tool.name
            );
        }
    }

    #[test]
    fn catalog_serializes_name_and_description() {
        let json = serde_json::to_value(catalog()).unwrap();
        let first = &json.as_array().unwrap()[0];
        assert_eq!(first["name"], "beholder_focus");
        assert!(first["description"].as_str().unwrap().contains("focus"));
    }
}
