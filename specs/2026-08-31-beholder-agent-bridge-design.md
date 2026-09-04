# Beholder Agent Bridge — Design

Date: 2026-08-31
Status: Approved (design phase)

## Summary

A local bridge that lets coding agents inspect the network traffic and console
logs of the app under development, without burning tokens on raw inspection.
The developer curates the scope in Beholder's UI: the active target/app defines
the base scope and explicit pins mark items of interest. A read-only HTTP API
exposed by Beholder feeds a stdio MCP binary (`beholder-mcp`) that any MCP
client (Claude Code, OpenCode, Codex) can spawn from the app repo's `.mcp.json`.
An enrichment tool cross-references captured endpoints with source locations in
that repo.

## Goals

- Token-efficient agent access: compact one-line summaries by default, bodies
  and details opt-in, failures and pinned items first.
- Dev-curated scope: active target (AVD/serial) + console-selected app define
  what the agent sees; pins give surgical focus.
- Endpoint-to-code cross-reference with zero configuration (repo path comes
  from the MCP server's cwd).
- Read-only. No agent action mutates capture, device, or proxy state.

## Non-goals (v1)

- Persistence / historical sessions (live capture only).
- Push notifications (tools poll; no WebSocket subscriptions).
- Executing replays (`beholder_to_curl` returns command text only).
- HAR import, remote binding, or multi-target concurrent scopes.

## Architecture

Four pieces, one workspace:

1. **`crates/bh-agent`** — agent state + local API server.
   - Subscribes to the same event sink the UI receives
     (`bh_proxy::start_mitm(port, &ca, cap, state.sink.clone())` in
     `src-tauri/src/commands.rs`) and maintains a queryable ring buffer of
     `HttpExchange` values plus a tail of parsed console lines (reusing
     `bh-console` types).
   - Owns the focus state: active target serial/AVD name, console-selected app
     package, and the pin set.
   - Serves the read-only HTTP API (axum) on `127.0.0.1`, ephemeral port by
     default.

2. **Port/token discovery file** — `~/.beholder/agent.json`, permissions 0600,
   written by `bh-agent` on bind:
   `{ "port": 43127, "token": "<random 32-byte hex>" }`.
   A fixed well-known path because the Tauri app-data dir is not discoverable
   by the standalone binary. Stale files (no listener) are overwritten on next
   launch.

3. **UI wiring (`src-tauri` + frontend)**
   - New Tauri commands: `agent_set_pin(id)`, `agent_clear_pin(id)`,
     `agent_clear_pins()`, `agent_set_focus_app(package)` — thin wrappers over
     `bh-agent` state.
   - `capture_start`/`capture_stop` already set `state.active_serial`; the
     agent module reads it as base scope.
   - RequestsView context menu gains "Pin for agent" next to "Copy as cURL";
     console rows gain an equivalent pin action. Pinned rows render a badge.
     Console `selectApp` syncs the focus package via `agent_set_focus_app`.

4. **`crates/beholder-mcp`** — stdio MCP binary.
   - Reads port/token from `~/.beholder/agent.json`; every tool call is one
     HTTP request to the local API.
   - Declared in each app repo's `.mcp.json`; its cwd is the app repo, which
     is what `beholder_locate` searches.
   - Implementation note: prefer the official Rust SDK (`rmcp`) if its
     dependency footprint is acceptable; a minimal hand-rolled JSON-RPC 2.0
     loop (initialize handshake + tools/call) is the fallback. Decide at plan
     time.

## Data contracts

### API endpoints (all GET, `Authorization: Bearer <token>`)

- `GET /focus` — scope snapshot: target serial/AVD, capture on/off, focus app
  package, request/failure counts, pinned item summaries. Bounded payload.
- `GET /requests?status=failed|all&search=&host=&since=&limit=` — compact
  lines; default `status=failed` plus pinned, newest last, `limit=50`.
- `GET /requests/{id}?body=truncated|full` — full exchange detail. Body text
  truncated to `max_body_chars` by default with a `[truncated, N bytes total]`
  marker; `full` is opt-in.
- `GET /console?level=&search=&limit=` — recent parsed lines of the focus app,
  default `limit=100`, crashes always included. Pinned items (requests and
  console lines) are embedded in `/focus` summaries; there is no separate
  pins endpoint.

### MCP tools

- `beholder_focus()` → `/focus`. The agent's first, cheapest call.
- `beholder_requests(query)` → `/requests`.
- `beholder_request(id, body?)` → `/requests/{id}`.
- `beholder_console(query)` → `/console`.
- `beholder_to_curl(id)` → single cURL command string. The formatting logic
  behind the existing `format_curl` Tauri command (`src-tauri/src/commands.rs`)
  is extracted into `bh-core` so both the command and the `bh-agent` API serve
  the same implementation.
- `beholder_locate(id)` → `rg` subprocess over the cwd for the request's path
  (longest stable suffix), returns `file:line` matches, capped at 20. `rg` is
  expected on the machine; absence returns a clear message.

### Compact formats

Request line: `#12 POST /login 401 342ms` (id, method, path, status, total).
Console line: `W ReactNative JS foo/bar.tsx:42 message…` truncated to one line.
`/focus` example shape:

```json
{
  "target": "emulator-5554 (Pixel_7_API_34)",
  "capture": true,
  "app": "com.example.myapp",
  "requests": 128,
  "failures": 3,
  "pins": ["#12 POST /login 401", "W OkHttp connection reset"]
}
```

## Configuration

New `[agent]` section in `config.toml` (`src-tauri/src/config.rs`, following
the existing `ConsoleConfig` pattern of serde defaults + TOML roundtrip +
live reload):

- `enabled` (default `true`)
- `bind` (default `"127.0.0.1:0"`)
- `max_body_chars` (default `2048`)
- `ring_requests` (default `5000`)
- `console_lines` (default `200`)

No settings UI; file-only, per repo convention.

## Error handling

- Beholder not running (no `agent.json` or connection refused): tools return
  `"Beholder is not running. Start Beholder and retry."`
- No target selected: `/focus` returns `"no_target"` with instructions.
- Capture off: `/focus` reports it; request tools return empty sets, not
  errors.
- Wrong/missing token: HTTP 401; tools surface it verbatim.
- `beholder_locate` with no matches: states so explicitly.

## Security

- Bind to loopback only; token gates the API against other local processes.
- Discovery file 0600. Token is 32 random bytes, regenerated per launch.
- Read-only surface; no capture data leaves the machine.
- Bodies default-truncated to limit accidental secret/PII exposure to agents.

## Testing

- `bh-agent` unit tests: ring buffer retention, compact line formatting,
  truncation markers, focus serialization, token middleware, endpoint
  handlers via an in-process test server.
- `beholder-mcp` contract tests: spawn the binary, JSON-RPC initialize
  handshake, one tool call against a stub HTTP server, graceful error path
  when the API is down.
- Frontend (`vitest`): pin commands wiring, badge rendering, focus sync.
- Rust checks: `cargo test --workspace`, `cargo check --workspace`. Frontend:
  `npm run check`, `npm run lint`, `npm test`.

## Open items (resolve at plan time)

- `rmcp` vs minimal JSON-RPC implementation for `beholder-mcp`.
- Exact console-line tap point (frontend store vs direct `bh-console`
  subscription in `bh-agent`).
- Whether WS frames appear in `/requests` responses in v1 or are excluded.
