<p align="center">
  <img src="docs/banner.png" alt="dsh-mmx-bridge banner" width="100%" />
</p>

# dsh-mmx-bridge

> MiniMax multimodal bridge plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

[![npm version](https://img.shields.io/npm/v/dsh-mmx-bridge.svg)](https://www.npmjs.com/package/dsh-mmx-bridge) [![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![mmx-cli](https://img.shields.io/badge/powered_by-mmx--cli-blueviolet)](https://github.com/MiniMax-AI/cli)

**English** · [中文 README](README.md)

## Features

One `mmx_bridge` tool covering MiniMax's whole multimodal stack:

- **Image understanding** (describe) · **Text-to-image** (image)
- **Video generation** (video) · **Text-to-speech** (speech)
- **Music generation** (music) · **Audio cover** (cover)
- **Web search** (search) · **Usage quota** (quota)

Generated files are served same-origin at `/mmx-files/` (with Range support); the conversation renders inline image previews and audio/video players, and results carry playable URLs.

<p align="center">
  <img src="docs/features.png" alt="feature overview" width="90%" />
</p>

## Screenshots

| Image generation | Speech synthesis |
| :--: | :--: |
| ![image generation](docs/image-generation.png) | ![speech tts](docs/speech-tts.png) |

| Image understanding (VLM) | Plugin settings |
| :--: | :--: |
| ![vision demo](docs/vision-demo.png) | ![plugin settings](docs/plugin-settings.png) |

## Install

Copy the prompt below to your AI assistant (agent) — it will follow [AGENT.md](AGENT.md) to install:

> Please read the AGENT.md at the repository root and follow its steps to install, mount and verify the dsh-mmx-bridge plugin in the current DSH profile.

## Related

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [MiniMax CLI](https://github.com/MiniMax-AI/cli) · [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins)

## License

[MIT](LICENSE)
