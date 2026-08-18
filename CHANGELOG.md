# Changelog

## [1.1.0] - 2026-08-18

### Features

- **文本模型直接收图（界面零改动）**：拖入/粘贴图片后正常发送，消息（图片块＋提示词）在会话中**原样显示与存储**，不再报「当前模型不支持图片」。实现全在服务端，走 DSH 官方扩展点：
  - **能力声明**：包装 `ctx.llm.resolveModelInfo`（DSH 无模型能力装饰钩子，`registerAdapter` 不允许替换已注册 provider），对纯文本模型补声明 `image` 输入能力，使核心的图片准入检查放行——仅影响「是否允许图片块」判断，模型本身仍是文本模型；开关关闭时立即恢复原能力声明
  - **LLM 边界转换**：监听官方 `llm/stream` 瀑布事件，把消息里的图片块（base64 内联数据）解码落盘到 outDir（默认 `/tmp/mmx-out/`，文件名 `bridge-<sha1前10位>-<名>`，同图按内容哈希去重，经既有 `/mmx-files/` 路由同源访问），替换为「`[图片：名](URL) 本地文件：<path>`」文本后**重入** `llm.stream` 发送（`transforming` 标志防递归）；无图片块直通；原能力声明含 image 的真·视觉模型直通不转换
  - 消息内容不变，用户感知为「图片放进输入框，AI 就能识别」；Agent 收到地址后自动调用 `read_image` / `mmx_bridge(describe)` 看图
  - 控制文件新增 `imageBridgeEnabled` 开关（默认开，2 秒生效）；`settings.plugin.item` 设置卡片新增「文本模型直接收图（图片桥）」开关（`POST /api/mmx-bridge/set-enabled { plugin: "imagebridge" }`）；状态文件新增 `bridgeImages` 计数

### Changed

- `web_search` / `read_image` 接管开关**默认开启**（未配置即开，显式 `false` 才关闭）：装完即用 mmx 版搜索与 VLM 看图，无需手动开启

### Fixed

- 修复插件卸载清理时的 `ReferenceError: mgmtDispose is not defined`（`mgmtDispose` 声明在 `registerAll` 内层作用域、清理函数在外层引用；仅插件卸载/热重载时触发，正常运行不受影响）——声明提升至 effect 作用域
- 视觉调用（`read_image` / `mmx_bridge(describe)`）新增自动重试（最多 3 次带退避）：MiniMax 内容审核偶发抖动（同图可能一次报 `input image sensitive`、一次成功）

## [1.0.4] - 2026-08-17

### Fixed

- **设置页管理卡片在 DSH rc.7+ 不显示**：DSH rc.7 把 `settings.plugin.item` 槽改为 keyed 分发，设置页只渲染「key 匹配且命名空间已被服务端注册（`settings.describe()` 返回）」的卡片。修复两处叠加缺陷：
  - 客户端 `lib/client.js`：`settings.plugin.item` 槽注册补充 `key: "dsh-mmx-bridge"`（keyed 槽强制校验 `options.key`，此前仅声明 `id` 会直接抛 `keyed slot ... requires options.key`，卡片注册失败）；保留 `id` 以兼容 rc.6 的 list 槽，两代并存
  - 服务端 `lib/index.js`：新增 `installSettingsSection(ctx, settingsNamespace('dsh-mmx-bridge'), z.object({}), {}, { setSource(){}, onChange(){} })`，把 `dsh-mmx-bridge` 命名空间「服务」出去——这是 rc.7 设置页渲染卡片的前提（Host 端服务的命名空间 ∩ 客户端注册的 key 才渲染）。卡片实际读写仍走 `/api/mmx-bridge/*` 控制文件路由，故命名空间注册空 schema 即可（仅作服务标记，不重复承载配置状态）
  - `package.json`：补充依赖声明 —— `@deepseek-ai/dsh-settings`（peerDependencies，宿主 DSH 提供）、`@deepseek-ai/schemastery`（dependencies，始终需要）；模式与官方插件 `@deepseek-ai/dsh-agent-loop` 一致
- README（zh/en）图片改为绝对 GitHub 链接（`github.com/welsione/dsh-mmx-bridge/raw/main/docs/*.png`）：此前为相对路径 `docs/*.png`，npm 页面与部分渲染环境无法解析导致图片不显示；npm 包 `files` 不含 `docs/`，改绝对链接后 GitHub/npm 均可正常展示
- README 内 [AGENT.md] 链接改为绝对 blob 地址（`github.com/welsione/dsh-mmx-bridge/blob/main/AGENT.md`），避免在非 GitHub 渲染环境下点不到
- README（zh/en）「快速开始」新增**复制给 Agent 的安装提示词**（内嵌仓库地址与安装命令，客户直接粘贴给自己的 Agent 即可）；并修正安装说明：装完需**重启 dsh**（服务端 ESM 缓存不热替换），此前误写「无需重启」

## [1.0.3] - 2026-08-16

### Fixed

- 设置页管理卡片支持折叠/展开（可点击头部、chevron 指示、展开态高亮），与 dsh-plugin-manager 原 card 交互一致
- 修复：保存「每次生成图片数量」时保留 `webSearchEnabled` / `readImageEnabled` 字段（此前 set-config 会覆盖控制文件，导致接管开关状态丢失）

## [1.0.2] - 2026-08-16

### Features

- 内置管理面板：设置 → 插件 → 插件配置 出现 `dsh-mmx-bridge` 卡片（启停 / 生成数量 / `web_search` / `read_image` 开关），任何机器安装后即可配置，无需额外插件
- 新增管理路由：`GET /api/mmx-bridge/status`、`POST /api/mmx-bridge/set-enabled`（路径可用环境变量 `MMX_STATUS_PATH` / `MMX_SET_ENABLED_PATH` 覆盖）

### Fixed

- README 安装提示词自包含：内置仓库地址与 AGENT.md raw 链接、profile 确认方式、安装与验证要点——客服/用户直接复制即可，接收方 Agent 不再缺上下文
- AGENT.md 重写为可执行流程：区分 `dsh plugin` 自动挂载（声明 `dsh.bundle.patch`）与手动安装两条路径；明确**自动挂载后不得再手动添加挂载行**（loader insert 不按 id 去重，会挂载两次）
- AGENT.md 免重启验证四件套（包存在 / 服务端语法 / 客户端语法 / bundles 列表），Agent 无需重启即可确认安装成功；「重启」明确移交用户执行
- 修复手动安装示例符号链接指向旧包名 `dsh-mmx-multimodal` 的错误（应为 `dsh-mmx-bridge`）
- 前置条件补充 pnpm 检查（`dsh plugin` 即 pnpm 转发）与 profile 发现步骤；故障排查补充 pnpm 缺失 / EPERM 沙箱 / 重复挂载条目
- AGENTS.md 修正：路径仅经 `MMX_*` 环境变量配置（补丁层 loader entry 无 `ctx.config`）

## [1.0.1] - 2026-08-16

### Fixed

- 声明 `dsh.bundle` manifest（`cordis.patch.yml`），满足 `dsh plugin add` 的安装前提；patch 文件随 npm 包分发（`files` 列表补充）

## [1.0.0] - 2026-08-15

首个正式发布。

### Features

- `mmx_bridge` 工具：describe / image / video / speech / music / cover / search / quota，底层调用 MiniMax 官方 [mmx CLI](https://github.com/MiniMax-AI/cli)
- 产物经 `/mmx-files/` 同源 HTTP 提供（支持 Range、防目录穿越），结果携带 `url`/`urls`
- 自带客户端增强：工具卡片内嵌播放器/缩略图；正文媒体链接自动升级为图片预览或音视频播放器（含下载按钮与加载失败提示）
- 内置工具接管：`web_search` / `read_image` 可切换 mmx 版（控制文件开关，约 2 秒生效）
- 启动时序安全：工具与路由注册等待服务就绪，无冷启动竞态
- 图片文件名唯一（时间戳前缀），历史链接不失效
- 包形式发布：`dsh.client` 声明随包加载客户端；支持 `dsh plugin add` 安装

### Installation

```bash
dsh plugin --profile web add dsh-mmx-bridge
```

详见 [AGENT.md](AGENT.md)。
