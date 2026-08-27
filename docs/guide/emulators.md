# Emulator management

The Emulators view manages everything Beholder needs on the device side.

## Your AVDs

Each AVD shows its device profile, API level, image tag, and two badges:

- **rootable** / **no root** — whether the image allows `adb root`. Google APIs and AOSP images are rootable; Google Play images are not and cannot be inspected by Beholder.
- **running** — currently online, with a **Doctor** button

## Creating a Beholder-ready emulator

The creation wizard encodes everything Beholder requires automatically:

- **`google_apis` image** — the only tag that allows `adb root`
- **`arm64-v8a`** — matches Apple Silicon Macs
- Images are filtered and sorted by API level, newest first
- Missing images download in-app (~1-2 GB) with live progress and automatic license acceptance
- Device profiles come from your SDK's AVD manager

**Create & Launch** starts the onboarding stepper, which waits for boot, installs the CA, and starts capturing — ending with a direct link to the request list.

## Selecting targets from the command bar

The emulator dropdown in the command bar lists running emulators first (with a green dot), then stopped AVDs. Selecting a stopped AVD launches it and opens onboarding. **Create emulator** at the bottom jumps to the wizard.
