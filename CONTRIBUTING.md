# Contributing to Beholder

Thanks for considering a contribution.

## Setup

```bash
npm install
npm run tauri dev
```

## Workflow

1. Fork and create a branch for your change
2. Keep commits as focused work units: `type(scope): subject` — imperative, lowercase, max 50 characters
3. Ship new behavior with tests:
   - Rust: `cargo test --workspace`
   - Frontend: `npm test` plus `npm run check` and `npm run lint`
4. Open a pull request describing what changed and why

## Areas

- **Rust crates** live under `crates/` — capture (`bh-proxy`), device control (`bh-device`), PKI (`bh-ca`), and domain types (`bh-core`)
- **Frontend** is feature-based under `src/features/`
- **Docs** live in `docs/` (VitePress) — `npm run docs:dev` to preview

## Reporting bugs

Run **Emulators → Doctor** on the failing emulator and include its output. Error boxes in the app include a copy button for exact messages.
