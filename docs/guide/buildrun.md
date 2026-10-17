# Build & Run

The Build & Run view turns "get an instrumented app onto the emulator" into two clicks: detect the React Native project, pick a variant, run it. Beholder reads `productFlavors` and `buildTypes` from `android/app/build.gradle(.kts)`, runs `gradlew assemble<Flavor><BuildType>`, installs the APK on the selected emulator, and launches it with the package's launcher activity. Capture is device-wide, so traffic from the launched app appears in the request list automatically.

## Detect the project

Enter the React Native repository root and press **Detect**. Beholder shows the gradle file it parsed and the flavors and build types it found. Detection requires a `package.json` with `react-native` and an `android/app` directory.

Warnings surface here when the parsed variant list is ambiguous:

- **installing one uninstalls the other** — two flavors resolve to the same package id (`applicationId` + `applicationIdSuffix`), so the device can only ever hold one of them; installing one overwrites the other.
- **base applicationId not found** — the gradle file does not expose a readable base `applicationId`, so the per-flavor effective ids are unknown and the Reload buttons for those flavors are disabled.

## Pick a run target

Choose the flavor, the build type, and one of the online devices, then press **Run**. The build log streams gradle output, the resolved APK path, install, and launch steps. Note that running a variant uninstalls the app before installing it — app data is cleared on each Run.

## Hot loop: Metro + Reload

Gradle builds are one-time per flavor. The daily change loop runs through Metro instead:

1. Press **Start** in the Metro panel to spawn `react-native start` for the detected project (port from `[metro]` in `config.toml`, default 8081). The first start compiles for a while — wait for the status dot to turn green.
2. Run the app's `debug` build once; the app bundles from the local Metro server.
3. After JS changes, press **Reload** for the variant: Beholder force-stops the app; reopening it picks up the new bundle from Metro without a new gradle build.

The Metro panel streams the dev server log, so bundling progress and errors are visible next to the status.
