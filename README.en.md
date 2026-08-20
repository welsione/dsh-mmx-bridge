<p align="center">
  <img src="https://github.com/welsione/dsh-mmx-bridge/raw/main/docs/banner.png" alt="dsh-mmx-bridge banner" width="100%" />
</p>

# dsh-mmx-bridge

> **One tool = all MiniMax multimodal capabilities.** Give DeepSeek Harness (DSH) the ability to see images, generate art, create videos, speak, sing, search the web, and more.

[![npm version](https://img.shields.io/npm/v/dsh-mmx-bridge.svg)](https://www.npmjs.com/package/dsh-mmx-bridge)
[![npm downloads](https://img.shields.io/npm/dm/dsh-mmx-bridge.svg)](https://www.npmjs.com/package/dsh-mmx-bridge)
[![GitHub stars](https://img.shields.io/github/stars/welsione/dsh-mmx-bridge.svg)](https://github.com/welsione/dsh-mmx-bridge)
[![DSH version](https://img.shields.io/badge/DSH-0.1.0--rc.7+-brightgreen)](https://github.com/deepseek-ai/deepseek-harness)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![minimax](https://img.shields.io/badge/power_minimax--cli-blueviolet)](https://github.com/MiniMax-AI/cli)

English · [中文 README](README.md)

---

## Overview

DSH is text-only by default — **no images, no speech, no video**. `dsh-mmx-bridge` plugs in MiniMax's full multimodal stack through a single `mmx_bridge` tool. Install once, get 8 capabilities:

> **v1.0.5+: just drop an image to send it — your input stays untouched.** Dropping or pasting an image into the chat input works with text-only models: your message (image + prompt) is displayed and stored exactly as you wrote it. Behind the scenes the plugin saves the image to a temp dir (default `/tmp/mmx-out/`) and replaces it with "image URL + local path" text — the Agent then automatically calls `read_image` / `mmx_bridge(describe)` to look at it. Models that genuinely support image input pass through untouched.
>
> **v1.0.7+: image recognition cache (embedded JSON, on by default).** Recognition results are written back into the image itself as standard imgjson blocks (PNG `tEXt` / JPEG `COM`). The same image + the same question is served straight from the embedded cache on later reads — **zero VLM calls**. Follow-up questions are cached per prompt layer, never overwriting each other; when the image is re-encoded the cache invalidates and rebuilds automatically.

<p align="center">
  <img src="https://github.com/welsione/dsh-mmx-bridge/raw/main/docs/features.png" alt="feature overview" width="90%" />
</p>

## Compatibility

| Item | Details |
|:--|:--|
| DSH version | 0.1.0-rc.7+ (Web GUI profile) |
| Runtime deps | Zero npm deps (Node builtins) |
| External deps | [mmx-cli](https://github.com/MiniMax-AI/cli) (at call time) |
| OS | macOS / Linux / Windows (Node.js 18+) |

## Install / Uninstall

### Prerequisites

1. [DSH](https://github.com/deepseek-ai/deepseek-harness) v0.1.0-rc.7+
2. [mmx-cli](https://github.com/MiniMax-AI/cli) installed & logged in: `npm i -g mmx-cli && mmx auth login`

### Install

```bash
dsh plugin --profile web add dsh-mmx-bridge
```

> ⚠️ npm unreachable? Use `dsh plugin --profile web add github:welsione/dsh-mmx-bridge`

**Restart dsh** after installing (server-side ESM cache does not hot-reload), then refresh the Web GUI. See [AGENT.md](https://github.com/welsione/dsh-mmx-bridge/blob/main/AGENT.md) for details.

#### Have your agent install it (paste this prompt to your agent)

```text
Install the DSH plugin dsh-mmx-bridge for me (repo https://github.com/welsione/dsh-mmx-bridge ):

Run `dsh plugin --profile web add dsh-mmx-bridge` to install into the web GUI profile; if npm is unreachable, use `dsh plugin --profile web add github:welsione/dsh-mmx-bridge` instead. Verify the plugin is mounted after installing, then remind me to restart dsh (the settings-page card only appears after a restart).
```

### Uninstall

```bash
dsh plugin --profile web rm dsh-mmx-bridge
```

## Quick Start

One tool, the whole multimodal family. `mmx_bridge` dispatches on `action`:

| action | capability | key params |
|:--|:--|:--|
| `describe` | image understanding (VLM) | `image` + optional `prompt` (follow-up) |
| `image` | text-to-image | `prompt` / `aspectRatio` / `count` |
| `video` | text/image-to-video | `prompt` + optional `image` |
| `speech` | text-to-speech | `text` / `voice` |
| `music` | music generation | `prompt` / `lyrics` / `instrumental` |
| `cover` | audio cover | `prompt` + `audio` reference |
| `search` | web search | `q` |
| `quota` | usage/balance query | — |

Just ask the agent in plain language: **"describe this image"**, **"generate a cyberpunk cat"**, **"turn this text into speech"**.

## Configuration

Everything is tunable via the Settings → Plugins → Plugin config card or the control file.

### Control file (default `/tmp/dsh-vision-control.json`)

| key | default | meaning |
|:--|:--|:--|
| `enabled` | `true` | master switch |
| `count` | `3` | images per text-to-image call (1–8) |
| `webSearchEnabled` | `true` | route `web_search` through mmx-cli |
| `readImageEnabled` | `true` | route `read_image` through MiniMax VLM |
| `imageBridgeEnabled` | `true` | image bridge: drop-to-send, save-to-disk before LLM call |
| `imageCacheEnabled` | `true` | recognition cache: embed results back into the image, reuse on same image+question |

> Missing keys fall back to defaults (set `false` to disable explicitly). Settings-page toggles write to the same file.

### Environment variables (MMX_*)

| variable | default |
|:--|:--|
| `MMX_BIN` | `/usr/local/bin/mmx` |
| `MMX_OUT_DIR` | `/tmp/mmx-out` |
| `MMX_CONTROL_FILE` | `/tmp/dsh-vision-control.json` |
| `MMX_STATUS_FILE` | `/tmp/dsh-vision-status.json` |
| `MMX_DEBUG_LOG` | `/tmp/dsh-mmx-multimodal-debug.log` |

## Permissions & Data

- **Generated/bridged files**: images, videos, audio are saved to `MMX_OUT_DIR` (default `/tmp/mmx-out/`) and served same-origin via `/mmx-files/` (HTTP Range, path-traversal guarded).
- **Attachment reads**: bridge reads image bytes from the DSH attachment store (`attachments/v1`) by content address — **read-only, never written**.
- **Cache writes**: the plugin only writes back to its own `bridge-*` copies inside the out dir; it **never modifies** the immutable originals in the DSH attachment store.
- **Cache is plaintext**: the embedded JSON is not encrypted — anyone who knows the file format can read it. Do not embed sensitive information.
- **Re-encoding invalidates the cache**: after social-platform re-encoding/compression/screenshots, the embedded cache fails its sha256 check and is reported as stale instead of silently serving old data.

## Troubleshooting

<details>
<summary><b>Q: Don't see the mmx_bridge tool after install?</b></summary>

Verify DSH version ≥ 0.1.0-rc.7 and mmx-cli is installed (`mmx --version`). Refresh the Web GUI page.
</details>

<details>
<summary><b>Q: "Current model does not support images" when sending a picture?</b></summary>

Upgrade to **v1.0.5+** and **restart dsh** (server-side ESM cache does not hot-reload), hard-refresh the page, then check Settings → Plugins → Plugin config → make sure "Image bridge" is enabled. Models that genuinely support images pass through untouched.
</details>

<details>
<summary><b>Q: How does the recognition cache hit/expire?</b></summary>

Recognition results are embedded into the bridge copy as standard imgjson blocks. The same image + same question (`read_image` or `mmx_bridge(describe)`) is served from the embedded cache with `cached:true` — zero VLM calls. Different questions (follow-ups) get their own cached layer; re-encoding invalidates the cache explicitly and it rebuilds automatically.
</details>

<details>
<summary><b>Q: Don't see the dsh-mmx-bridge card in Settings → Plugins → Plugin config?</b></summary>

Since DSH rc.7, the settings page dispatches cards by the server-registered settings namespace, so **plugin ≥ 1.0.4 is required**. Confirm the installed version, **restart dsh** (server-side ESM cache does not hot-reload), then hard-refresh the Web GUI page.
</details>

<details>
<summary><b>Q: "API key not found" when generating images?</b></summary>

Run `mmx auth login` first. If using Token Plan, ensure your subscription is active.
</details>

<details>
<summary><b>Q: Network issues in mainland China?</b></summary>

mmx-cli connects directly to MiniMax API (api.minimax.chat), usually reachable from China without a proxy. Check your proxy settings if you still have trouble.
</details>

## Development

```bash
git clone https://github.com/welsione/dsh-mmx-bridge.git
cd dsh-mmx-bridge
npm test                 # unit tests (image cache / read_image wrapper, real PNG/JPEG)
npm run check            # syntax checks (4 lib files)
dsh plugin --profile web add .   # local install for testing
```

**Architecture**

```
User chat → DSH Agent → mmx_bridge tool → mmx-cli → MiniMax API
                                                  ↓
                                           /mmx-files/ (same-origin)
                                          (image preview / audio & video players)
Recognition result → imgjson block embedded back into the image (PNG tEXt / JPEG COM)
                  → same image + same question reuses it on the next read
```

- **Zero npm runtime dependencies** — Node.js builtins only
- **Same-origin media** — generated files served via `/mmx-files/` with inline preview
- **Web GUI enhancement** — image preview, audio/video players, settings card auto-load

## License & Security

- **MIT**: [LICENSE](LICENSE)
- No telemetry; no system-credential reads; never modifies the DSH attachment store
- Embedded recognition cache is **plaintext** — encrypt it yourself before writing back if it must stay private

---

## Related

| Project | Description |
|:--|:--|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | The DSH agent framework |
| [MiniMax CLI](https://github.com/MiniMax-AI/cli) | MiniMax official CLI |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | DSH plugin curated list (this plugin included) |
| [dsh-recommend](https://github.com/zp-home/dsh-recommend) | DSH plugin rankings (this plugin included) |

<p align="center">
  If this plugin helps you, please consider giving it a ⭐ Star!
</p>