# Changelog

## [1.0.3] - 2026-08-16

### Fixed

- 设置页管理卡片支持折叠/展开（可点击头部、chevron 指示、展开态高亮），与 dsh-plugin-manager 原 card 交互一致

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
