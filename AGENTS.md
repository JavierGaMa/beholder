# Beholder

Network traffic inspector for React Native apps on Android emulators (Tauri 2).

## Commands

- Package manager: **npm** (never mix)
- Rust: `cargo test --workspace` (run from repo root), `cargo check --workspace`
- Frontend: `npm run check` (tsc), `npm test` (vitest run)
- Full app: `npm run tauri dev`
- Production: `npm run tauri build`

## Conventions

- Rust workspace: crates under `crates/` (bh-core, bh-ca, bh-device, bh-proxy), Tauri shell in `src-tauri/`
- Frontend: feature-based under `src/features/`, shared UI in `src/components/ui/`, theme system in `src/lib/theme/`
- No code comments. Dark-first UI. English-only artifacts.
