# Host Setup Doctor & Wizard — Design

Date: 2026-09-14
Status: Approved design, pending implementation plan

## Problem

Beholder assumes the Android SDK is already installed. `RealSdkRunner::discover()` looks in `ANDROID_HOME` → `ANDROID_SDK_ROOT` → `~/Library/Android/sdk` and returns terse errors when cmdline-tools or the emulator binary are missing. First-run users with nothing installed see raw failure strings, and manual bootstrap is fragile:

- `avdmanager`/`sdkmanager` are Java wrappers; a GUI app inherits no shell environment, so `JAVA_HOME` is unset and the wrapper dies (`test: : integer expression expected`, then "Unable to locate a Java Runtime").
- `sdkmanager --licenses` is deprecated and the tooling now warns toward the new `android` CLI.
- Hardcoded cmdline-tools zip build numbers go stale.

The Emulators view compounds this: an empty AVD list renders a single muted line ("No AVDs found — create one below.") and a missing SDK renders as a raw error string.

## Goals

- One-click, headless, in-app setup for a clean macOS machine: Android Studio (official installer), cmdline-tools, platform-tools, emulator — then hand off to the existing AVD creation flow.
- A host doctor that always explains what is missing and what will be done about it.
- Friendly, actionable empty states in the Emulators view.
- No Homebrew dependency. All artifacts from official Google sources.

## Non-goals (v1)

- Managing the new `android` CLI (detect-and-prefer can come later; `sdkmanager`/`avdmanager` remain the stable path).
- Installing system images or creating AVDs from the wizard (the existing EmulatorsView flow owns that).
- Writing shell rc files without explicit user confirmation.
- Linux/Windows support (macOS first; checks are structured so ports stay possible).

## User experience

### Startup gate

On app start the frontend runs the host doctor silently:

- All hard checks pass → normal app; host doctor stays reachable from the Emulators view.
- Any hard check fails → the app opens on the Setup screen.

### Setup screen

- Checklist mirroring the doctor checks with ok/warn/fail states (same `DoctorCheck` shape and styling as the existing `DoctorPanel`).
- Primary button "Set up everything" runs all missing fixes in dependency order; each item also has an individual Fix button.
- Long steps stream progress through the existing install-log channel (`installLog`). The Android Studio step warns about the ~2 GB download before starting.
- Steps are idempotent and resumable: on failure the doctor re-detects and offers only what is missing.

### Emulators empty states

Three distinct states replace the current single muted line / raw error:

1. **Host not ready** (doctor reports hard failures): full-panel state — title "Set up your Android environment", one-line explanation, a summary of the missing pieces, CTA "Open setup" navigating to the Setup screen. The raw error string is collapsed behind a "Details" disclosure.
2. **Host ready, zero AVDs**: title "No emulators yet", hint that Beholder applies the right image and settings automatically, CTA "Create emulator" scrolling to and focusing the existing create form.
3. **Unexpected error** (host OK but a command failed): `ErrorBox` as today.

## Host doctor checks

| id | check | fails when | fix |
|---|---|---|---|
| `java` | JDK 17+ resolvable | no source resolves | `install_android_studio` |
| `android_studio` | `/Applications/Android Studio.app` exists | missing | `install_android_studio` |
| `sdk_root` | canonical SDK dir exists | missing | `init_sdk_dir` |
| `cmdline_tools` | `$SDK/cmdline-tools/latest/bin` has `sdkmanager` + `avdmanager` | missing | `install_cmdline_tools` |
| `platform_tools` | `$SDK/platform-tools/adb` exists | missing | `install_sdk_packages` |
| `emulator` | `$SDK/emulator/emulator` exists | missing | `install_sdk_packages` |
| `avd_present` | at least one AVD (soft: warn) | none | none — CTA to the create flow |
| `env_consistency` | `ANDROID_HOME`/`ANDROID_SDK_ROOT` match reality (soft: warn) | mismatch or stale | `write_shell_env` (optional) |

`avd_present` and `env_consistency` are soft — they never gate the app.

## Detection rules

- Java resolution order (first hit wins): Android Studio JBR (`/Applications/Android Studio.app/Contents/jbr/Contents/Home`) → `JAVA_HOME` → `/usr/libexec/java_home` → `java` on PATH.
- The resolved Java home is injected as `JAVA_HOME` on every `sdkmanager`/`avdmanager` invocation. Required because GUI apps do not inherit shell environments; this eliminates the wrapper-crash class seen in manual bootstrap.
- SDK root resolution order is unchanged from `RealSdkRunner::discover`.

## Bootstrap steps (fix actions)

1. `install_android_studio`: resolve the current official dmg URL, download, `hdiutil attach`, copy `Android Studio.app` to `/Applications`, detach. Skipped when already present.
2. `init_sdk_dir`: `mkdir -p ~/Library/Android/sdk`.
3. `install_cmdline_tools`: resolve the current official cmdline-tools mac zip from Google's repository index XML, unpack into `$SDK/cmdline-tools/latest` (canonical layout — Android Studio finds it too).
4. `install_sdk_packages`: with `JAVA_HOME` = Studio JBR, run `sdkmanager platform-tools emulator`, then accept licenses.
5. `write_shell_env` (only on explicit consent): append the `ANDROID_HOME` export to `~/.zshrc` after showing the exact lines.

No Homebrew anywhere.

### Implementation-time verification items (prove with curl before coding)

- The stable endpoint used to resolve the latest official Studio dmg URL (official metadata vs. downloads page — pick with evidence).
- The current version of the dl.google.com repository index XML used to resolve the cmdline-tools zip URL.
- The JBR copied from the dmg runs without a Gatekeeper prompt (expected to pass via Google's notarization; if not, document a consented `xattr -dr com.apple.quarantine` fallback).

## Architecture

- `crates/bh-device/src/host_doctor.rs` — pure checks over injectable base paths (tempdir-testable), returning `HostCheck` with the same shape as the existing device `DoctorCheck`.
- `crates/bh-device/src/host_bootstrap.rs` — fix actions as functions over a small command-runner trait with a fake for tests; reuse `DeviceError`.
- `RealSdkRunner::run` gains per-invocation `JAVA_HOME` injection.
- Tauri commands: `run_host_doctor()` returns checks; `apply_host_fix(fix)` streams via the existing install-log channel.
- Frontend: `SetupView` (checklist + actions), startup gate in `App`, and the EmulatorsView empty states. Reuse `DoctorPanel` styling; no new UI primitives.

## Testing

- Rust: checks as pure functions over tempdirs (JBR present/absent, SDK layouts, stale env vars); bootstrap steps against a fake runner asserting command, args, and injected env; step idempotency.
- Frontend (vitest): startup gate routing on doctor results; EmulatorsView renders the setup CTA vs. create-first-AVD CTA vs. `ErrorBox`.

## Risks

- Google endpoints for "latest" URLs change shape → mitigated by resolving from official metadata at runtime, the verification items above, and clear failure text with a manual-download fallback link in the UI.
- Android Studio download size (~2 GB) → explicit warning and streamed progress.
- Deprecated-tooling warnings from `sdkmanager` are noisy → routed to the log channel, never surfaced as errors.
