# Capturing traffic

## Start and stop

Use the **Capture** button in the command bar. The status dot turns green and pulses while capturing, and the bar shows the proxy port, request count, and failure count.

Behind the scenes, starting a capture:

1. Runs `adb root` on the target emulator
2. Installs the Beholder CA as a system certificate — through a tmpfs mount bound over the Conscrypt apex on Android 14+, with correct SELinux contexts and zygote propagation
3. Starts a local MITM proxy on a random port
4. Sets the emulator global proxy to `10.0.2.2:<port>`

## The request list

| Column | Meaning |
| --- | --- |
| **Method** | Color-coded HTTP method |
| **Endpoint** | `host/path` — collapses to path only when you filter to a single domain |
| **St** | Status code, colored by class; a spinner dot while in flight |
| **Time** | Total milliseconds; amber or red when over your slow threshold |
| **Size** | Response or request body size |

Rows with errors get a red left bar. New requests flash briefly.

## Following live traffic

Toggle **follow** to keep the list pinned to the newest request. Scrolling up pauses following automatically; a floating pill shows how many new requests arrived and jumps you back.

## Filtering

- **Search box** — matches host, path, or URL; enable `content` to also search request and response bodies
- **Domain chips** — click to include a single domain, ⌥click to exclude it (kill analytics noise)
- **Quick toggles** — `failures` (4xx/5xx/errors) and `slow` (over your threshold)
- Filters persist between sessions

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `↑` / `↓` | Move selection through requests |
| `⌘F` / `Ctrl+F` | Focus the filter box |
| `Esc` | Close the detail pane |

## Right-click actions

Right-click any request for: Copy URL, Copy as cURL, Copy response body, Copy request body.

## The detail pane

Click a request to open it. Tabs:

- **Headers** — collapsible request/response sections; click a name to copy the key, a value to copy the value, or use the per-row menu for `name: value`
- **Cookies** — parsed from `cookie` and `set-cookie` headers
- **Body** — JSON bodies render as a collapsible tree; click any key to copy its JSON path (`user.addresses[0].city`). Use the header buttons to copy as cURL or copy the body
- **Timing** — TTFB, download, and total with slow highlighting

## WebSockets

The WebSockets view lists connections with a live frame timeline (sent and received directions marked). Frames are virtualized, so thousands of frames stay smooth.

::: info WebSocket close events
Android does not expose a close callback through the proxy layer, so connections may keep showing as open after they end.
:::
