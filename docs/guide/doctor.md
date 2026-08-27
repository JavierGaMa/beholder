# Doctor

The Doctor diagnoses a running emulator and repairs common problems in one click. Open it from the **Doctor** button on any running AVD.

## Checks

| Check | What it verifies |
| --- | --- |
| Boot completed | `sys.boot_completed` is set |
| Root access | adbd runs as root, or the image is a debuggable build that will root on capture |
| Radio on | Airplane mode is off |
| Internet (raw IP) | The emulator can reach `8.8.8.8` |
| DNS resolution | The emulator can resolve `google.com` |
| Host reachable | The emulator can reach your Mac at `10.0.2.2` — the Beholder proxy endpoint |
| HTTP proxy | The global proxy state, including the \#1 cause of "no internet" |
| Private DNS | Encrypted DNS modes that hide traffic from inspection |
| Beholder CA | The CA is present with the expected content |

## The dead-proxy check

The most common cause of an emulator with "no internet" is a global proxy pointing at a port where nothing listens anymore — a leftover from a previous Beholder, Charles, or Proxyman session. The Doctor detects this by probing the port from your Mac and offers a one-click fix.

## Fixes

- **Fix** — per check (clear proxy, disable airplane mode, clear private DNS)
- **Fix all issues** — applies every available fix and re-runs the checks
- **Reboot** — last resort, reboots the emulator
