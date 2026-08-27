# Exports

The **Export** menu in the requests toolbar offers three formats. Exports respect your active filters — what you see is what you get.

## HAR

Full session in the standard HTTP Archive format. Imports directly into Chrome DevTools and most debugging tools.

## Postman collection

Postman Collection v2.1 JSON for local import. No cloud, no account — download the file and import it manually.

## Bruno collection (recommended for git)

[Bruno](https://usebruno.com) stores collections as plain-text `.bru` files — one file per request. Beholder exports with **deterministic file names** (`{domain}/{method}-{path}.bru`), so a git repository of exports becomes a versioned history of your API:

```bash
git init my-api-snapshots
# export from Beholder into that folder, commit
git add . && git commit -m "capture after login fix"
# next session, export again into the same folder
git diff   # shows exactly which endpoints changed
```

::: tip Keep secrets out of the repo
Collections contain real request bodies — including tokens captured from your traffic. Add the export folder to `.gitignore` if it holds authenticated traffic, or maintain a sanitized copy.
:::
