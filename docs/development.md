# Development

## Architecture

Beholder is a Rust workspace with a Tauri 2 shell and a React frontend. Dependencies point inward — the proxy engine never knows about Tauri.

```
beholder/
├── crates/
│   ├── bh-core/        # Domain: HttpExchange, WsFrame, TrafficSink, cURL, HAR, exports
│   ├── bh-ca/          # CA lifecycle, Android system cert naming (subject_hash_old)
│   ├── bh-device/      # adb + SDK tooling behind traits: scanner, installer, AVD manager, doctor
│   └── bh-proxy/       # MITM engine (hudsucker): HTTP/HTTPS/WS capture
├── src-tauri/          # Tauri shell: commands, config, batching, lifecycle
├── src/                # React 19 + Tailwind v4 frontend
└── docs/               # This VitePress site
```

## Commands

```bash
npm run tauri dev        # run the app
npm run check            # TypeScript
npm run lint             # ESLint
npm test                 # Vitest
cargo test --workspace   # Rust tests (run from the repo root)
cargo check --workspace  # Fast Rust check
npm run tauri build      # Production bundle (.app and .dmg)
```

## Documentation site

```bash
npm run docs:dev         # Local docs server
npm run docs:build       # Static site into docs/.vitepress/dist
```

Documentation deploys to GitHub Pages automatically via `.github/workflows/docs.yml`.

## Conventions

- Work-unit commits: `type(scope): subject`, imperative, lowercase, max 50 characters
- New behavior ships with tests — unit tests live next to the code they cover
- Rust crates stay focused: capture, device control, PKI, and domain are separate
- Frontend is feature-based under `src/features/`; shared primitives in `src/components/ui/`
- The UI reads all customization from `config.toml` — theme tokens are CSS variables

## Testing the MITM chain

`crates/bh-proxy/examples/mitm_e2e.rs` starts a proxy with a fresh CA and prints its port for manual certificate inspection:

```bash
cargo run -p bh-proxy --example mitm_e2e
curl -v --proxy http://127.0.0.1:<PORT> --cacert <printed CA path> https://example.com
```

Always verify MITM changes with curl or OpenSSL — not only with Rust HTTP clients, which apply different certificate validation rules than browsers.
