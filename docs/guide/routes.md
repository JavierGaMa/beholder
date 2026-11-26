# Local routes

Local routes send selected path prefixes of your app's traffic to services running on your machine, while everything else keeps going to its real destination. The app under test does not change: it still calls the same URLs, and Beholder forwards the matching requests during a capture.

## Connect services

1. Open the **Routes** view and press **Connect services**, or run **Connect services** from the command palette
2. Beholder looks for a local stack at `http://localhost:8090`. Choose one of the environments it lists and press **Connect**
3. Turn on the routes you want. Every newly connected route starts off
4. Start a capture and use your app

Each environment shows how many of its targets are running. You can connect an environment whose services are stopped and start them later. Connecting an environment removes the other files listed by the same local stack, because environments can share the same paths; files that stack does not list stay configured.

If nothing answers, enter the address of your local stack and press **Try again**. The last address used is remembered.

If you already have a route file, press **Choose file…** instead. The file is validated first and added only if it can be used.

**Remove** on a file group drops that file from the configuration and turns its routes off. The file itself is not deleted.

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

## Manual configuration

**Connect services**, **Choose file…** and **Remove** only edit the `files` list shown here, so you can also manage it by hand.

```toml
[routes]
files = ["/abs/path/routes.json"]
```

The default is an empty list. A newly created `config.toml` already contains the section; a file created by an earlier version may not. Edit the `files` value if the section exists, and add the section only if it is missing.

The app applies changes without a restart. When it writes the file, it changes only the settings that differ, so your unknown keys and the comments around unchanged settings are kept. Comments attached to a setting that is removed, or placed inside a list that changes, are not kept. The file is replaced atomically. A `config.toml` that cannot be parsed is never overwritten: the error is shown instead.

Files are read when the file list changes, when a capture starts, and when you press **Reload** in the Routes view. A file that cannot be read or parsed is listed with its error, contributes no routes, and does not block the capture.

## Discovery

A local stack tells Beholder which route files it has by answering `GET <base>/.well-known/beholder-routes`:

```json
{
  "version": 1,
  "name": "local stack",
  "files": [
    {
      "id": "dev",
      "label": "Dev",
      "path": "/abs/path/routes-dev.json",
      "hint": "make dev"
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | yes | Must be `1`. Any other value is rejected with `unsupported discovery version <n> (supported: 1)` |
| `name` | yes | Name of the local stack |
| `files` | yes | Non-empty list of route files |
| `files[].id` | yes | Unique inside the document |
| `files[].label` | yes | Name of the environment |
| `files[].path` | yes | Absolute path of a route file on this machine, ending in `.json` |
| `files[].hint` | no | Command that starts the environment, shown when none of its services are running |

### Discovery safety

- The base address must be `http://localhost:<port>` or `http://127.0.0.1:<port>`, with an optional trailing slash. Nothing else is queried
- Redirects are not followed and the system proxy is not used
- The request times out after 2 seconds and the response is limited to 64 KiB
- Every listed file goes through the same validation as a manually configured one. A file that fails is shown with its error and cannot be selected
- Discovery only reads. Configuration changes when you press **Connect**

## Matching and rewriting

- A route matches when it is enabled, its `host` (if present) equals the request host ignoring case, and the path starts with `pathPrefix` ignoring case, ending at a segment boundary. `/v1/orders` matches `/v1/orders/42` and `/v1/orders?page=2`, but not `/v1/ordersX`
- When several routes match, the longest `pathPrefix` wins
- The scheme, authority, and `Host` header come from `target`. The query string is preserved
- With `stripPrefix`, `/v1/orders/api/items?x=1` is forwarded as `/api/items?x=1`. An empty remainder becomes `/`
- Requests that match no route behave exactly as without this feature

## The Routes view

The header offers **Connect services** and **Choose file…** to change or add files, and each file group has **Reload** and **Remove**.

Every route starts disabled. Toggles are remembered between sessions and apply to the next request without restarting the capture. **Enable all** and **Disable all** change every route at once; the command palette also offers **Disable all routes**.

Only one route per host and path prefix can be enabled, for example when two files describe two environments. Enabling a route disables the one with the same match, and **Enable all** keeps the route already enabled, or the first listed one.

Each route shows one status:

| Status | Meaning |
| --- | --- |
| **Ready** | The route is disabled and its target accepted a TCP connection |
| **Not running** | The route is disabled and its target did not accept a connection |
| **Checking** | The target has not been probed yet |
| **Healthy** | The route is enabled and its target accepted a TCP connection |
| **Unreachable** | The route is enabled and its target did not accept a connection within 500 ms |

Health is checked every 5 seconds while the Routes view is visible or at least one route is enabled. When a route is enabled, the command bar shows a `Local n/total` chip that turns red if an enabled target is unreachable.

## Routed requests

The request list keeps the original URL, host, and path, and marks routed requests with a `local` tag. The detail pane shows the route id and target, and the **Local only** filter hides everything else.

## Limitations

- WebSocket connections are not routed
- Hosts listed in `proxy.tls_bypass_hosts` are not intercepted, so they are never routed
- Metro traffic relayed by the Metro pass-through is never routed
- If an enabled target is down, the app receives `502 Bad Gateway` and the request is listed as failed with the connection error
- Routes cannot mock responses or rewrite headers or bodies
