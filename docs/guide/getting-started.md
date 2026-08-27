# Getting started

Beholder is a macOS desktop app that shows you exactly what your React Native app sends over the network — without touching a single line of your project.

## Requirements

- macOS on Apple Silicon
- [Android Studio](https://developer.android.com/studio) with:
  - **platform-tools** (adb) — the emulator and cmdline-tools must be installed
  - An emulator AVD with a **Google APIs** image (not Google Play)
- Node 18+ and Rust for building from source

::: warning Google Play images will not work
Google Play emulator images refuse `adb root`, which Beholder needs to install its certificate. The emulator creation wizard only offers Google APIs images for this reason. Existing Play-based AVDs show a `no root` badge.
:::

## Install from source

```bash
git clone https://github.com/CHANGE_ME/beholder.git
cd beholder
npm install
npm run tauri dev
```

The first Rust build takes a couple of minutes. Subsequent builds are fast.

## Your first capture

1. **Pick a target** — the emulator dropdown in the command bar lists your AVDs. Selecting a stopped emulator launches it and opens the onboarding stepper, which waits for boot and prepares everything for you.
2. **Press Capture** — Beholder installs its CA as a system certificate (into the Conscrypt apex on Android 14+), starts a local MITM proxy, and points the emulator's global proxy at it.
3. **Use your app** — open your React Native app on the emulator. Requests appear in real time.

::: tip Metro timing
A React Native app in development makes no network requests until the Metro bundle loads. An empty request list right after launch is normal — wait for the bundle, then interact with the app.
:::

## What "non-invasive" means

- No code changes, no interceptors, no manifest tweaks in your app
- The emulator's global proxy is reverted when you stop capture or quit Beholder
- Stale proxies pointing at dead ports are cleaned automatically on launch
- The CA stays installed between sessions for fast startup; "Full cleanup" in Settings removes it

## Stop or quit safely

Stopping capture or closing the app always reverts the emulator proxy. If Beholder is killed without a clean exit, the next launch detects and clears any dead proxy automatically.
