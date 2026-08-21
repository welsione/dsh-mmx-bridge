# AGENT.md — 安装与运维指南（给 AI Agent）

> 本文件面向**安装/维护本插件的 AI Agent**，包含完整安装步骤、配置项、接管开关与故障排查。
> 用户只需在 README 中看到简介；**具体执行请以本文档为准**。
>
> - 仓库：https://github.com/welsione/dsh-mmx-bridge
> - npm 包名：`dsh-mmx-bridge`（已发布，`dsh plugin add` 可直接装）

## 1. 这是什么

`dsh-mmx-bridge` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 MiniMax 多模态插件：

- 注册一个模型工具 `mmx_bridge`（describe / image / video / speech / music / cover / search / quota），底层调用 MiniMax 官方 [mmx CLI](https://github.com/MiniMax-AI/cli)（npm 包 `mmx-cli`）。
- `mmx_env` 工具：Agent 自查/修复 mmx 环境（`status / install / login / set-path`）。`mmx_bridge` 报环境错误（未找到 mmx / 未登录 / 命令错误）时，错误信息自带引导提示，模型可现场安装/登录/配置路径完成自助修复——用户在对话里即可完成配置，无需进设置卡。
- 自带**客户端增强**：对话流里工具卡片渲染内嵌播放器/缩略图；消息正文的 `/mmx-files/*` 链接自动升级为图片预览或音视频播放器（含下载按钮、加载失败提示）。
- 可选**接管内置工具**：`web_search`（mmx 版搜索）、`read_image`（VLM 文字描述）。
- **v1.0.5 聊天输入层图片桥（界面零改动）**：拖入/粘贴图片直接发送，你的消息（图片块＋提示词）在会话中**原样保留**。实现全在服务端、走 DSH 官方扩展点：
  - 能力声明：包装 `ctx.llm.resolveModelInfo`（DSH 无模型能力装饰钩子，`registerAdapter` 不允许替换已注册 provider，故包装公开方法），对纯文本模型补声明 `image` 输入能力，使核心的图片准入检查（`MODEL_DOES_NOT_SUPPORT_IMAGES`）放行；仅影响「是否允许图片块」判断，模型本身仍是文本模型；
  - LLM 边界转换：监听官方 `llm/stream` 瀑布事件，把消息里的图片块（base64 内联数据）解码落盘到 outDir（文件名 `bridge-<sha1前10位>-<名>`，同图去重），替换为「`[名](URL) 本地文件：<path>`」文本后**重入** `llm.stream` 发送（`transforming` 标志防递归）；无图片块直通；原能力声明含 image 的真·视觉模型直通；
  - 开关：控制文件 `imageBridgeEnabled`（默认开，2 秒缓存）或设置页卡片（`POST /api/mmx-bridge/set-enabled { plugin: "imagebridge" }`）。
- **v1.0.7 图片识别缓存（内嵌 JSON，默认开启）**：识别结果写回图片本身，同图同句再次读取直接复用，零 VLM 调用。
  - 内核：`lib/imgjson.mjs`（vendor 自 welsione/imgjson v0.3.0，零依赖）——PNG `tEXt` / JPEG `COM` 标准块原生嵌入，其余格式 EOF 兜底；
  - 缓存层：`lib/img-cache.js`（纯函数）——信封 `{v, tool, ts, layers: { <prompt>: { ts, sha256, description } }}`，**按 prompt 分层**，同 prompt 覆盖、新 prompt 增键、层数超 100 淘汰最旧；
  - 覆盖 `read_image`（默认档）与 `mmx_bridge(describe)`（按本次 prompt），命中返回 `cached:true`；图片重新编码后 sha256 不匹配→缓存显式失效并自动重建；
  - 只写回 outDir 内 `bridge-*` 副本，绝不触碰 attachments 存储；加密载荷/他人数据拒绝覆盖；原子写入。
  - 开关：控制文件 `imageCacheEnabled`（默认开）或设置页卡片（`POST /api/mmx-bridge/set-enabled { plugin: "imagecache" }`）；状态文件含 `cacheHits` / `cacheWrites` / `cacheStale`。

## 2. 前置条件

按顺序检查，缺什么补什么：

```bash
# 1) DSH profile：profile 目录在 ${DSH_HOME:-$HOME/.dsh}/profiles/<name>
ls "${DSH_HOME:-$HOME/.dsh}/profiles"     # 列出可用 profile
```

- 不确定装到哪个 profile：只有一个 profile 就直接用它；有多个时列出来向用户确认（Web GUI 场景通常是 `web`）。

```bash
# 2) Node.js ≥ 18
node -v

# 3) pnpm —— `dsh plugin` 本质是转发给 profile 目录下的 pnpm，没有 pnpm 走不了推荐安装路径
command -v pnpm || corepack enable         # corepack 不可用时：npm install -g pnpm

# 4) MiniMax CLI（不阻塞安装，只影响工具运行；装完插件再补也可以）
npm install -g mmx-cli
mmx auth login --api-key sk-xxx            # 或 OAuth
mmx auth status                            # 确认可用
```

- 网络需能访问 npm registry；访问 github.com 不稳定时，安装命令可能需要重试或走代理。

## 3. 安装步骤（推荐：`dsh plugin`，自动挂载）

`dsh plugin --profile <P> add dsh-mmx-bridge` 不只是安装：本包在 `package.json` 里声明了
`dsh.bundle.patch`，`dsh plugin` 会在安装后**自动**把 `dsh-mmx-bridge` 写入 profile 的
`dsh.profile.bundles`，随包自带的挂载行也会**自动生效**。

```bash
P=web   # ← 替换为第 2 节确认的 profile 名

# 0) 防重复挂载：检查 profile 的 cordis.patch.yml 是否已有手动的 mmx-bridge 挂载行
#    （insert 不按 id 去重；bundle 自动挂载 + 手动行 = 插件被挂载两次，工具重复注册）
grep -n "mmx-bridge" "$HOME/.dsh/profiles/$P/cordis.patch.yml" || echo "无手动挂载行，OK"
#    若上面 grep 命中了 - id: mmx-bridge 行：编辑该文件删掉这一行再继续。

# 1) 安装（npm 源）
dsh plugin --profile "$P" add dsh-mmx-bridge
#    网络受限备选（git 依赖；本包无构建脚本，不涉及 allowBuilds）：
#    dsh plugin --profile "$P" add github:welsione/dsh-mmx-bridge
#    注：profile 里原本是 github: 引用时，裸名 add 会把它改写成 registry 版本范围。
```

> ⚠️ **不要**再手动向 `~/.dsh/profiles/$P/cordis.patch.yml` 添加 `- id: mmx-bridge` 行。
> 自动挂载已包含它；重复添加 = 挂载两次。

### 免重启验证（Agent 执行到这里为止）

```bash
D="$HOME/.dsh/profiles/$P"
test -f "$D/node_modules/dsh-mmx-bridge/lib/index.js"          && echo "package OK"
node --check "$D/node_modules/dsh-mmx-bridge/lib/index.js"     && echo "server syntax OK"
node --check "$D/node_modules/dsh-mmx-bridge/lib/client.js"    && echo "client syntax OK"
grep -A8 '"dsh"' "$D/package.json" | grep dsh-mmx-bridge       && echo "bundle mounted OK"
# 可选（该命令会写 $D/cordis.yml，需要 profile 目录写权限）：
dsh --profile "$P" --dump-config | grep -A2 mmx-bridge         && echo "composed config OK"
```

前面四项 OK 即安装完成。**不要尝试重启 DSH**——Agent 通常就运行在 DSH 进程里，重启会杀掉
自己；把第 5 节转给用户执行即可。

## 4. 手动安装（备选：没有 pnpm，或直接用本地代码）

```bash
P=web
D="$HOME/.dsh/profiles/$P"
mkdir -p "$D/packages"
git clone https://github.com/welsione/dsh-mmx-bridge "$D/packages/dsh-mmx-bridge"
mkdir -p "$D/node_modules"
ln -sfn ../packages/dsh-mmx-bridge "$D/node_modules/dsh-mmx-bridge"
```

然后在 `$D/cordis.patch.yml` 的顶部数组追加（手动路径**没有**自动挂载，这一行是必须的）：

```yaml
- insert:
    - id: mmx-bridge
      name: dsh-mmx-bridge
```

验证同第 3 节；其中 `bundle mounted OK` 一项改为检查 `cordis.patch.yml` 中存在该挂载行。
使用手动路径时，后续也**不要**再执行 `dsh plugin add`（会触发自动挂载，与手动行叠加成两次）。

## 5. 交接用户：重启与重启后验证

安装只写文件，**运行中的 DSH 进程不会热加载**，需要用户：

1. 重启 DSH（按平日启动方式，如 `dsh --profile web web`，或重启对应服务）。
2. 重启后刷新 Web GUI 页面（客户端增强随之自动加载，无需任何手动合并）。

重启后验证（可由 Agent 代查，或对照现象）：

```bash
cat /tmp/dsh-vision-status.json   # 期望 "ready": true
grep -E "tool registered|files route registered" /tmp/dsh-mmx-multimodal-debug.log   # 期望有输出
# 客户端 bundle（端口按用户实际 GUI 端口，默认 3080）：
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/plugins/dsh-mmx-bridge/client.js   # 期望 200
```

- 新会话的工具列表出现 `mmx_bridge`。
- 跑一次低消耗调用验证链路：让 Agent 调 `mmx_bridge`，参数 `{"action":"quota"}`。

## 6. 更新插件

```bash
dsh plugin --profile web up dsh-mmx-bridge   # 或 cd ~/.dsh/profiles/web && pnpm up dsh-mmx-bridge
# 重启 dsh 生效（服务端 ESM 缓存不热替换）
```

手动安装路径的更新：`cd ~/.dsh/profiles/<P>/packages/dsh-mmx-bridge && git pull`，再重启。

## 7. 配置（环境变量）

| 环境变量 | 默认值 | 说明 |
| :-- | :-- | :-- |
| `MMX_BIN` | 平台默认（macOS `/usr/local/bin/mmx`；Windows `mmx`） | mmx 二进制路径（运行时解析：控制文件 `mmxBin` > `MMX_BIN` > 自动扫描） |
| `MMX_OUT_DIR` | 系统临时目录下 `mmx-out`（macOS/Linux 即 `/tmp/mmx-out`） | 生成产物目录（经 `/mmx-files/<文件名>` 提供 HTTP 访问） |
| `MMX_CONTROL_FILE` | 系统临时目录下 `dsh-vision-control.json` | 控制文件（开关/出图数/mmx 路径） |
| `MMX_STATUS_FILE` | 系统临时目录下 `dsh-vision-status.json` | 状态镜像文件 |
| `MMX_DEBUG_LOG` | 系统临时目录下 `dsh-mmx-multimodal-debug.log` | 调试日志 |
| `MMX_INSTALL_PATH` | `/api/mmx-bridge/install-mmx` | 一键安装 mmx-cli 路由 |
| `MMX_LOGIN_PATH` | `/api/mmx-bridge/login-mmx` | api-key 一键登录路由 |
| `MMX_AUTH_STATUS_PATH` | `/api/mmx-bridge/auth-status` | 登录状态查询路由 |

控制文件字段：

```json
{ "enabled": true, "count": 3, "webSearchEnabled": true, "readImageEnabled": true, "imageBridgeEnabled": true, "imageCacheEnabled": true, "mmxBin": "" }
```

- `enabled`：`mmx_bridge` 工具总开关
- `count`：每次 `image` 出图数（1–8）
- `webSearchEnabled`：接管 `web_search`（mmx 版搜索）。**未配置时默认开启**，显式设为 `false` 才关闭
- `readImageEnabled`：接管 `read_image`（VLM 文字描述，适合模型不支持图像输入的场合）。**未配置时默认开启**，显式设为 `false` 才关闭
- `imageCacheEnabled`：识别缓存（识别结果内嵌写回图片，同图同问复用）。**未配置时默认开启**，显式设为 `false` 才关闭
- `mmxBin`：mmx 可执行文件路径（留空/删除 = 自动扫描；设置卡「环境」区块可配置）

开关与 mmx 环境管理（发现/配置/一键安装/api-key 登录）均可在 Web GUI **设置 → 插件 → 插件配置** 中操作（内置管理面板卡片，随包提供，会写控制文件；无需额外安装面板插件）。

## 8. 产物与 URL

- 生成文件保存到 `MMX_OUT_DIR`，经 `http://<host>:<port>/mmx-files/<文件名>` 提供（同源、支持 HTTP Range、防目录穿越）。
- 工具结果携带 `url`/`urls` 字段；图片文件名带时间戳前缀（`image-<ts>_001.jpg`），**每次生成唯一，历史链接不失效**。
- 视频默认模型 Hailuo-2.3 输出无音轨；`duration`/`ratio` 参数需 MiniMax-H3（账号支持时）。

## 9. 故障排查

| 现象 | 排查 |
| :-- | :-- |
| **设置页有 `dsh-mmx-bridge` 卡片，但点开关报 404** | 客户端（磁盘读取，刷新即新）与服务端（进程启动时加载）版本错位：装完/升级后**没有重启 dsh**。重启用 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<port>/api/mmx-bridge/status` 应得 200；并确认装的版本 ≥ 1.0.2 |
| **设置页完全没有管理面板卡片** | 面板 1.0.2 起内置（此前是本地 dsh-plugin-manager 提供，未发布，换机即失）；1.0.2+ 仍无卡片 → 查安装版本（`node -e "console.log(require('<profile>/node_modules/dsh-mmx-bridge/package.json').version)"`）、刷新页面、确认 dsh 重启过。**DSH rc.7+ 需 ≥ 1.0.4**（rc.7 把设置卡片改为按服务端注册的 settings 命名空间分发，1.0.4 起插件注册 `dsh-mmx-bridge` 命名空间并带 `key`） |
| `dsh plugin` 报 `pnpm not found on PATH` | 先 `corepack enable` 或 `npm install -g pnpm`；或改走第 4 节手动安装 |
| 安装/验证时报 EPERM（写 profile 目录失败） | Agent 运行在文件沙箱时属正常；请用户授权写 `~/.dsh/profiles/<P>`，或换非沙箱终端执行 |
| 安装命令连 github.com 超时 | 重试；或改用 npm 源裸名 `dsh plugin --profile <P> add dsh-mmx-bridge` |
| 工具出现两次 / 注册报 duplicate | bundle 自动挂载与手动挂载行并存：删除 `cordis.patch.yml` 中手动的 `mmx-bridge` 行，重启 |
| 工具不在模型工具列表 | 重启后查日志 `tool registered`；无则查 `apply OK` 是否存在；确认挂载（bundles 列表或挂载行）与包安装 |
| 状态文件 `ready: false` | 查 `MMX_DEBUG_LOG` 的 `tool init` 错误；`mmx auth status` 是否有效 |
| 找不到 mmx 二进制 | 设置页「环境」区块**一键安装 mmx-cli**，或填真实路径保存；也可设 `MMX_BIN` 绝对路径 |
| 对话流无内嵌播放器/图片预览 | 刷新页面；历史消息点「加载更早」；确认 client bundle 200 |
| `/mmx-files/*` 404 | 确认 `files route registered` 日志；文件是否在 `MMX_OUT_DIR` |
| 修改插件不生效 | 重启 dsh（ESM 模块缓存），或 `pnpm up` 后再重启 |
| 生成图片与描述不符 | 生成后先调用 `describe` 核实图片实际内容再向用户描述 |
