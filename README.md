<p align="center">
  <img src="https://github.com/welsione/dsh-mmx-bridge/raw/main/docs/banner.png" alt="dsh-mmx-bridge banner" width="100%" />
</p>

# dsh-mmx-bridge

> **一个工具 = MiniMax 全部多模态能力。** 让 DeepSeek Harness（DSH）的纯文本模型直接看图、画图、生成视频、说话、唱歌、翻唱、搜索、查额度。

[![npm version](https://img.shields.io/npm/v/dsh-mmx-bridge.svg)](https://www.npmjs.com/package/dsh-mmx-bridge)
[![npm downloads](https://img.shields.io/npm/dm/dsh-mmx-bridge.svg)](https://www.npmjs.com/package/dsh-mmx-bridge)
[![GitHub stars](https://img.shields.io/github/stars/welsione/dsh-mmx-bridge.svg)](https://github.com/welsione/dsh-mmx-bridge)
[![DSH version](https://img.shields.io/badge/DSH-0.1.0--rc.6+-brightgreen)](https://github.com/deepseek-ai/deepseek-harness)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![minimax](https://img.shields.io/badge/power_minimax--cli-blueviolet)](https://github.com/MiniMax-AI/cli)

[English](README.en.md) · 简体中文

---

## 为什么需要这个？

DSH 默认只支持纯文本对话——**看不了图、画不了画、说不了话、做不了视频**。`dsh-mmx-bridge` 通过一个 `mmx_bridge` 工具接入 MiniMax 全栈多模态模型，一次安装，8 种能力即开即用：

<p align="center">
  <img src="https://github.com/welsione/dsh-mmx-bridge/raw/main/docs/features.png" alt="feature overview" width="90%" />
</p>

## 快速开始

### 前置条件

1. 已安装 [DSH](https://github.com/deepseek-ai/deepseek-harness)（v0.1.0-rc.6+）
2. 已安装 [mmx-cli](https://github.com/MiniMax-AI/cli) 并登录：`npm i -g mmx-cli && mmx auth login`

### 一条命令安装

```bash
dsh plugin --profile web add dsh-mmx-bridge
```

> ⚠️ npm 不通？改用 `dsh plugin --profile web add github:welsione/dsh-mmx-bridge`

安装后**重启 dsh**（服务端 ESM 缓存不热替换），再刷新 Web GUI 即可使用。详见 [AGENT.md](https://github.com/welsione/dsh-mmx-bridge/blob/main/AGENT.md)。

#### 让 Agent 帮你装（复制给 Agent 的提示词）

```text
帮我安装 DSH 插件 dsh-mmx-bridge（仓库 https://github.com/welsione/dsh-mmx-bridge ）：

执行 `dsh plugin --profile web add dsh-mmx-bridge` 装到 web GUI profile；npm 拉不动就改用 `dsh plugin --profile web add github:welsione/dsh-mmx-bridge`。装完验证插件已挂载，并提醒我重启 dsh（设置页管理卡片需重启才生效）。
```

### 卸载

```bash
dsh plugin --profile web rm dsh-mmx-bridge
```

## 效果展示

| 图片生成 | 语音合成 |
| :--: | :--: |
| ![image generation](https://github.com/welsione/dsh-mmx-bridge/raw/main/docs/image-generation.png) | ![speech tts](https://github.com/welsione/dsh-mmx-bridge/raw/main/docs/speech-tts.png) |

| 图像识别（VLM 描述） | 插件配置页 |
| :--: | :--: |
| ![vision demo](https://github.com/welsione/dsh-mmx-bridge/raw/main/docs/vision-demo.png) | ![plugin settings](https://github.com/welsione/dsh-mmx-bridge/raw/main/docs/plugin-settings.png) |

## 架构

```
用户对话 → DSH Agent → mmx_bridge 工具 → mmx-cli → MiniMax API
                                                  ↓
                                            /mmx-files/ 同源服务
                                            （图片预览 / 音视频播放器）
```

- **零 npm 运行时依赖**：仅使用 Node.js 内置模块
- **同源产物服务**：生成的文件经 `/mmx-files/` 路径直接内嵌在对话中，支持 Range 请求
- **Web GUI 增强**：图片预览、音频/视频播放器、设置页管理卡片自动加载

## 兼容性

| 项目 | 说明 |
|:--|:--|
| DSH 版本 | 0.1.0-rc.6+（Web GUI profile） |
| 运行时依赖 | 零 npm 依赖（Node 内置模块） |
| 外部依赖 | [mmx-cli](https://github.com/MiniMax-AI/cli)（工具调用时） |
| OS | macOS / Linux / Windows（需 Node.js 18+） |

## 常见问题

<details>
<summary><b>Q: 安装后看不到 mmx_bridge 工具？</b></summary>

确认 DSH 版本 ≥ 0.1.0-rc.6，且 `mmx-cli` 已安装（`mmx --version`）。刷新 Web GUI 页面后重试。
</details>

<details>
<summary><b>Q: 设置页「插件配置」看不到 dsh-mmx-bridge 管理卡片？</b></summary>

DSH rc.7 起设置页按服务端注册的 settings 命名空间分发卡片，**需插件 ≥ 1.0.4**（1.0.4 起注册 `dsh-mmx-bridge` 命名空间）。确认安装版本 ≥ 1.0.4 并**重启 dsh**（服务端 ESM 缓存不热替换），再强刷 Web GUI 页面。
</details>

<details>
<summary><b>Q: 图片生成报错 "API key not found"？</b></summary>

需要先运行 `mmx auth login` 登录 MiniMax 账号。如果使用 Token Plan，确保套餐有效。
</details>

<details>
<summary><b>Q: 视频生成失败？</b></summary>

MiniMax 视频生成有队列限制，高峰期可能需要等待。检查 `mmx quota` 确认额度充足。
</details>

<details>
<summary><b>Q: 国内网络无法访问？</b></summary>

mmx-cli 直连 MiniMax API（api.minimax.chat），国内一般可直连。如遇问题检查代理设置。
</details>

## 相关项目

| 项目 | 说明 |
|:--|:--|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | DSH 本体 —— 一切皆插件的 Agent 框架 |
| [MiniMax CLI](https://github.com/MiniMax-AI/cli) | MiniMax 官方命令行工具 |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | DSH 插件精选集（本插件已收录） |
| [dsh-recommend](https://github.com/zp-home/dsh-recommend) | DSH 插件排行榜（本插件已收录） |

## 贡献

欢迎提 Issue 和 PR。开发流程：

```bash
git clone https://github.com/welsione/dsh-mmx-bridge.git
cd dsh-mmx-bridge
npm install
npm run build        # 构建 lib/
dsh plugin --profile web add .  # 本地安装测试
```

## 许可证

[MIT](LICENSE)

---

<p align="center">
  如果这个插件对你有帮助，欢迎给个 ⭐ Star 支持一下！
</p>
