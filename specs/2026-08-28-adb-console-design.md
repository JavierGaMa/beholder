# ADB Console — Design Spec

Status: approved architecture, pending implementation plan
Date: 2026-08-28
Scope: new Console subsystem for Beholder (logcat viewer with React Native enrichment, interactive adb shell, log/traffic correlation)

## 1. Goal

Give Beholder a Console view that streams `adb logcat` from the active target (emulator or physical device) with structured, readable rendering: level badges, tag columns, crash cards, spam collapsing, React Native presets and JSON pretty-printing. Later phases add an interactive `adb shell` PTY pane and a unified timeline that interleaves log lines with captured HTTP exchanges.

## 2. Non-goals (all phases)

- No logcat file persistence or session recording/replay (ring buffer only, export on demand)
- No Metro bundler host-log capture (device logcat only; Metro logs reach logcat via ReactNativeJS tags)
- No logcat write API, no radio SMS decode, no bugreport integration
- No settings UI beyond `config.toml` keys (Ghostty-style file config, live reload)

## 3. Phasing

| Phase | Deliverable |
|---|---|
| F1 | `bh-console` crate (logcat stream + parser + session), Tauri commands/events, ConsoleView with level chips, tag filter, regex search, RN preset, virtualized list |
| F2 | App filter (pid resolution by package), crash cards, ANR cards, spam collapse, export to file |
| F3 | Interactive `adb shell` PTY pane (portable-pty + xterm.js) |
| F4 | Unified timeline view merging console ring and traffic ring by timestamp |

Each phase is one work unit: independently shippable, tests ship with the behavior they verify.

## 4. Crate layout and SOLID boundaries

New crate `crates/bh-console`. `bh-device` stays untouched (short-lived commands only). `src-tauri` wires traits to Tauri infrastructure, exactly like `BatchSink` implements `TrafficSink` today.

```
crates/bh-console/
  src/lib.rs       — public types, re-exports
  src/types.rs     — LogLine, LogLevel, LogBuffer, ConsoleEvent, LogFilter, LogStatus
  src/parser.rs    — pure parsing: header parse + continuation assembly
  src/session.rs   — LogSession: owns a LogStream + parser + filter + ConsoleSink
  src/logcat.rs    — AdbLogcatStream: spawns `adb -s <serial> logcat ...`, real impl
  src/shell.rs     — (F3) PtyShell: portable-pty session over `adb -s <serial> shell`
```

Trait boundaries (dependency inversion, mirrors `CommandRunner`/`TrafficSink`):

```rust
pub trait LogStream: Send {
    fn lines(&mut self) -> Option<String>;   // blocking next line, None = EOF
}

pub trait LogStreamFactory: Send + Sync {
    fn open(&self, serial: &str, buffers: &[LogBuffer]) -> Result<Box<dyn LogStream>, ConsoleError>;
}

pub trait ConsoleSink: Send + Sync {
    fn emit(&self, event: ConsoleEvent);
}
```

- **SRP**: `parser.rs` has zero I/O; `logcat.rs` only spawns processes; `session.rs` only orchestrates; the Tauri shell only transports.
- **OCP**: presets and RN tag rules are data tables (frontend) and `LogFilter` values (backend) — new presets require no logic changes.
- **LSP**: `FakeLogStream` (scripted lines) and `RecordingConsoleSink` (like `RecordingSink`) honor the same contracts; all session tests run against fakes, no adb required.
- **ISP**: `LogStream` is not `CommandRunner` — streaming and short-lived commands stay separate traits; `ConsoleSink` carries status events, it is not bolted onto `TrafficSink`.
- **DIP**: `LogSession` depends only on the three traits above; `src-tauri` injects `AdbLogcatStream` (real adb, reusing `RealRunner::discover()` for the binary path) and a `ConsoleBatchSink`.

## 5. Data model

```rust
pub enum LogLevel { Verbose, Debug, Info, Warn, Error, Fatal }

pub enum LogBuffer { Main, System, Crash, Radio, Events }

pub struct LogLine {
    pub ts_ms: u64,          // device wall clock, epoch ms
    pub level: LogLevel,
    pub pid: u32,
    pub tid: u32,
    pub tag: String,
    pub buffer: LogBuffer,
    pub message: String,     // continuation lines joined with '\n'
    pub is_crash: bool,      // FATAL EXCEPTION group or ANR marker
}

pub enum ConsoleEvent {
    Line(LogLine),
    Status(LogStatus),       // Streaming | Disconnected | Failed(String) | Stopped
}

pub struct LogFilter {
    pub pid: Option<u32>,
    pub min_level: Option<LogLevel>,
    pub tags: Vec<String>,   // exact or suffix match (see 6.3)
}
```

`ts_ms`: threadtime prints `MM-DD HH:MM:SS.mmm` without year. Parser uses the current year; if the result is more than 1 day in the future it subtracts one year (year-boundary rollover).

## 6. Parser specification

Input: `adb -s <serial> logcat -v threadtime -b main,system,crash` (one process, all buffers).

### 6.1 Header line

```
 MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: message
```

Example: `08-28 14:23:01.123  4521  4521 I ReactNativeJS: {"user":1}`

- LEVEL is one of `V D I W E F`; anything else is treated as a continuation line.
- Leading whitespace is tolerated (logcat pads fields).

### 6.2 Continuation lines

A line that does not match 6.1 is appended to the previous entry's message (`\n`-joined). This keeps Java stack traces (`at com.foo...`, `Caused by:`) inside one `LogLine`. A continuation arriving before any header becomes a standalone `LogLine` with empty tag, level `Info`, pid/tid 0.

### 6.3 Buffer tracking

`-b all` output interleaves buffers. The parser tracks the current buffer from `--------- beginning of <buffer>` markers (emitted at start and on buffer rotation); default `Main` until the first marker. No per-line buffer prefix is assumed.

### 6.4 Crash and ANR detection

- A header entry with level `E` whose message starts with `FATAL EXCEPTION` opens a crash group: subsequent continuation lines attach to it; group closes on the next header line. `is_crash = true`.
- `ANR in <pkg>` (any level, usually ActivityManager) also sets `is_crash = true`.
- Chatty expunges (`expunge N lines`, `ident N lines`) are parsed and surfaced as a `× N` multiplier on the collapsed row (frontend), never dropped silently.

### 6.5 Tag matching rule

Tag match is exact OR colon-suffix (logcat sometimes reports `unknown:ReactNativeJS`). Match table for the RN preset: `ReactNativeJS`, `ReactNative`, `ReactNativeRenderer`, `unknown:ReactNativeJS`, `Metro`, `HMR`, `Bundle`.

## 7. Session lifecycle

`LogSession` runs on a tokio task (blocking reads on a dedicated thread):

1. Open stream via `LogStreamFactory`.
2. Emit `Status(Streaming)`.
3. Loop: read line → parse → apply `LogFilter` → emit `ConsoleEvent::Line` to sink.
4. On EOF: emit `Status(Disconnected)`, retry with backoff (1s, 2s, 5s, then every 10s) until stopped. Existing lines are never cleared by a retry.
5. On spawn error: emit `Status(Failed(msg))`, same retry ladder.
6. Stop: kill child process, emit `Status(Stopped)`.

App filter (`--pid` equivalent) is applied in the session, not via logcat args, so changing the target pid never restarts the stream. When the filtered app restarts (new pid), the frontend re-resolves via `console_apps` and updates the session filter in place.

One session at a time per app; `console_start` stops any previous session.

## 8. Tauri layer (src-tauri)

`ConsoleBatchSink` — same shape as `batch.rs::BatchSink`: unbounded mpsc channel, 50ms tick, flushes `Vec<ConsoleEvent>` as `console-batch` event.

Commands:

| Command | Signature | Notes |
|---|---|---|
| `console_start` | `(serial, buffers) -> Result<(), String>` | attaches to target serial; reuses `RealRunner::discover()` for adb path |
| `console_stop` | `() -> Result<(), String>` | stop session, keep buffer |
| `console_apps` | `(serial) -> Result<Vec<AppProcess>, String>` | third-party packages with pids: `pm list packages -3` + `pidof <pkg>` |
| `console_set_filter` | `(filter: LogFilter) -> Result<(), String>` | applied server-side before batching |
| `console_clear_buffer` | `(serial) -> Result<(), String>` | `logcat -c` |
| `console_export` | `(first_line_id, last_line_id) -> Result<PathBuf, String>` | dialog save, plain text, exports the id range as currently visible (post-filter) |
| `console_shell_start/stop` (F3) | `(serial, rows, cols)` / `()` | PTY session |
| `console_shell_input` (F3) | `(bytes: Vec<u8>)` | stdin write |
| `console_shell_resize` (F3) | `(rows, cols)` | pty resize |

Events: `console-batch` (`ConsoleEvent[]`), `console-shell-bytes` (F3, base64 string chunks), `console-shell-exit` (F3).

State: `ConsoleState` (session handle + shell handle) managed alongside `AppState`; console commands never touch proxy/capture state.

## 9. Frontend

### 9.1 Store — `src/store/console.ts` (zustand, separate from traffic store)

- `lines: LogLine[]` ring buffer capped at `ring-lines` (config, default 10000; oldest evicted)
- `status: LogStatus`, `filter` state (level, tags, regex, pid/app), `paused` (stream continues server-side; UI stops ingesting and marks the gap)
- Filter split: `LogFilter` (pid, min_level, tags) is enforced server-side before batching to bound volume — the toolbar level chips and tag filter drive it via `console_set_filter`; regex search and presets are client-side over the ring buffer
- Crash groups: consecutive `is_crash` entries collapse into one row with `× N` if repeated
- Spam collapse: identical consecutive `(tag, message)` entries render one row with a counter

### 9.2 View — `src/features/console/`

- `ConsoleView.tsx`: toolbar (status dot, buffer selector, app picker via `console_apps`, preset chips: All / RN / Crashes, level chips V D I W E, tag filter with autocomplete from observed tags, regex search, pause, clear, export) + virtualized list (same windowing approach as RequestsView) + detail drawer
- `LogRow.tsx`: monospace row — time, level badge colored by theme tokens (`ok`/`warn`/`danger`/`muted`), tag, pid, message; `show-tid` config toggles tid column
- `CrashCard.tsx`: exception type + message header, collapsible stack
- `logEnrich.ts`: render-time RN magic — if a `ReactNativeJS` message parses as JSON (starts with `{` or `[`), pretty-print with 2-space indent and syntax-highlight keys/strings/numbers using theme CSS variables
- `ShellPane.tsx` (F3): xterm.js terminal bound to `console-shell-bytes`/`console_shell_input`
- `TimelineView.tsx` (F4): merges console ring + traffic ring (`exchanges`/`wsConnections`) by `ts_ms`/`started_at` into one scrollable interleaved timeline; each entry links back to its native view

Rail: add `{ id: "console", label: "Console", icon: SquareTerminal }`; `View` type extended. F4 adds a timeline toggle inside Console, not a fifth rail entry.

### 9.3 config.toml

```toml
[console]
ring-lines = 10000        # max lines kept in memory
show-tid = false          # show thread id column
default-buffer = "main"   # main | system | crash
```

Live reload via existing config watcher; `ring-lines` shrinks take effect on next ingest.

## 10. F3 — PTY shell

`PtyShell` (bh-console/src/shell.rs) uses `portable-pty` to spawn `adb -s <serial> shell` with a pty (rows/cols from the frontend pane). Byte flow: pty output → `console-shell-bytes` (base64 chunks, batched like console-batch) → xterm.js write; xterm.js onData → `console_shell_input` → pty stdin. Resize propagates. Exit/crash emits `console-shell-exit`; pane shows exit status and a reconnect button. Only one shell per serial; starting a new one kills the old.

## 11. F4 — Unified timeline

No new backend. `TimelineView` merges both rings by timestamp. Emulator wall clock is host-synced on local emulators; a `skew-ms` input (default 0) shifts console timestamps for physical devices with drifting clocks. Entries: log rows (compact), exchange rows (method, host, status, duration) with click-through to the Requests view. This phase is presentation-only.

## 12. Error handling

- adb missing: `ConsoleError::AdbNotFound` (reuses `RealRunner::discover()` error), surfaced as a banner with setup hint
- device disconnect: `Status(Disconnected)` banner + auto-retry ladder (7.4); lines preserved
- app filter with dead pid: frontend detects the package gone from `console_apps` polling (5s while filtered) and clears the filter with a toast
- export failure, dialog cancel: toast, no state change
- shell: adb exit → `console-shell-exit`, pane offers reconnect; input to a dead shell returns an error once and marks the pane

## 13. Testing

Rust (`cargo test -p bh-console`):
- parser fixtures: normal header, padded fields, continuation-only stack, `FATAL EXCEPTION` group, `Caused by:`, ANR marker, chatty expunge, `unknown:` tag, `beginning of` buffer markers, year-rollover line, garbage line, empty line
- session with `FakeLogStream` + `RecordingConsoleSink`: filter by pid/level/tag, EOF retry ladder (fake clock), stop kills loop, status sequence
- factory: real command construction asserted via a fake `CommandRunner`-style path (adb binary path passed through)

Frontend (vitest):
- console store: ingest batch, ring cap eviction, pause/resume gap, spam collapse counting, crash grouping
- `logEnrich`: JSON detection (object, array, truncated JSON not prettified), RN tag gating
- preset matcher: exact + `unknown:` suffix

Manual verification (per AGENTS.md): parse correctness checked against `adb -s emulator-5554 logcat -d -v threadtime -b main,system,crash` dumps from a real emulator running the e2e RN example.

## 14. Risks

- logcat volume on busy emulators: server-side pid/level/tag filtering + 50ms batching + ring cap bound memory/CPU; if volume is still high in practice, raise server filter priority (drop Info/Verbose from the stream entirely) before considering UI changes
- threadtime format drift across Android versions: parser is fixture-tested against real dumps; continuation rule is version-agnostic
- PTY on Windows (F3): portable-pty handles ConPTY; adb shell PTY behavior on Windows is verified manually in F3
- correlation clock skew (F4): skew input + timestamp source documented in the timeline header
