# AGENT.md — 安装与运维指南（给 AI Agent）

> 本文件面向**安装/维护本插件的 AI Agent**，包含完整安装步骤、配置项、接管开关与故障排查。
> 用户只需在 README 中看到简介；**具体执行请以本文档为准**。

## 1. 这是什么

`dsh-mmx-bridge` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 MiniMax 多模态插件：

- 注册一个模型工具 `mmx_bridge`（describe / image / video / speech / music / cover / search / quota），底层调用 MiniMax 官方 [mmx CLI](https://github.com/MiniMax-AI/cli)（npm 包 `mmx-cli`）。
- 自带**客户端增强**：对话流里工具卡片渲染内嵌播放器/缩略图；消息正文的 `/mmx-files/*` 链接自动升级为图片预览或音视频播放器（含下载按钮、加载失败提示）。
- 可选**接管内置工具**：`web_search`（mmx 版搜索）、`read_image`（VLM 文字描述）。

## 2. 前置条件

```bash
npm install -g mmx-cli          # 安装 MiniMax CLI
mmx auth login --api-key sk-xxx # 鉴权（或 OAuth）
mmx auth status                 # 确认可用
```

- DSH profile 需支持补丁层插件（如 `web`）。
- Node.js ≥ 18。
- 网络能访问 GitHub（安装时可能需要代理）。

## 3. 安装步骤

```bash
# 1) 安装插件包（npm 官方源发布；网络受限时先设代理）
dsh plugin --profile web add dsh-mmx-bridge
#   等价于：cd ~/.dsh/profiles/web && pnpm add dsh-mmx-bridge
#   备选（git 依赖，未发布到 npm 时）：pnpm add github:welsione/dsh-mmx-bridge

# 2) 挂载：编辑 ~/.dsh/profiles/web/cordis.patch.yml，在 insert 列表加入：
#    - id: mmx-bridge
#      name: dsh-mmx-bridge

# 3) 重启 dsh（必须：补丁层启动时加载）
# 4) 验证服务端
cat /tmp/dsh-vision-status.json        # 期望 "ready": true
grep -E "tool registered|files route registered" /tmp/dsh-mmx-multimodal-debug.log  # 期望存在

# 5) 验证客户端（浏览器刷新页面后生效，无需重启）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/plugins/dsh-mmx-bridge/client.js   # 期望 200
```

> **手动安装（不用 dsh plugin 时）**：把包目录放入 `~/.dsh/profiles/<profile>/packages/dsh-mmx-bridge/`，
> 在 `node_modules/` 建符号链接 `ln -s ../packages/dsh-mmx-multimodal node_modules/dsh-mmx-bridge`，再加挂载行。

## 4. 更新插件

```bash
dsh plugin --profile web up dsh-mmx-bridge   # 或 cd ~/.dsh/profiles/web && pnpm up dsh-mmx-bridge
# 重启 dsh 生效（服务端 ESM 缓存不热替换）
```

## 5. 配置（环境变量，无 row config）

| 环境变量 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `MMX_BIN` | `/usr/local/bin/mmx` | mmx 二进制路径 |
| `MMX_OUT_DIR` | `/tmp/mmx-out` | 生成产物目录（经 `/mmx-files/<文件名>` 提供 HTTP 访问） |
| `MMX_CONTROL_FILE` | `/tmp/dsh-vision-control.json` | 控制文件（开关/出图数） |
| `MMX_STATUS_FILE` | `/tmp/dsh-vision-status.json` | 状态镜像文件 |
| `MMX_DEBUG_LOG` | `/tmp/dsh-mmx-multimodal-debug.log` | 调试日志 |

控制文件字段：

```json
{ "enabled": true, "count": 3, "webSearchEnabled": false, "readImageEnabled": false }
```

- `enabled`：`mmx_bridge` 工具总开关
- `count`：每次 `image` 出图数（1–8）
- `webSearchEnabled`：接管 `web_search`（mmx 版搜索）
- `readImageEnabled`：接管 `read_image`（VLM 文字描述，适合模型不支持图像输入的场合）

开关也可在 Web GUI **设置 → 插件 → 插件配置** 中操作（会写控制文件）。

## 6. 产物与 URL

- 生成文件保存到 `MMX_OUT_DIR`，经 `http://<host>:<port>/mmx-files/<文件名>` 提供（同源、支持 HTTP Range、防目录穿越）。
- 工具结果携带 `url`/`urls` 字段；图片文件名带时间戳前缀（`image-<ts>_001.jpg`），**每次生成唯一，历史链接不失效**。
- 视频默认模型 Hailuo-2.3 输出无音轨；`duration`/`ratio` 参数需 MiniMax-H3（账号支持时）。

## 7. 故障排查

| 现象 | 排查 |
| :-- | :-- |
| 工具不在模型工具列表 | 重启后查日志 `tool registered`；无则查 `apply OK` 是否存在；确认挂载行与包安装 |
| 状态文件 `ready: false` | 查 `MMX_DEBUG_LOG` 的 `tool init` 错误；`mmx auth status` 是否有效 |
| 找不到 mmx 二进制 | 安装 `mmx-cli`；设 `MMX_BIN` 绝对路径 |
| 对话流无内嵌播放器/图片预览 | 刷新页面；历史消息点「加载更早」；确认 client bundle 200 |
| `/mmx-files/*` 404 | 确认 `files route registered` 日志；文件是否在 `MMX_OUT_DIR` |
| 修改插件不生效 | 重启 dsh（ESM 模块缓存），或 `pnpm up` 后再重启 |
| 生成图片与描述不符 | 生成后先调用 `describe` 核实图片实际内容再向用户描述 |
