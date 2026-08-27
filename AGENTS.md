# Beholder

Network traffic inspector for React Native apps on Android emulators (Tauri 2).

## Commands

- Package manager: **npm** (never mix)
- Rust: `cargo test --workspace` and `cargo check --workspace` from the repo root
- Frontend: `npm run check` (tsc), `npm run lint` (eslint), `npm test` (vitest run)
- App: `npm run tauri dev`; production: `npm run tauri build`
- Docs: `npm run docs:dev` / `npm run docs:build` (VitePress in `docs/`)

## Conventions

- Rust workspace: crates under `crates/` (bh-core, bh-ca, bh-device, bh-proxy); Tauri shell in `src-tauri/`
- Frontend: feature-based under `src/features/`; shared UI in `src/components/ui/`; theming via CSS variables in `src/lib/theme/`
- Commits as work units: `type(scope): subject`, imperative, lowercase, max 50 chars; tests ship with the behavior they verify
- No code comments. No emojis in artifacts. English-only artifacts and commits
- All UI customization reads from `config.toml` (Ghostty-style, live reload); never add settings UI that duplicates the file
- Verify MITM changes with curl/OpenSSL against the e2e example, not only with Rust HTTP clients
- Never commit secrets, captured traffic, or personal paths

## Agent notes

- Run lint and typecheck after every change and report the result before declaring done
- Never commit unless explicitly asked; never rewrite history unless explicitly asked
- When a device-side behavior fails, reproduce with adb directly before changing code; include the raw command output in user-facing errors
