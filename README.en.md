<p align="center">
  <img src="docs/banner.png" alt="dsh-mmx-bridge banner" width="100%" />
</p>

# dsh-mmx-bridge

> **One tool = all MiniMax multimodal capabilities.** Give DeepSeek Harness (DSH) the ability to see images, generate art, create videos, speak, sing, search the web, and more.

[![npm version](https://img.shields.io/npm/v/dsh-mmx-bridge.svg)](https://www.npmjs.com/package/dsh-mmx-bridge)
[![npm downloads](https://img.shields.io/npm/dm/dsh-mmx-bridge.svg)](https://www.npmjs.com/package/dsh-mmx-bridge)
[![GitHub stars](https://img.shields.io/github/stars/welsione/dsh-mmx-bridge.svg)](https://github.com/welsione/dsh-mmx-bridge)
[![DSH version](https://img.shields.io/badge/DSH-0.1.0--rc.6+-brightgreen)](https://github.com/deepseek-ai/deepseek-harness)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![minimax](https://img.shields.io/badge/power_minimax--cli-blueviolet)](https://github.com/MiniMax-AI/cli)

English · [中文 README](README.md)

---

## Why?

DSH is text-only by default — **no images, no speech, no video**. `dsh-mmx-bridge` plugs in MiniMax's full multimodal stack through a single `mmx_bridge` tool. Install once, get 8 capabilities:

<p align="center">
  <img src="docs/features.png" alt="feature overview" width="90%" />
</p>

## Quick Start

### Prerequisites

1. [DSH](https://github.com/deepseek-ai/deepseek-harness) v0.1.0-rc.6+
2. [mmx-cli](https://github.com/MiniMax-AI/cli) installed & logged in: `npm i -g mmx-cli && mmx auth login`

### Install

```bash
dsh plugin --profile web add dsh-mmx-bridge
```

> ⚠️ npm unreachable? Use `dsh plugin --profile web add github:welsione/dsh-mmx-bridge`

No restart needed — just refresh the Web GUI. See [AGENT.md](AGENT.md) for details.

### Uninstall

```bash
dsh plugin --profile web rm dsh-mmx-bridge
```

## Screenshots

| Image generation | Speech synthesis |
| :--: | :--: |
| ![image generation](docs/image-generation.png) | ![speech tts](docs/speech-tts.png) |

| Image understanding (VLM) | Plugin settings |
| :--: | :--: |
| ![vision demo](docs/vision-demo.png) | ![plugin settings](docs/plugin-settings.png) |

## Architecture

```
User chat → DSH Agent → mmx_bridge tool → mmx-cli → MiniMax API
                                                  ↓
                                            /mmx-files/ (same-origin)
                                            (image preview / audio & video players)
```

- **Zero npm runtime dependencies** — Node.js builtins only
- **Same-origin media** — generated files served via `/mmx-files/` with inline preview
- **Web GUI enhancement** — image preview, audio/video players, settings card auto-load

## Compatibility

| Item | Details |
|:--|:--|
| DSH version | 0.1.0-rc.6+ (Web GUI profile) |
| Runtime deps | Zero npm deps (Node builtins) |
| External deps | [mmx-cli](https://github.com/MiniMax-AI/cli) (at call time) |
| OS | macOS / Linux / Windows (Node.js 18+) |

## FAQ

<details>
<summary><b>Q: Don't see the mmx_bridge tool after install?</b></summary>

Verify DSH version ≥ 0.1.0-rc.6 and mmx-cli is installed (`mmx --version`). Refresh the Web GUI page.
</details>

<details>
<summary><b>Q: "API key not found" when generating images?</b></summary>

Run `mmx auth login` first. If using Token Plan, ensure your subscription is active.
</details>

<details>
<summary><b>Q: Video generation fails?</b></summary>

MiniMax video generation has queue limits;高峰期间 may take longer. Check `mmx quota` for balance.
</details>

## Related

| Project | Description |
|:--|:--|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | The DSH agent framework |
| [MiniMax CLI](https://github.com/MiniMax-AI/cli) | MiniMax official CLI |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | DSH plugin curated list (this plugin included) |
| [dsh-recommend](https://github.com/zp-home/dsh-recommend) | DSH plugin rankings (this plugin included) |

## Contributing

PRs and issues welcome.

```bash
git clone https://github.com/welsione/dsh-mmx-bridge.git
cd dsh-mmx-bridge
npm install
npm run build
dsh plugin --profile web add .   # local install for testing
```

## License

[MIT](LICENSE)

---

<p align="center">
  If this plugin helps you, please consider giving it a ⭐ Star!
</p>
