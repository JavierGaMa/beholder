# Beholder

[![Documentation](https://img.shields.io/badge/docs-vitepress-000000)](https://JavierGaMa.github.io/beholder/)

Non-invasive network traffic inspector for React Native apps on Android emulators. macOS desktop app built with Tauri 2.

**Watch your app's traffic — hands off your app's code.** No interceptors, no manifest changes, no Flipper.

![Beholder hero screenshot](docs/public/screenshot.png)

## Highlights

- **Full HTTPS and WebSocket visibility** — bodies, headers, cookies, timing, and a JSON tree with click-to-copy paths
- **Zero changes to your app** — the CA installs as an Android system certificate (Conscrypt apex on Android 14+); the emulator proxy is reverted on stop and quit
- **Emulator management** — create Beholder-ready emulators (Google APIs + arm64), launch them, and repair broken ones with the built-in Doctor
- **DevTools-grade UX** — follow mode, domain chips, body search, keyboard navigation, right-click actions
- **Exports** — HAR, Postman collections, and Bruno collections with deterministic file names for git versioning
- **Ghostty-style configuration** — one `config.toml` with live reload; fonts, sizes, and every color, defaulting to a high-contrast theme inspired by [Nicer High Contrast](https://github.com/rafmsou/nicer-high-contrast)

## Quick start

```bash
git clone https://github.com/JavierGaMa/beholder.git
cd beholder
npm install
npm run tauri dev
```

1. Pick your emulator in the command bar dropdown
2. Press **Capture**
3. Open your React Native app on the emulator — traffic appears in real time

See the [documentation](https://JavierGaMa.github.io/beholder/) for guides, configuration, and troubleshooting.

## Requirements

- macOS on Apple Silicon
- Android Studio with platform-tools and a **Google APIs** emulator image (Google Play images refuse `adb root`)

## License

[MIT](LICENSE) © The Beholder Authors
