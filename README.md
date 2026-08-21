<p align="center">
  <img src="https://github.com/welsione/dsh-mmx-bridge/raw/main/docs/banner.png" alt="dsh-mmx-bridge banner" width="100%" />
</p>

# dsh-mmx-bridge

> **一个工具 = MiniMax 全部多模态能力。** 让 DeepSeek Harness（DSH）的纯文本模型直接看图、画图、生成视频、说话、唱歌、翻唱、搜索、查额度。

[![npm version](https://img.shields.io/npm/v/dsh-mmx-bridge.svg)](https://www.npmjs.com/package/dsh-mmx-bridge)
[![npm downloads](https://img.shields.io/npm/dm/dsh-mmx-bridge.svg)](https://www.npmjs.com/package/dsh-mmx-bridge)
[![GitHub stars](https://img.shields.io/github/stars/welsione/dsh-mmx-bridge.svg)](https://github.com/welsione/dsh-mmx-bridge)
[![DSH version](https://img.shields.io/badge/DSH-0.1.0--rc.7+-brightgreen)](https://github.com/deepseek-ai/deepseek-harness)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![minimax](https://img.shields.io/badge/power_minimax--cli-blueviolet)](https://github.com/MiniMax-AI/cli)

[English](README.en.md) · 简体中文

---

## 概述（Overview）

DSH 默认只支持纯文本对话——**看不了图、画不了画、说不了话、做不了视频**。`dsh-mmx-bridge` 通过一个 `mmx_bridge` 工具接入 MiniMax 全栈多模态模型，一次安装，8 种能力即开即用：

> **v1.0.5 起：拖图直接发送，AI 就能识别——输入零改动。** 拖入/粘贴图片后正常发送：你的消息（图片＋提示词）在会话里**原样显示**，一个字节都不改。插件在背后把图片落盘到临时目录（默认 `/tmp/mmx-out/`）并替换为「图片地址＋本地路径」文本——Agent 收到地址后自动调用 `read_image` / `mmx_bridge(describe)` 查看图片。你感知不到中间过程。
>
> **v1.0.7 起：图片识别缓存（内嵌 JSON，默认开启）。** 识别结果以 imgjson 标准块（PNG `tEXt` / JPEG `COM`）**写回图片本身**，同图同问题再次读取直接复用，**零 VLM 调用**；追问按问题分层缓存，各层互不覆盖；图片被重新编码时缓存自动失效重建。可在设置页「插件配置」关闭。

<p align="center">
  <img src="https://github.com/welsione/dsh-mmx-bridge/raw/main/docs/features.png" alt="feature overview" width="90%" />
</p>

## 兼容性（Compatibility）

| 项目 | 说明 |
|:--|:--|
| DSH 版本 | 0.1.0-rc.7+（Web GUI profile） |
| 运行时依赖 | Node 内置模块 + `@deepseek-ai` 生态 peer 包（宿主运行时提供），无第三方运行时依赖 |
| 外部依赖 | [mmx-cli](https://github.com/MiniMax-AI/cli)（工具调用时；插件支持自动扫描 / 配置路径 / 一键安装 / api-key 一键登录） |
| OS | macOS / Linux（一等支持）；Windows 尽力支持（`os.tmpdir` 默认路径、`where mmx` 发现、`cmd.exe` 启动分支已适配，未经真机验证） |

## 安装与卸载（Install / Uninstall）

### 前置条件

1. 已安装 [DSH](https://github.com/deepseek-ai/deepseek-harness)（v0.1.0-rc.7+）
2. 已安装 [mmx-cli](https://github.com/MiniMax-AI/cli) 并登录：`npm i -g mmx-cli && mmx auth login`

### 安装

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

## 快速开始（Quick Start）

一个工具，多模态全家桶。`mmx_bridge` 按 `action` 分发：

| action | 能力 | 关键参数 |
|:--|:--|:--|
| `describe` | 图片理解（VLM） | `image`＋可选 `prompt`（追问） |
| `image` | 文生图 | `prompt` / `aspectRatio` / `count` |
| `video` | 文/图生视频 | `prompt` + 可选 `image` |
| `speech` | 语音合成 | `text` / `voice` |
| `music` | 音乐生成 | `prompt` / `lyrics` / `instrumental` |
| `cover` | 音频翻唱 | `prompt` + `audio` 参考音频 |
| `search` | 联网搜索 | `q` |
| `quota` | 用量查询 | — |

聊天里直接对 Agent 说即可，例如：**「描述这张图片」**、**「生成一张赛博朋克猫的图」**、**「把这段文字变成语音」**。

## 配置（Configuration）

所有配置均可通过设置页「插件配置」卡片或控制文件调整。

### 控制文件（默认 `/tmp/dsh-vision-control.json`）

| 键 | 默认 | 含义 |
|:--|:--|:--|
| `enabled` | `true` | 插件总开关 |
| `count` | `3` | 每次文生图张数（1–8） |
| `webSearchEnabled` | `true` | `web_search` 改用 mmx-cli |
| `readImageEnabled` | `true` | `read_image` 改用 MiniMax VLM |
| `imageBridgeEnabled` | `true` | 图片桥：拖图直发、发给 LLM 前落盘替换 |
| `imageCacheEnabled` | `true` | 识别缓存：识别结果内嵌写回图片，同图同问复用 |
| `mmxBin` | 自动 | mmx 可执行文件路径（留空/删除 = 回到自动扫描） |

> 键缺省即按默认值（`false` 显式关闭）。设置页开关写入同一文件。

### mmx 环境管理（设置卡「环境」区块）

插件自动完成 mmx-cli 的**发现 / 配置 / 安装 / 登录**全闭环：

1. **自动扫描**：按优先级探测 `控制文件 mmxBin` > `环境变量 MMX_BIN` > 自动扫描（`command -v mmx` / `where mmx`、`/usr/local/bin/mmx`、`/opt/homebrew/bin/mmx`、npm 全局目录等）；
2. **扫描不到 → 手动配置**：设置卡「mmx 路径」输入真实路径保存（校验存在性），留空保存即清除、回到自动扫描；
3. **未安装 → 一键安装**：设置卡一键执行 `npm install -g mmx-cli`（跟随系统 npm 配置），成功后自动重扫；
4. **未登录 → api-key 一键登录**：设置卡输入 MiniMax API Key 点「登录」（内部执行 `mmx auth login --api-key`），**Key 不落盘、不写日志、不回显**；「登录状态」按钮实时查询 `mmx auth status`。
5. **模型自助修复（免去后台配置）**：新增 `mmx_env` 工具（`status / install / login / set-path`）。`mmx_bridge` 报「找不到 mmx / 未登录 / 命令错误」时，错误信息自带修复引导；Agent 先 `status` 自查原因，再 `install`（一键安装）、`login`（向用户索要 API Key 后登录，Key 不写进输出）、`set-path`（配置路径）现场修复，最后 `status` 确认——用户无需进设置页，只管对话。

### 环境变量（MMX_*）

| 变量 | 默认 |
|:--|:--|
| `MMX_BIN` | 平台默认（macOS `/usr/local/bin/mmx`；Windows `mmx`） |
| `MMX_OUT_DIR` | 系统临时目录下的 `mmx-out`（macOS/Linux 即 `/tmp/mmx-out`） |
| `MMX_CONTROL_FILE` | 系统临时目录下的 `dsh-vision-control.json` |
| `MMX_STATUS_FILE` | 系统临时目录下的 `dsh-vision-status.json` |
| `MMX_DEBUG_LOG` | 系统临时目录下的 `dsh-mmx-multimodal-debug.log` |
| `MMX_INSTALL_PATH` | `/api/mmx-bridge/install-mmx` |
| `MMX_LOGIN_PATH` | `/api/mmx-bridge/login-mmx` |
| `MMX_AUTH_STATUS_PATH` | `/api/mmx-bridge/auth-status` |

## 权限与数据（Permissions & Data）

- **生成/桥接产物**：图片、视频、音频统一保存到 `MMX_OUT_DIR`（默认 `/tmp/mmx-out/`），经同源 `/mmx-files/` 提供（支持 Range、防目录穿越）。
- **附件读取**：桥接时从 DSH 附件存储（`attachments/v1`）按内容寻址读取图片字节，**只读不写**。
- **识别缓存写入**：只写回插件自建的 `bridge-*` 副本（位于 outDir 内）；**绝不修改** DSH 附件存储中的原始对象。
- **缓存是明文**：内嵌 JSON 未加密，懂文件结构的人可读——请勿在图片中放入不宜展示的信息。
- **重新编码即失效**：图片经社交平台转存/压缩/截图后，内嵌缓存因 sha256 不匹配自动失效，读取端显式告知而非静默返回旧数据。

## 常见问题（Troubleshooting）

<details>
<summary><b>Q: 安装后看不到 mmx_bridge 工具？</b></summary>

确认 DSH 版本 ≥ 0.1.0-rc.7，且 `mmx-cli` 已安装（`mmx --version`）。刷新 Web GUI 页面后重试。
</details>

<details>
<summary><b>Q: 拖入/粘贴图片还是报「当前模型不支持图片」？</b></summary>

请确认插件已升级到 **v1.0.5+** 并**重启 dsh**（服务端 ESM 缓存不热替换）、强刷页面；再到 设置 → 插件 → 插件配置 确认「图片桥」为「已启用」。本身支持图片输入的模型自动直通不受影响。
</details>

<details>
<summary><b>Q: 图片识别缓存命中/失效是怎么工作的？</b></summary>

识别结果以内嵌 JSON（PNG `tEXt`/JPEG `COM` 标准块）写回图片桥副本。同图同问题再次读取（`read_image` 或 `mmx_bridge(describe)`）直接复用并标注 `cached:true`，零 VLM 调用；不同问题（追问）各自分层缓存，互不覆盖；图片字节变化（重新编码）后缓存显式失效并自动重建。
</details>

<details>
<summary><b>Q: 设置页「插件配置」看不到 dsh-mmx-bridge 管理卡片？</b></summary>

需插件 **≥ 1.0.4** 并**重启 dsh**（服务端 ESM 缓存不热替换），再强刷 Web GUI 页面。
</details>

<details>
<summary><b>Q: 图片生成报错 "API key not found"？</b></summary>

先运行 `mmx auth login` 登录 MiniMax 账号。Token Plan 需确保套餐有效。
</details>

<details>
<summary><b>Q: 国内网络无法访问？</b></summary>

mmx-cli 直连 MiniMax API（api.minimax.chat），国内一般可直连。如遇问题检查代理设置。
</details>

## 开发（Development）

```bash
git clone https://github.com/welsione/dsh-mmx-bridge.git
cd dsh-mmx-bridge
npm test                 # 单元测试（图片缓存 / read_image 包装，真实 PNG/JPEG）
npm run check            # 语法检查（4 个 lib 文件）
dsh plugin --profile web add .   # 本地安装测试
```

**架构**

```
用户对话 → DSH Agent → mmx_bridge 工具 → mmx-cli → MiniMax API
                                                  ↓
                                           /mmx-files/ 同源服务
                                          （图片预览 / 音视频播放器）
识别结果 → imgjson 块内嵌回写图片（PNG tEXt / JPEG COM）→ 下次同图同问直接复用
```

- **无第三方运行时依赖**：Node 内置模块 + `@deepseek-ai` 生态包（宿主运行时提供）
- **同源产物服务**：生成的文件经 `/mmx-files/` 路径直接内嵌在对话中，支持 Range 请求
- **Web GUI 增强**：图片预览、音频/视频播放器、设置页管理卡片自动加载

## 许可证与安全（License & Security）

- **MIT**：[LICENSE](LICENSE)
- 不收集任何遥测；不读取系统凭据；不修改 DSH 附件存储
- 内嵌识别缓存为**明文**，无需保密信息；按需在写回前自行加密

---

## 相关项目

| 项目 | 说明 |
|:--|:--|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | DSH 本体 —— 一切皆插件的 Agent 框架 |
| [MiniMax CLI](https://github.com/MiniMax-AI/cli) | MiniMax 官方命令行工具 |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | DSH 插件精选集（本插件已收录） |
| [dsh-recommend](https://github.com/zp-home/dsh-recommend) | DSH 插件排行榜（本插件已收录） |

<p align="center">
  如果这个插件对你有帮助，欢迎给个 ⭐ Star 支持一下！
</p>