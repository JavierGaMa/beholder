# Beholder

[![Documentation](https://img.shields.io/badge/docs-vitepress-000000)](https://JavierGaMa.github.io/beholder/)

Non-invasive network traffic inspector for React Native apps on Android emulators.

**Watch your app's traffic — hands off your app's code.** No interceptors, no manifest changes, no Flipper.

![Beholder hero screenshot](docs/public/screenshot.png)

## What it does

- **HTTPS and WebSocket inspection** — bodies, headers, timing, JSON tree with click-to-copy paths, inline image previews
- **Zero changes to your app** — certificate and proxy are applied when a capture starts and reverted when it stops ([how it works](https://JavierGaMa.github.io/beholder/guide/capture))
- **Local routes** — send selected path prefixes to services on your machine without touching the app ([local routes](https://JavierGaMa.github.io/beholder/guide/routes))
- **Metrics** — downloaded/uploaded wire bytes per session and per domain, p50/p95 latency, slowest requests, media and download breakdowns, saved snapshots to compare runs
- **SQL console** — pull any app database from the emulator and query it read-only with schema-aware autocomplete
- **Agent bridge + MCP** — a local read-only API and an MCP server so coding agents can inspect traffic, metrics, and query databases without leaving the terminal
- **Emulator management** — create capture-ready emulators and repair broken ones with the built-in [Doctor](https://JavierGaMa.github.io/beholder/guide/doctor)
- **Exports and theming** — HAR, Postman, and Bruno collections; Ghostty-style [`config.toml`](https://JavierGaMa.github.io/beholder/config/) with live reload

## Install

**Homebrew** (recommended):

```bash
brew install --cask JavierGaMa/tap/beholder
```

Updates arrive via `brew upgrade --cask beholder` — or the in-app updater.

**Direct download**: grab the latest DMG from [Releases](https://github.com/JavierGaMa/beholder/releases) — macOS blocks the first launch of the unsigned download (right-click > Open).

**Build from source**: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Quick start

1. Pick your emulator in the command bar dropdown
2. Press **Capture**
3. Open your React Native app on the emulator — traffic appears in real time

## Coding agents

With the agent bridge enabled, Beholder serves a token-protected local API and ships a
`beholder-mcp` binary that any MCP client can spawn. Tools cover requests, console logs,
traffic metrics, saved metric snapshots, and read-only SQL over pulled device databases.
See the [agent bridge docs](https://JavierGaMa.github.io/beholder/) for setup.

## Requirements

- macOS (Apple Silicon and Intel builds available)
- Android Studio with platform-tools and a **Google APIs** emulator image (Google Play images refuse `adb root`)

## License

[MIT](LICENSE) © The Beholder Authors
