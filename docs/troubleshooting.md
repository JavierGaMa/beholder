# Troubleshooting

## The emulator has no internet

Most likely a **dead proxy**: the global proxy points at a port where nothing listens anymore (a previous session that didn't clean up). Beholder clears these automatically on launch — but if it persists:

1. Open **Emulators → Doctor** on the running emulator
2. The *HTTP proxy* check reports dead ports in red
3. Click **Fix** (or **Fix all issues**)

Manual equivalent:

```bash
adb shell settings put global http_proxy :0
```

## "Your connection is not private" in the emulator browser

The app or browser does not trust the Beholder CA yet:

1. Restart the browser or app — Android processes cache the certificate store in memory, so anything running before the CA was installed keeps rejecting it
2. Run **Doctor** and confirm the *Beholder CA* check passes
3. Apps with certificate pinning (for example the Facebook app) reject any proxy by design — your own React Native app and the browser will not

## "adb root failed"

- **Google Play image** — refuses root; recreate the emulator with a `google_apis` image from the wizard
- **"adbd is already running as root"** — this is success, not an error; Beholder handles it
- Anything else — the error includes the raw adb output; copy it from the error box before reporting an issue

## No traffic appears

- React Native apps in development make no requests until the **Metro bundle loads** — wait for it, then use the app
- Check that Capture is active (green pulsing dot in the command bar)
- Some traffic uses certificate pinning and will show as failed connections — that traffic is intentionally unproxyable

## WebSocket frames missing

WebSocket interception is best-effort. HTTP, HTTPS, and SSE are the core path; if frames do not appear for a specific library, open an issue with the library and URL involved.

## Something else

Run **Doctor** first — its output is designed to identify the failing layer (device, root, network, proxy, CA). The error boxes throughout the app include a copy button for attaching exact messages to bug reports.
