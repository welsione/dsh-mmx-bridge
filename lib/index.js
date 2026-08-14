// dsh-mmx-bridge — MiniMax multimodal capability hub for DeepSeek Harness (DSH)
//
// v13: 文件路由支持 HTTP Range（206/416）—— 浏览器 video/audio 页面内播放必需。
// v10: 新增 HTTP 静态文件路由 —— 把 outDir 通过 webServer 前缀路由 <FILES_PREFIX>/ 暴露，
// 生成类动作结果返回 url/urls（同源 http://<host>:<port>/mmx-files/<文件名>），
// 对话里可直接点开播放/查看。前缀不带尾部斜杠（webserver 匹配会拼 `${prefix}/`）。
//
// Registers one model tool, `mmx_bridge`, that dispatches to the MiniMax
// `mmx` CLI (https://github.com/MiniMax-AI/cli, npm package `mmx-cli`):
//
//   describe = image understanding (VLM)      speech = text-to-speech
//   image    = text-to-image                  music  = music generation
//   video    = text/image-to-video            cover  = audio cover (voice clone)
//   search   = web search                     quota  = usage/balance query
//
// Generated files land in the configured outDir (default /tmp/mmx-out).
//
// Enable/disable and per-call settings live in a small JSON control file
// (default /tmp/dsh-vision-control.json): { "enabled": true, "count": 3 }.
// Runtime status is mirrored to a status file (default /tmp/dsh-vision-status.json).
// An optional webServer route (default POST /api/dsh-plugins/set-config) updates
// the control file, e.g. from a plugin-management settings page.
//
// The plugin deliberately uses node:child_process instead of ctx.subprocess so it
// also works from patch-layer contexts where the subprocess service is suspended.
//
// Every path below is configurable via an environment variable (MMX_*) with
// built-in defaults (zero-config on macOS/Linux). Note: patch-layer loader
// entries have no `config` service injection, so `ctx.config` is NOT available
// here — do not read it in this plugin.

import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync, readFileSync, existsSync, createReadStream, statSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'

export default {
  name: 'dsh-mmx-bridge',
  apply(ctx) {
    // 补丁层（loader entry）上下文没有 config 服务注入，不能访问 ctx.config；
    // 配置走环境变量（MMX_*）与内置默认值。
    const c = {}
    const env = process.env || {}

    const opts = {
      // Path to the mmx binary. Absolute path is tried first because the
      // patch-layer /bin/sh may have an unreliable PATH.
      mmxBin: c.mmxBin || env.MMX_BIN || '/usr/local/bin/mmx',
      // Where generated images / videos / audio are saved.
      outDir: c.outDir || env.MMX_OUT_DIR || '/tmp/mmx-out',
      // Control file: { enabled: boolean, count: number } — disable/enable and
      // images-per-generation. Set to null to always run with defaults.
      controlFile: c.controlFile || env.MMX_CONTROL_FILE || '/tmp/dsh-vision-control.json',
      // Status file mirrored after every call (null disables).
      statusFile: c.statusFile || env.MMX_STATUS_FILE || '/tmp/dsh-vision-status.json',
      // Optional debug log (null disables).
      debugLog: c.debugLog || env.MMX_DEBUG_LOG || '/tmp/dsh-mmx-multimodal-debug.log',
      // Images generated per `image` call (clamped to [1, 8]).
      defaultCount: clampNum(c.defaultCount, 3, 1, 8),
      // Kill a hung mmx child after this many ms (the tool timeout is 600s).
      timeoutMs: c.timeoutMs || 570000,
      // Optional webServer route to update the control file (null disables).
      setConfigPath: c.setConfigPath || '/api/dsh-plugins/set-config',
    }

    // 生成产物通过 webServer 前缀路由暴露（同源 http://<host>:<port>）。
    // 注意：前缀不带尾部斜杠 —— webserver 匹配用 `${prefix}/`，带尾斜杠会变成双斜杠导致子路径失配。
    const FILES_PREFIX = '/mmx-files'
    const MIME = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.srt': 'application/x-subrip',
      '.txt': 'text/plain; charset=utf-8',
      '.json': 'application/json',
    }

    const state = {
      ready: false,
      mmx: opts.mmxBin,
      initError: null,
      calls: 0,
      failures: 0,
      skipped: 0,
      lastError: null,
    }

    function clampNum(value, fallback, min, max) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
      return Math.min(max, Math.max(min, Math.round(value)))
    }

    // webServer 可能在补丁上下文缺位，先声明为 null；工具调用发生在 apply 之后，此时必已就绪。
    let webServer = null

    // 仅当文件位于 outDir 内时返回可访问 URL，否则返回 null（防目录穿越）
    function urlFor(file) {
      if (webServer === null || typeof file !== 'string' || !file) return null
      const resolved = resolve(file)
      const root = resolve(opts.outDir)
      if (resolved !== root && !resolved.startsWith(root + sep)) return null
      return 'http://' + webServer.host + ':' + webServer.port + FILES_PREFIX + '/' + encodeURIComponent(basename(resolved))
    }

    function exec(argv) {
      return execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
    }

    function dbg(message) {
      if (!opts.debugLog) return
      try {
        appendFileSync(opts.debugLog, new Date().toISOString() + ' [tool] ' + message + '\n')
      } catch (e) {}
    }

    // ── 服务就绪等待 ──────────────────────────────────────────────────────────
    // 补丁层 entry 与 bundle 服务在同一批事务里激活，apply 时 tools / webServer /
    // agents 可能尚未就绪（启动时序竞态）。ctx.get 可能返回 undefined 或抛错，
    // 都视为「未就绪」：轮询等待服务出现后再回调，避免注册被静默跳过。
    // 返回取消等待的 disposer。
    function waitForService(name, timeoutMs, cb) {
      const started = Date.now()
      let timer = null
      let settled = false
      const stop = () => {
        if (timer !== null) {
          clearInterval(timer)
          timer = null
        }
      }
      const probe = () => {
        let service
        try {
          service = ctx.get(name)
        } catch (e) {
          service = undefined
        }
        if (service !== undefined) {
          settled = true
          stop()
          try {
            cb(service)
          } catch (err) {
            dbg('waitForService(' + name + ') callback failed: ' + String(err && err.message ? err.message : err))
          }
          return
        }
        if (Date.now() - started > timeoutMs) {
          stop()
          dbg('service "' + name + '" not available after ' + timeoutMs + 'ms, giving up')
        }
      }
      probe()
      if (!settled && timer === null) {
        timer = setInterval(probe, 100)
      }
      return stop
    }

    function readControl() {
      if (!opts.controlFile) return {}
      try {
        if (!existsSync(opts.controlFile)) return {}
        const raw = readFileSync(opts.controlFile, 'utf8').trim()
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        if (parsed !== null && typeof parsed === 'object') return parsed
      } catch (e) {}
      return {}
    }

    // Effective runtime config: { enabled, count }, count clamped to [1, 8].
    function currentConfig() {
      const ctrl = readControl()
      const enabled = typeof ctrl.enabled === 'boolean' ? ctrl.enabled : true
      const count = clampNum(ctrl.count, opts.defaultCount, 1, 8)
      return { enabled, count }
    }

    function writeStatus() {
      if (!opts.statusFile) return
      const cfg = currentConfig()
      const ctrl = readControl()
      const payload = {
        ready: state.ready,
        enabled: cfg.enabled,
        count: cfg.count,
        webSearchEnabled: ctrl.webSearchEnabled === true,
        readImageEnabled: ctrl.readImageEnabled === true,
        mmx: state.mmx,
        initError: state.initError,
        calls: state.calls,
        failures: state.failures,
        skipped: state.skipped,
        lastError: state.lastError,
        at: new Date().toISOString(),
      }
      try {
        writeFileSync(opts.statusFile, JSON.stringify(payload) + '\n')
      } catch (e) {}
    }

    function init() {
      try {
        if (existsSync(opts.mmxBin)) {
          state.mmx = opts.mmxBin
        } else {
          const out = exec(['/bin/sh', '-c', 'command -v mmx']).trim()
          if (out.startsWith('/')) state.mmx = out.split(/\s+/)[0]
        }
        exec(['/bin/sh', '-c', 'mkdir -p ' + opts.outDir])
        state.ready = true
        dbg('tool init OK: mmx=' + state.mmx)
      } catch (err) {
        state.initError = String(err && err.message ? err.message : err)
        dbg('tool init FAILED: ' + state.initError)
      }
      writeStatus()
    }

    // Spawn mmx, collect stdout/stderr, resolve on exit; aborts with the
    // execution signal and SIGKILLs a hung child after timeoutMs.
    function execMmxAsync(args, signal) {
      return new Promise((resolve) => {
        let child
        try {
          child = spawn(state.mmx, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        } catch (err) {
          resolve({ code: -1, out: '', err: String(err && err.message ? err.message : err) })
          return
        }
        let out = ''
        let err = ''
        child.stdout.on('data', (d) => {
          out += d
        })
        child.stderr.on('data', (d) => {
          err += d
        })
        let done = false
        let code = null
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch (e) {}
        }, opts.timeoutMs)
        const onAbort = () => {
          try {
            child.kill('SIGKILL')
          } catch (e) {}
        }
        if (signal !== undefined && signal !== null) signal.addEventListener('abort', onAbort, { once: true })
        const finish = () => {
          if (done) return
          done = true
          clearTimeout(timer)
          if (signal !== undefined && signal !== null) signal.removeEventListener('abort', onAbort)
          resolve({ code, out, err })
        }
        child.on('error', (e) => {
          err = String(e && e.message ? e.message : e)
          finish()
        })
        child.on('close', (ch) => {
          code = ch
          finish()
        })
      })
    }

    function parseJson(r) {
      try {
        return JSON.parse(r.out)
      } catch (e) {
        return null
      }
    }

    function cleanLines(text) {
      return (text || '').trim().split('\n').filter((l) => l.length > 0)
    }

    async function handleDescribe(args, signal) {
      const image = typeof args.image === 'string' ? args.image.trim() : ''
      if (!image) return { ok: false, error: 'describe 需要 image 参数（本地路径或 URL）' }
      const prompt = typeof args.prompt === 'string' && args.prompt.trim() ? args.prompt : '请详细描述这张图片的内容，包括文字、对象、场景、颜色、布局等细节。'
      const r = await execMmxAsync(['vision', 'describe', '--image', image, '--prompt', prompt, '--output', 'json', '--quiet', '--non-interactive'], signal)
      if (r.code !== 0) return { ok: false, error: (r.err || 'exit ' + r.code).slice(0, 500) }
      const parsed = parseJson(r)
      const content = parsed !== null && typeof parsed === 'object' && typeof parsed.content === 'string' ? parsed.content : ''
      if (!content.trim()) return { ok: false, error: 'VLM 返回空描述' }
      return { ok: true, action: 'describe', description: content }
    }

    // Text-to-image: generates currentConfig().count images (default 3).
    async function handleImage(args, signal) {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (!prompt) return { ok: false, error: 'image 生成需要 prompt' }
      const cfg = currentConfig()
      // 唯一文件名前缀：mmx CLI 默认输出 image_001.jpg 等固定名，每次生成会覆盖
      // 同名文件，导致所有历史链接都指向最新一次生成的内容（跨对话图片串号）。
      // 用 image-<时间戳>- 前缀让每次生成的 URL 唯一，历史链接永久有效。
      const imgPrefix = 'image-' + Date.now() + '_'
      const argv = ['image', 'generate', '--prompt', prompt, '--n', String(cfg.count), '--out-dir', opts.outDir, '--out-prefix', imgPrefix, '--output', 'json', '--quiet', '--non-interactive']
      if (typeof args.aspectRatio === 'string' && args.aspectRatio) argv.push('--aspect-ratio', args.aspectRatio)
      const r = await execMmxAsync(argv, signal)
      if (r.code !== 0) return { ok: false, error: (r.err || 'exit ' + r.code).slice(0, 500) }
      let files = []
      try {
        const parsed = parseJson(r)
        if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.saved)) files = parsed.saved
      } catch (e) {}
      if (files.length === 0) files = cleanLines(r.out)
      const result = { ok: true, action: 'image', files, count: cfg.count, note: '图片已保存到 ' + opts.outDir + '/' }
      const urls = files.map((f) => urlFor(f)).filter((u) => u !== null)
      if (urls.length > 0) result.urls = urls
      return result
    }

    async function handleVideo(args, signal) {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (!prompt) return { ok: false, error: 'video 生成需要 prompt' }
      const outFile = opts.outDir + '/video-' + Date.now() + '.mp4'
      const argv = ['video', 'generate', '--prompt', prompt, '--download', outFile, '--output', 'json', '--quiet', '--non-interactive']
      if (typeof args.image === 'string' && args.image) argv.push('--image', args.image)
      if (typeof args.duration === 'number') argv.push('--duration', String(args.duration))
      if (typeof args.ratio === 'string' && args.ratio) argv.push('--ratio', args.ratio)
      const r = await execMmxAsync(argv, signal)
      if (r.code !== 0) return { ok: false, error: (r.err || 'exit ' + r.code).slice(0, 500) }
      const result = { ok: true, action: 'video', file: outFile, note: '视频已保存到 ' + outFile + '（生成可能耗时数分钟）', raw: cleanLines(r.out) }
      const url = urlFor(outFile)
      if (url !== null) result.url = url
      return result
    }

    async function handleSpeech(args, signal) {
      const text = typeof args.text === 'string' ? args.text : ''
      if (!text.trim()) return { ok: false, error: 'speech 需要 text 参数' }
      const outFile = typeof args.out === 'string' && args.out ? args.out : opts.outDir + '/speech-' + Date.now() + '.mp3'
      const argv = ['speech', 'synthesize', '--text', text, '--out', outFile, '--quiet', '--non-interactive']
      if (typeof args.voice === 'string' && args.voice) argv.push('--voice', args.voice)
      const r = await execMmxAsync(argv, signal)
      if (r.code !== 0) return { ok: false, error: (r.err || 'exit ' + r.code).slice(0, 500) }
      const result = { ok: true, action: 'speech', file: outFile }
      const url = urlFor(outFile)
      if (url !== null) result.url = url
      return result
    }

    async function handleMusic(args, signal) {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (!prompt) return { ok: false, error: 'music 需要 prompt' }
      const outFile = typeof args.out === 'string' && args.out ? args.out : opts.outDir + '/music-' + Date.now() + '.mp3'
      const argv = ['music', 'generate', '--prompt', prompt, '--out', outFile, '--quiet', '--non-interactive']
      const instrumental = args.instrumental === true
      const lyrics = typeof args.lyrics === 'string' && args.lyrics.trim() ? args.lyrics.trim() : ''
      if (instrumental) argv.push('--instrumental')
      else if (lyrics) argv.push('--lyrics', lyrics)
      else argv.push('--lyrics-optimizer')
      const r = await execMmxAsync(argv, signal)
      if (r.code !== 0) return { ok: false, error: (r.err || 'exit ' + r.code).slice(0, 500) }
      const result = { ok: true, action: 'music', file: outFile }
      const url = urlFor(outFile)
      if (url !== null) result.url = url
      return result
    }

    async function handleCover(args, signal) {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (!prompt) return { ok: false, error: 'cover 需要 prompt（目标风格）' }
      const audio = typeof args.audio === 'string' ? args.audio.trim() : ''
      if (!audio) return { ok: false, error: 'cover 需要 audio（参考音频本地路径或 URL）' }
      const outFile = typeof args.out === 'string' && args.out ? args.out : opts.outDir + '/cover-' + Date.now() + '.mp3'
      const r = await execMmxAsync(['music', 'cover', '--prompt', prompt, '--audio-file', audio, '--out', outFile, '--quiet', '--non-interactive'], signal)
      if (r.code !== 0) return { ok: false, error: (r.err || 'exit ' + r.code).slice(0, 500) }
      const result = { ok: true, action: 'cover', file: outFile }
      const url = urlFor(outFile)
      if (url !== null) result.url = url
      return result
    }

    async function handleSearch(args, signal) {
      const q = typeof args.q === 'string' ? args.q.trim() : ''
      if (!q) return { ok: false, error: 'search 需要 q 参数' }
      const r = await execMmxAsync(['search', 'query', '--q', q, '--output', 'json', '--quiet', '--non-interactive'], signal)
      if (r.code !== 0) return { ok: false, error: (r.err || 'exit ' + r.code).slice(0, 500) }
      return { ok: true, action: 'search', results: parseJson(r) }
    }

    async function handleQuota(signal) {
      const r = await execMmxAsync(['quota', 'show', '--output', 'json', '--quiet', '--non-interactive'], signal)
      if (r.code !== 0) return { ok: false, error: (r.err || 'exit ' + r.code).slice(0, 500) }
      return { ok: true, action: 'quota', quota: parseJson(r) }
    }

    // ── web_search shadow ─────────────────────────────────────────────────────
    // 与内置 web_search 相同 schema 的 mmx 版工具。默认不注册；仅当控制文件
    // `webSearchEnabled === true` 时，在**每个 agent 的作用域**注册同名 shadow，
    // 由 tools 服务的作用域覆盖规则替换该 agent 看到的全局内置 web_search。
    // 关闭开关后 dispose shadow，立即恢复内置搜索 —— 全程无需重启。
    function projectMmxSearch(r) {
      const parsed = parseJson(r)
      const organic = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.organic) ? parsed.organic : []
      const sources = []
      for (const item of organic) {
        if (item === null || typeof item !== 'object') continue
        const url = typeof item.link === 'string' ? item.link : ''
        if (!url) continue
        const source = { url }
        if (typeof item.title === 'string' && item.title) source.title = item.title
        if (typeof item.snippet === 'string' && item.snippet) source.snippet = item.snippet
        if (typeof item.date === 'string' && item.date) source.publishedAt = item.date
        sources.push(source)
      }
      return { sources, truncated: false }
    }

    const webSearchTool = {
      name: 'web_search',
      description:
        '搜索网络以获取当前信息（mmx-cli 版）。返回可选摘要与来源 URL 列表；' +
        '可用时使用返回的来源摘要，并在回答中以 markdown 链接引用相关 URL。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词。' },
        },
        required: ['query'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string' },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                  snippet: { type: 'string' },
                  publishedAt: { type: 'string' },
                },
                required: ['url'],
              },
            },
            truncated: { type: 'boolean' },
          },
          required: ['sources', 'truncated'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      timeoutMs: 60000,
      async execute(args, exec) {
        const query = args !== null && typeof args === 'object' && typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) throw new Error('web_search: query 不能为空')
        const r = await execMmxAsync(['search', 'query', '--q', query, '--output', 'json', '--quiet', '--non-interactive'], exec.signal)
        if (r.code !== 0) throw new Error((r.err || 'exit ' + r.code).slice(0, 500))
        return projectMmxSearch(r)
      },
    }

    // read_image 的 mmx 版 shadow（VLM 文字描述替代图片块）。
    // 适用场景：当前模型不支持图像输入（图片块会被路由降级），或需要
    // 图片的纯文字化描述。参数名与内置一致（file_path），模型调用习惯无感知。
    const readImageTool = {
      name: 'read_image',
      description:
        '读取图片并返回详细的文字描述（mmx-cli 版，MiniMax VLM 转写）。' +
        '适用于当前模型不支持图像输入、或需要图片文字化描述的场合；' +
        'file_path 支持本地路径或 URL。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '图片文件路径（本地路径或 URL）' },
        },
        required: ['file_path'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: value !== null && typeof value === 'object' && typeof value.description === 'string' ? value.description : JSON.stringify(value, null, 2) }],
      },
      timeoutMs: 120000,
      async execute(args, exec) {
        const filePath = args !== null && typeof args === 'object' && typeof args.file_path === 'string' ? args.file_path.trim() : ''
        if (!filePath) throw new Error('read_image: file_path 不能为空')
        const r = await execMmxAsync(['vision', 'describe', '--image', filePath, '--output', 'json', '--quiet', '--non-interactive'], exec.signal)
        if (r.code !== 0) throw new Error((r.err || 'exit ' + r.code).slice(0, 500))
        const parsed = parseJson(r)
        const description = parsed !== null && typeof parsed === 'object' && typeof parsed.content === 'string' ? parsed.content : ''
        if (!description.trim()) throw new Error('read_image: VLM 返回空描述')
        return { path: filePath, description }
      },
    }

    // 每个 live agent 的 scoped shadow 注册（web_search + read_image；agent fiber 销毁时自动清理）。
    const shadows = new Map()
    const readShadows = new Map()
    let lastControlSnapshot = ''

    function readControlSnapshot() {
      try {
        if (!existsSync(opts.controlFile)) return ''
        const raw = readFileSync(opts.controlFile, 'utf8').trim()
        return raw || ''
      } catch (e) {
        return ''
      }
    }

    // 注册一个 shadow 工具到 agent 作用域（同名覆盖内置），返回其 disposer。
    function registerShadow(agent, tool, label) {
      return agent.ctx.effect(() => {
        const tools = agent.ctx.get('tools')
        if (tools === undefined) return () => {}
        try {
          return tools.register(tool)
        } catch (err) {
          dbg(label + ' register failed for agent ' + agent.id + ': ' + String(err && err.message ? err.message : err))
          return () => {}
        }
      }, 'dsh-mmx-bridge: ' + label)
    }

    // 同步单个 agent 的 shadow 集合（web_search + read_image 各自独立开关）。
    function syncOne(agent) {
      if (agent === null || typeof agent !== 'object' || !agent.id || !agent.ctx) return
      const ctrl = readControl()
      // ── web_search shadow ──
      const enabled = ctrl.webSearchEnabled === true
      const existing = shadows.get(agent.id)
      if (enabled && !existing) {
        try {
          const dispose = registerShadow(agent, webSearchTool, 'web_search shadow')
          shadows.set(agent.id, dispose)
          dbg('web_search shadow ON for agent ' + agent.id)
        } catch (err) {
          dbg('web_search shadow effect failed for agent ' + agent.id + ': ' + String(err && err.message ? err.message : err))
        }
      } else if (!enabled && existing) {
        try {
          existing()
        } catch (e) {}
        shadows.delete(agent.id)
        dbg('web_search shadow OFF for agent ' + agent.id)
      }
      // ── read_image shadow ──
      const readEnabled = ctrl.readImageEnabled === true
      const readExisting = readShadows.get(agent.id)
      if (readEnabled && !readExisting) {
        try {
          const dispose = registerShadow(agent, readImageTool, 'read_image shadow')
          readShadows.set(agent.id, dispose)
          dbg('read_image shadow ON for agent ' + agent.id)
        } catch (err) {
          dbg('read_image shadow effect failed for agent ' + agent.id + ': ' + String(err && err.message ? err.message : err))
        }
      } else if (!readEnabled && readExisting) {
        try {
          readExisting()
        } catch (e) {}
        readShadows.delete(agent.id)
        dbg('read_image shadow OFF for agent ' + agent.id)
      }
    }

    function syncAll() {
      let agents
      try {
        agents = ctx.get('agents')
      } catch (e) {
        agents = undefined
      }
      if (agents === undefined) return // 服务未就绪，2 秒轮询会重试
      let list = []
      try {
        list = agents.list() || []
      } catch (e) {
        dbg('agents.list failed: ' + String(e && e.message ? e.message : e))
        return
      }
      for (const agent of list) syncOne(agent)
    }

    function maybeSyncAll() {
      const snapshot = readControlSnapshot()
      if (snapshot === lastControlSnapshot) return
      lastControlSnapshot = snapshot
      dbg('control file changed, resyncing shadows')
      syncAll()
    }

    ctx.on('agent/created', (payload) => {
      const agent = payload !== null && typeof payload === 'object' ? payload.agent : undefined
      if (agent) syncOne(agent)
    })

    const tool = {
      name: 'mmx_bridge',
      description:
        'MiniMax 多模态能力总入口（mmx-cli）。action 分发：' +
        'describe=图片理解（VLM，image 传本地路径或 URL）；' +
        'image=文生图（prompt，可带 aspectRatio；一次生成多张，数量可在控制文件配置，默认 3 张）；' +
        'video=文/图生视频（prompt，可带 image/duration/ratio，同步等待完成）；' +
        'speech=语音合成（text，可带 voice）；' +
        'music=音乐生成（prompt，可带 lyrics 或 instrumental）；' +
        'cover=音频翻唱（prompt + audio 参考音频）；' +
        'search=联网搜索（q）；quota=用量查询。' +
        '生成产物统一保存到 ' + opts.outDir + '，结果同时返回可播放/查看的 URL（' + FILES_PREFIX + '/<文件名>，同源 HTTP），可直接在页面打开。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'describe | image | video | speech | music | cover | search | quota' },
          prompt: { type: 'string', description: '生成类动作的提示词；describe 时可作为对图片的问题（省略则默认详细描述）' },
          image: { type: 'string', description: '图片本地路径或 URL（describe 的输入图；video 的 i2v 起始图）' },
          audio: { type: 'string', description: 'cover 的参考音频本地路径或 URL' },
          text: { type: 'string', description: 'speech 的合成文本' },
          voice: { type: 'string', description: 'speech 音色 ID（默认 English_expressive_narrator）' },
          q: { type: 'string', description: 'search 关键词' },
          lyrics: { type: 'string', description: 'music 歌词（带 [Verse]/[Chorus] 等结构标签）；省略时自动生成' },
          instrumental: { type: 'boolean', description: 'music 纯音乐（无歌词）' },
          aspectRatio: { type: 'string', description: 'image 纵横比，如 16:9、1:1' },
          duration: { type: 'number', description: 'video 时长（4-15 秒，默认 5）' },
          ratio: { type: 'string', description: 'video 纵横比：16:9、9:16、1:1 等' },
          out: { type: 'string', description: 'speech/music/cover 的保存路径（可选，默认 ' + opts.outDir + '）' },
        },
        required: ['action'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      timeoutMs: 600000,
      async execute(args, exec) {
        const cfg = currentConfig()
        if (!cfg.enabled) {
          state.skipped++
          writeStatus()
          return { ok: false, error: 'mmx_bridge 已停用（在控制文件 ' + opts.controlFile + ' 中设置 enabled: true 可重新启用）' }
        }
        const a = args !== null && typeof args === 'object' ? args : {}
        const action = typeof a.action === 'string' ? a.action.trim() : ''
        state.calls++
        let result
        try {
          switch (action) {
            case 'describe': result = await handleDescribe(a, exec.signal); break
            case 'image': result = await handleImage(a, exec.signal); break
            case 'video': result = await handleVideo(a, exec.signal); break
            case 'speech': result = await handleSpeech(a, exec.signal); break
            case 'music': result = await handleMusic(a, exec.signal); break
            case 'cover': result = await handleCover(a, exec.signal); break
            case 'search': result = await handleSearch(a, exec.signal); break
            case 'quota': result = await handleQuota(exec.signal); break
            default:
              result = { ok: false, error: '未知 action：' + action + '（可选 describe/image/video/speech/music/cover/search/quota）' }
          }
        } catch (e) {
          result = { ok: false, error: String(e && e.message ? e.message : e).slice(0, 500) }
        }
        if (!result.ok) {
          state.failures++
          state.lastError = result.error
        }
        writeStatus()
        return result
      },
    }

    // Register the tool once the tools service is up (startup race: the patch
    // layer activates in the same transaction as the bundles that own tools).
    // A short retry still heals hot-reload double-registration races.
    ctx.effect(() => {
      let stopWait = () => {}
      let dispose = null
      let timer = null
      let n = 0
      const doRegister = (tools) => {
        const attempt = () => {
          try {
            dispose = tools.register(tool)
            if (timer !== null) {
              clearInterval(timer)
              timer = null
            }
            dbg('tool registered' + (n > 0 ? ' (retry ' + n + ')' : ''))
          } catch (err) {
            dbg('tool register failed: ' + String(err && err.message ? err.message : err))
          }
        }
        attempt()
        if (dispose === null) {
          timer = setInterval(() => {
            n++
            attempt()
            if (dispose !== null || n >= 8) {
              clearInterval(timer)
              timer = null
            }
          }, 1000)
        }
      }
      stopWait = waitForService('tools', 60000, doRegister)
      return () => {
        stopWait()
        if (timer !== null) clearInterval(timer)
        if (dispose !== null) dispose()
      }
    })

    // ── 静态文件路由 ─────────────────────────────────────────────────────────
    // GET/HEAD <FILES_PREFIX>/<文件名> → 流式返回 outDir 内的生成产物。
    // 仅服务 outDir 目录内文件（resolve 后前缀校验，防目录穿越）。
    function handleFileRequest(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain', 'allow': 'GET, HEAD' })
        res.end('method not allowed')
        return
      }
      let name = ''
      try {
        name = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(FILES_PREFIX.length).replace(/^\/+/, ''))
      } catch (e) {}
      if (!name) {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end('bad request')
        return
      }
      const root = resolve(opts.outDir)
      const file = resolve(root, name)
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403, { 'content-type': 'text/plain' })
        res.end('forbidden')
        return
      }
      let stat
      try {
        stat = statSync(file)
      } catch (e) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
      if (!stat.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
      const fileName = basename(file)
      const dot = fileName.lastIndexOf('.')
      const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
      const type = MIME[ext] || 'application/octet-stream'
      const total = stat.size
      // HTTP Range 支持（单 range）：bytes=start-end / bytes=start- / bytes=-suffix。
      // 浏览器 <video>/<audio> 播放媒体文件依赖 Range，必须返回 206 Partial Content。
      let start = 0
      let end = total - 1
      let partial = false
      const rangeHeader = req.headers.range
      if (typeof rangeHeader === 'string' && rangeHeader.indexOf('bytes=') === 0) {
        const m = /^(\d*)-(\d*)$/.exec(rangeHeader.slice(6).trim())
        if (m !== null && (m[1] !== '' || m[2] !== '')) {
          const s = m[1] === '' ? -1 : Number(m[1])
          const e = m[2] === '' ? -1 : Number(m[2])
          if (Number.isFinite(s) && s >= 0 && s < total && (e === -1 || (Number.isFinite(e) && e >= s))) {
            // bytes=start-end / bytes=start-（开区间，浏览器 seek 常用）
            start = s
            end = e === -1 ? total - 1 : Math.min(e, total - 1)
            partial = true
          } else if (m[1] === '' && Number.isFinite(e) && e > 0) {
            // bytes=-suffix：最后 e 字节
            start = Math.max(0, total - e)
            end = total - 1
            partial = true
          } else if (Number.isFinite(s) && s >= total) {
            // 完全越界：416 Range Not Satisfiable
            res.writeHead(416, {
              'content-range': 'bytes */' + total,
              'accept-ranges': 'bytes',
              'cache-control': 'no-store',
            })
            res.end()
            return
          }
        }
      }
      const base = {
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      }
      if (partial) {
        res.writeHead(206, Object.assign({
          'content-type': type,
          'content-range': 'bytes ' + start + '-' + end + '/' + total,
          'content-length': String(end - start + 1),
        }, base))
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        createReadStream(file, { start: start, end: end }).on('error', () => {
          res.destroy()
        }).pipe(res)
        return
      }
      res.writeHead(200, Object.assign({
        'content-type': type,
        'content-length': String(total),
      }, base))
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(file).on('error', () => {
        res.destroy()
      }).pipe(res)
    }

    // Optional management route: POST <setConfigPath> { count } updates the
    // control file (preserving `enabled`). Registered with the same retry
    // self-healing used for the tool, so hot reloads never roll the fiber back.
    // The webServer service is awaited like tools (startup race).
    {
      function json(res, code, payload) {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      ctx.effect(() => {
        let stopWait = () => {}
        let setConfigDispose = null
        let filesDispose = null
        const registerAll = (ws) => {
          webServer = ws // 供 urlFor 使用
          let timer = null
          let n = 0
          const attempt = () => {
            try {
              if (!opts.setConfigPath) return // 配置关闭：跳过 set-config 路由
              setConfigDispose = ws.register({
                kind: 'exact',
                path: opts.setConfigPath,
              handler: (req, res) => {
                if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' })
                let body = ''
                req.on('data', (chunk) => {
                  body += chunk
                  if (body.length > 4096) req.destroy()
                })
                req.on('end', () => {
                  try {
                    const parsed = JSON.parse(body || '{}')
                    const count = Number(parsed.count)
                    if (!Number.isFinite(count)) return json(res, 400, { ok: false, error: 'count 必须是数字' })
                    const clamped = Math.min(8, Math.max(1, Math.round(count)))
                    const prev = readControl()
                    const enabled = typeof prev.enabled === 'boolean' ? prev.enabled : true
                    writeFileSync(opts.controlFile, JSON.stringify({ enabled, count: clamped }))
                    dbg('set-config count=' + clamped)
                    json(res, 200, { ok: true, plugin: 'mmx-bridge', count: clamped })
                  } catch (e) {
                    json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) })
                  }
                })
              },
            })
              if (timer !== null) clearInterval(timer)
              dbg('set-config route registered' + (n > 0 ? ' (retry ' + n + ')' : ''))
            } catch (err) {
              dbg('set-config route register failed: ' + String(err && err.message ? err.message : err))
            }
          }
          attempt()
          if (setConfigDispose === null) {
            timer = setInterval(() => {
              n++
              attempt()
              if (setConfigDispose !== null || n >= 8) {
                clearInterval(timer)
                timer = null
              }
            }, 1000)
          }
          // 静态文件路由（前缀，longest-prefix-wins）
          let timer2 = null
          let n2 = 0
          const attempt2 = () => {
            try {
              filesDispose = ws.register({
                kind: 'prefix',
                path: FILES_PREFIX,
                handler: handleFileRequest,
              })
              if (timer2 !== null) clearInterval(timer2)
              dbg('files route registered: ' + FILES_PREFIX + ' (http://' + ws.host + ':' + ws.port + ')')
            } catch (err) {
              dbg('files route register failed: ' + String(err && err.message ? err.message : err))
            }
          }
          attempt2()
          if (filesDispose === null) {
            timer2 = setInterval(() => {
              n2++
              attempt2()
              if (filesDispose !== null || n2 >= 8) {
                clearInterval(timer2)
                timer2 = null
              }
            }, 1000)
          }
        }
        stopWait = waitForService('webServer', 60000, registerAll)
        return () => {
          stopWait()
          if (setConfigDispose !== null) setConfigDispose()
          if (filesDispose !== null) filesDispose()
        }
      })
    }

    ctx.effect(() => {
      dbg('plugin apply OK (waiting for services before registering)')
      init()
      lastControlSnapshot = readControlSnapshot()
      syncAll()
      const poll = setInterval(() => {
        try {
          maybeSyncAll()
        } catch (e) {
          dbg('web_search shadow poll error: ' + String(e && e.message ? e.message : e))
        }
      }, 2000)
      return () => clearInterval(poll)
    })
  },
}
