# Local routes

Local routes send selected path prefixes of your app's traffic to services running on your machine, while everything else keeps going to its real destination. The app under test does not change: it still calls the same URLs, and Beholder forwards the matching requests during a capture.

## Quick start

1. Write a route file, or let your tooling generate one
2. Add its absolute path to the `[routes]` section of `config.toml`
3. Open the **Routes** view and enable the routes you want
4. Start a capture and use your app

## Route file

A route file is a JSON document:

```json
{
  "version": 1,
  "name": "local stack",
  "routes": [
    {
      "id": "orders",
      "match": { "pathPrefix": "/v1/orders", "host": "api.example.com" },
      "target": "http://127.0.0.1:10100",
      "stripPrefix": true,
      "health": "/health"
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | yes | Must be `1`. Any other value is rejected with `unsupported route file version <n> (supported: 1)` |
| `name` | yes | Title of the file in the Routes view |
| `routes[].id` | yes | Unique inside the file |
| `routes[].match.pathPrefix` | yes | Path prefix to match, starting with `/` |
| `routes[].match.host` | no | Only match requests to this host. Without it, the prefix matches on any host |
| `routes[].target` | yes | Local service, as `http://127.0.0.1:<port>` or `http://localhost:<port>` |
| `routes[].stripPrefix` | no | Remove the prefix before forwarding. Defaults to `true` |
| `routes[].health` | no | Accepted and reserved. Health is currently a TCP connection check |

## Local targets only

A target must be `http://` with host `127.0.0.1` or `localhost` and an explicit port, without a path or query. Any other target rejects the file. This feature never forwards traffic to a remote host.

Requests reach your service with every header and the body unchanged, including `Authorization`. Only enable routes that point at services you trust.

## Configuration

```toml
[routes]
files = ["/abs/path/routes.json"]
```

The default is an empty list. A newly created `config.toml` already contains the section; a file created by an earlier version may not. Edit the `files` value if the section exists, and add the section only if it is missing.

Files are read when the file list changes, when a capture starts, and when you press **Reload** in the Routes view. A file that cannot be read or parsed is listed with its error, contributes no routes, and does not block the capture.

## Matching and rewriting

- A route matches when it is enabled, its `host` (if present) equals the request host ignoring case, and the path starts with `pathPrefix` ignoring case, ending at a segment boundary. `/v1/orders` matches `/v1/orders/42` and `/v1/orders?page=2`, but not `/v1/ordersX`
- When several routes match, the longest `pathPrefix` wins
- The scheme, authority, and `Host` header come from `target`. The query string is preserved
- With `stripPrefix`, `/v1/orders/api/items?x=1` is forwarded as `/api/items?x=1`. An empty remainder becomes `/`
- Requests that match no route behave exactly as without this feature

## The Routes view

Every route starts disabled. Toggles are remembered between sessions and apply to the next request without restarting the capture. **Enable all** and **Disable all** change every route at once; the command palette also offers **Disable all routes**.

Only one route per host and path prefix can be enabled, for example when two files describe two environments. Enabling a route disables the one with the same match, and **Enable all** keeps the route already enabled, or the first listed one.

Each route shows one status:

| Status | Meaning |
| --- | --- |
| **Off** | The route is disabled |
| **Checking** | The route is enabled and has not been probed yet |
| **Healthy** | The target accepted a TCP connection |
| **Unreachable** | The target did not accept a connection within 500 ms |

Health is checked every 5 seconds while the Routes view is visible or at least one route is enabled. When a route is enabled, the command bar shows a `Local n/total` chip that turns red if an enabled target is unreachable.

## Routed requests

The request list keeps the original URL, host, and path, and marks routed requests with a `local` tag. The detail pane shows the route id and target, and the **Local only** filter hides everything else.

## Limitations

- WebSocket connections are not routed
- Hosts listed in `proxy.tls_bypass_hosts` are not intercepted, so they are never routed
- Metro traffic relayed by the Metro pass-through is never routed
- If an enabled target is down, the app receives `502 Bad Gateway` and the request is listed as failed with the connection error
- Routes cannot mock responses or rewrite headers or bodies
