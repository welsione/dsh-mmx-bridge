# Changelog

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
