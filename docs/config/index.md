# Configuration

Beholder uses a single `config.toml` — Ghostty-style. Edit it in any editor, save, and the app applies changes **live**. No restarts.

```
~/Library/Application Support/dev.beholder.app/config.toml
```

Open it from **Settings → config.toml → Reveal**.

## Reference

```toml
# Beholder UI configuration
# Edit and save - changes apply live.

theme = "contrast"          # contrast | obsidian | carbon | eclipse
accent = "lime"             # lime | cyan | amber | violet
ui-font-size = 13           # px, general UI text
mono-font-size = 12         # px, requests and payloads
row-height = 34             # px, request list rows
mono-font-family = ""       # e.g. "JetBrains Mono"

[colors]                    # optional overrides, empty = theme value
# bg = "#000000"
# surface = "#0d0d0d"
# surface-2 = "#1d1d1b"
# line = "#3b3b37"
# text = "#ffffff"
# muted = "#a3a29b"
# accent = "#c6fd00"
# ok = "#89d185"
# warn = "#ffcc00"
# danger = "#f44747"
```

## Themes

| Theme | Feel |
| --- | --- |
| **contrast** (default) | Pure black, white text, warm gray borders, neon lime accent. Inspired by [Nicer High Contrast](https://github.com/rafmsou/nicer-high-contrast). |
| obsidian | Near-black neutral |
| carbon | Warm dark |
| eclipse | Deep blue-black |

## Fonts

`mono-font-family` applies everywhere monospace is used — request rows, headers, payloads. Any font installed on your Mac works by name, for example `"JetBrains Mono"`, `"Fira Code"`, or `"SF Mono"`.

## Color overrides

Values under `[colors]` beat the active theme for that token. Remove a key (or leave it unset) to fall back to the theme.

## Other settings

Some behavioral settings live in Settings and persist locally:

- **Body capture limit** (MB) — bodies larger than this are truncated in the inspector; traffic is never blocked
- **Slow request threshold** (ms) — drives row highlighting, the `slow` filter, and timing bars
