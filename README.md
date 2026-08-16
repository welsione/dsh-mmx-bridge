<p align="center">
  <img src="docs/banner.png" alt="dsh-mmx-bridge banner" width="100%" />
</p>

# dsh-mmx-bridge

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 MiniMax 多模态桥接插件。

[![npm version](https://img.shields.io/npm/v/dsh-mmx-bridge.svg)](https://www.npmjs.com/package/dsh-mmx-bridge) [![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![mmx-cli](https://img.shields.io/badge/powered_by-mmx--cli-blueviolet)](https://github.com/MiniMax-AI/cli)

**English** · [English README](README.en.md)

## 功能

一个 `mmx_bridge` 工具，覆盖 MiniMax 全部多模态能力：

- **图片理解**（describe）· **文生图**（image）
- **视频生成**（video）· **语音合成**（speech）
- **音乐生成**（music）· **音频翻唱**（cover）
- **联网搜索**（search）· **用量查询**（quota）

生成产物经 `/mmx-files/` 同源提供（支持 Range），对话流直接内嵌图片预览与音视频播放器，结果携带可播放 URL。

<p align="center">
  <img src="docs/features.png" alt="feature overview" width="90%" />
</p>

## 效果展示

| 图片生成 | 语音合成 |
| :--: | :--: |
| ![image generation](docs/image-generation.png) | ![speech tts](docs/speech-tts.png) |

| 图像识别（VLM 描述） | 插件配置页 |
| :--: | :--: |
| ![vision demo](docs/vision-demo.png) | ![plugin settings](docs/plugin-settings.png) |

## 安装

将下面的提示词**整段**复制给你的 AI 助手（Agent），它会按仓库内的 [AGENT.md](AGENT.md) 完成安装、挂载与验证：

> 帮我安装 DSH（DeepSeek Harness）插件 dsh-mmx-bridge，仓库地址：https://github.com/welsione/dsh-mmx-bridge
> 1. 先读取该仓库根目录的 AGENT.md 安装指南（raw 链接：https://raw.githubusercontent.com/welsione/dsh-mmx-bridge/main/AGENT.md ），严格按其中「安装步骤」与「免重启验证」执行，不要跳步。
> 2. 安装目标是我当前使用的 DSH profile；无法确定时，列出 `~/.dsh/profiles/` 下的 profile 向我确认（Web GUI 场景通常是 `web`）。
> 3. 优先执行 `dsh plugin --profile <profile> add dsh-mmx-bridge`（安装后自动挂载，无需再手动改 `cordis.patch.yml`）；npm 源不可用时改用 `github:welsione/dsh-mmx-bridge`。
> 4. 免重启验证全部通过即安装完成；**不要重启 DSH**，把 AGENT.md 第 5 节「重启与重启后验证」清单转给我执行。

## 相关

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [MiniMax CLI](https://github.com/MiniMax-AI/cli) · [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins)

## 许可证

[MIT](LICENSE)
