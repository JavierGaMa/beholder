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
| Without root | Only apps that trust user certificates | Logcat, shell, APK install, plain HTTP |
| With Magisk | Apps without certificate pinning | The above, plus the database viewer |

## Magisk

When `su` works from the adb shell, **Unlock** in the device setup mounts the Beholder certificate over the system store. Allow Shell in the Magisk Superuser tab if the request is denied. The mount disappears on reboot, and the cleanup removes it. Restart the app you want to inspect so it picks up the certificate.

## Limits

- The global proxy affects the whole phone. Apps that do not trust the certificate fail their HTTPS requests while capturing; hosts in `tls_bypass_hosts` in `config.toml` are relayed untouched.
- Clients that ignore the system proxy or pin certificates are not captured.
- iPhones are not supported.
