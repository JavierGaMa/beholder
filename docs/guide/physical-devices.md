# Physical devices

Beholder can capture from a physical Android phone connected over adb. Enable USB debugging, plug the phone in, accept the prompt, and pick it under **devices** in the target menu.

## How the traffic travels

- Beholder runs `adb reverse tcp:<port> tcp:<port>` and sets the phone's global HTTP proxy to `127.0.0.1:<port>`.
- The reverse rule is lost when the phone disconnects, so Beholder re-issues it every two seconds while capturing.
- The proxy that was set before the capture is saved and restored when you stop, quit, or run the cleanup. If the phone is unplugged at that moment, the saved value is restored the next time Beholder sees it.
- The proxy only listens on your Mac's loopback interface. Nothing is exposed to the network.

## What you can inspect

| Phone | HTTPS | Other features |
| --- | --- | --- |
| Without root | Only apps that trust user certificates | Logcat, shell, APK install, plain HTTP, databases of debuggable apps |
| With Magisk | Apps without certificate pinning | The above, plus the database viewer |

## Magisk

When `su` works from the adb shell, **Unlock** in the device setup mounts the Beholder certificate over the system store. Allow Shell in the Magisk Superuser tab if the request is denied. The mount disappears on reboot, and the cleanup removes it. Restart the app you want to inspect so it picks up the certificate.

## Databases

When `adb root` is not available, the database viewer reads through `su` on Magisk phones, or through `run-as` for debuggable apps. The `-wal` and `-shm` files are copied together with the database. Some manufacturers disable `run-as`. Writing changes back to a phone still needs `adb root`.

## Capture one app

With the [Beholder companion app](https://github.com/JavierGaMa/BeholdersApk/releases) 0.3.0 or newer installed, pick an app under **Capture one app** in the device setup. The companion runs a local VPN scoped to that app and points it at the proxy on your Mac, so the rest of the phone is left alone and the global proxy is not touched. The phone may ask you to accept the VPN once. The app still has to trust the certificate and honor the system proxy.

## Limits

- Without the companion, the global proxy affects the whole phone. Apps that do not trust the certificate fail their HTTPS requests while capturing; hosts in `tls_bypass_hosts` in `config.toml` are relayed untouched.
- Clients that ignore the system proxy or pin certificates are not captured.
- iPhones are not supported.
