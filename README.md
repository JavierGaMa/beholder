# Beholder

Non-invasive network traffic inspector for React Native apps running on Android emulators. macOS desktop app built with Tauri 2.

Watch your app's traffic — hands off your app's code. No interceptors, no manifest changes, no Flipper.

## What it does

- Full HTTP/HTTPS request and response bodies, headers, cookies, and timing
- WebSocket connections with a live frame timeline
- Copy as cURL for any request
- HAR export of a captured session (opens in Chrome DevTools)
- Curated dark themes (Obsidian, Carbon, Eclipse) with swappable accents
- Emulator management: list AVDs, see which are Beholder-ready (rootable), launch them, and create new ones with the right image (newest `google_apis` arm64) — including in-app system image download with live progress

## How it stays non-invasive

Beholder runs a local MITM proxy and configures the **emulator**, never your app:

1. Detects running AVDs via `adb`
2. `adb root` + `remount`, installs the Beholder CA as an Android **system** certificate (`/system/etc/security/cacerts/`)
3. Sets the emulator global proxy to `10.0.2.2:<port>` (the host loopback as seen from the emulator)
4. On stop/quit, the proxy setting is always reverted. The CA stays installed for faster next sessions — "Full cleanup" removes it

Requirements: a **Google APIs or AOSP** emulator image. Google Play images refuse `adb root` — the Setup view detects this and tells you.

## Development

```bash
npm install
npm run tauri dev      # run the app
npm run check          # tsc
npm test               # vitest
npm run lint           # eslint
cargo test --workspace # rust tests
npm run tauri build    # production bundle
```

Rust workspace: `crates/bh-core` (domain + events), `crates/bh-ca` (CA lifecycle + Android cert naming), `crates/bh-device` (adb orchestration behind traits), `crates/bh-proxy` (hudsucker MITM engine), `src-tauri` (Tauri shell).

Frontend: React 19 + Tailwind v4 + TanStack Virtual + zustand. Run `npm run dev` (plain Vite, no Tauri) for UI work with a mock traffic generator.

## Privacy

The CA is generated locally and stored in the app data directory. Traffic never leaves your machine; nothing is sent anywhere.
