// read_image / mmx_bridge(describe) 缓存包装行为测试（命中路径，不触发真实 mmx CLI）。
// 通过插件 apply() 捕获注册的工具，直接调用 execute()。运行：node test/readimage-wrapper.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { makePng } from './fixture.mjs'
// 插件本体依赖宿主 DSH 提供的 @deepseek-ai/* 运行时包；在裸 checkout（如 CI）里没有它们，
// 无法 import 插件。与 sips/JPEG 用例同思路：能解析就完整跑，不能就优雅 SKIP。
// （本机装有插件的 profile 里始终完整运行；运行级 install 冒烟由 dsh-plugin-developer 的 test.mjs 覆盖。）
let plugin = null
let cacheModule = null
try {
  plugin = await import('../lib/index.js')
  cacheModule = await import('../lib/img-cache.js')
} catch (e) {
  if (e && e.code === 'ERR_MODULE_NOT_FOUND') {
    console.log('SKIP  read_image wrapper tests (host @deepseek-ai deps unavailable in bare checkout)')
    process.exit(0)
  }
  throw e
}

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, 'tmp')
mkdirSync(TMP, { recursive: true })
const OUT = join(TMP, 'out')
mkdirSync(OUT, { recursive: true })

process.env.MMX_CONTROL_FILE = join(TMP, 'control.json')
process.env.MMX_OUT_DIR = OUT
process.env.MMX_STATUS_FILE = join(TMP, 'status.json')
process.env.MMX_DEBUG_LOG = join(TMP, 'debug.log')

// 清理旧 bridge 文件（插件按 sha1 去重，同名残留会影响断言）与旧状态文件（计数持久化断言需要从零开始）
for (const f of readdirSync(OUT)) if (f.startsWith('bridge-')) { try { unlinkSync(join(OUT, f)) } catch (e) {} }
for (const f of ['status.json', 'control.json', 'debug.log']) { try { unlinkSync(join(TMP, f)) } catch (e) {} }

const img = join(OUT, 'bridge-cachewrap0001-photo.png')
makePng(img)

// 预置缓存：默认档 + 一个追问层
const w1 = cacheModule.writeImageCache(img, '', '预置通用描述', { outDir: OUT })
const w2 = cacheModule.writeImageCache(img, '帽子的颜色？', '预置追问答案：红色', { outDir: OUT })
if (!(w1.wrote && w2.wrote)) { console.error('FAIL 预置缓存写入失败', w1, w2); process.exit(1) }

const capturedTools = []
const capturedReadTools = []
const registeredRoutes = []
const ws = { host: '127.0.0.1', port: 3080, register(r) { registeredRoutes.push(r); return () => {} } }
// read_image 是 per-agent shadow：需要一个带 tools 服务的假 agent
const fakeAgent = {
  id: 'a1',
  ctx: {
    get(name) {
      if (name === 'tools') return { register: (t) => { capturedReadTools.push(t); return () => {} } }
      return undefined
    },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  },
}
const ctx = {
  get(name) {
    if (name === 'tools') return { register: (t) => { capturedTools.push(t); return () => {} } }
    if (name === 'webServer') return ws
    if (name === 'agents') return { list: () => [fakeAgent] }
    return undefined
  },
  on() {},
  inject(deps, cb) {
    if (typeof cb === 'function') {
      cb({ settings: { register: () => ({ get: () => ({}), watch: () => () => {} }) }, effect: () => () => {}, get: () => undefined })
    }
    return () => {}
  },
  effect(fn) { const d = fn(); if (typeof d === 'function') d(); return () => {} },
}
writeFileSync(process.env.MMX_CONTROL_FILE, JSON.stringify({ enabled: true, count: 3, imageBridgeEnabled: true }))
plugin.default.apply(ctx)

const readImageTool = capturedReadTools.find((t) => t.name === 'read_image')
const bridgeTool = capturedTools.find((t) => t.name === 'mmx_bridge')
if (!readImageTool || !bridgeTool) { console.error('FAIL 工具未注册', capturedTools.map((t) => t.name), capturedReadTools.map((t) => t.name)); process.exit(1) }

let pass = 0
let fail = 0
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''))
  ok ? pass++ : fail++
}

// 1) read_image 命中默认档缓存（不触发 mmx）——本地路径形态
{
  const r = await readImageTool.execute({ file_path: img }, { signal: undefined })
  check('read_image cached hit', r.cached === true && r.description === '预置通用描述', r)
}
// 1b) read_image 命中默认档缓存——插件自身 /mmx-files URL 形态（真实链路 Agent 拿到的是 URL）
{
  const url = 'http://127.0.0.1:3080/mmx-files/bridge-cachewrap0001-photo.png'
  const r = await readImageTool.execute({ file_path: url }, { signal: undefined })
  check('read_image cached hit via /mmx-files URL', r.cached === true && r.description === '预置通用描述', r)
}
// 2) describe 命中追问层（cached:true，且 answer 是追问答案不是通用描述）——本地路径形态
{
  const r = await bridgeTool.execute({ action: 'describe', image: img, prompt: '帽子的颜色？' }, { signal: undefined })
  check('describe follow-up cached hit', r.ok === true && r.cached === true && r.description === '预置追问答案：红色', r)
}
// 2b) describe 命中追问层——URL 形态
{
  const url = 'http://127.0.0.1:3080/mmx-files/bridge-cachewrap0001-photo.png'
  const r = await bridgeTool.execute({ action: 'describe', image: url, prompt: '帽子的颜色？' }, { signal: undefined })
  check('describe follow-up cached hit via /mmx-files URL', r.ok === true && r.cached === true && r.description === '预置追问答案：红色', r)
}
// 3) 未问过的 prompt → 缓存 miss（不返回 cached）—— 一致性由单元测试覆盖（不会走真实 VLM）
{
  const probe = cacheModule.readImageCache(img, '没问过的问题')
  check('untouched prompt cache miss (unit-level)', probe.hit === false && probe.reason === 'no-layer', probe)
}
// 4) 状态文件应含 imageCacheEnabled 与全部计数（含识图/工具调用；计数持久化字段）
{
  const lines = readFileSync(process.env.MMX_STATUS_FILE, 'utf8').trim().split('\n').filter(Boolean)
  const last = JSON.parse(lines[lines.length - 1])
  check('status has imageCacheEnabled(default true)', last.imageCacheEnabled === true, last.imageCacheEnabled)
  check('status has cacheHits >= 4', typeof last.cacheHits === 'number' && last.cacheHits >= 4, last.cacheHits)
  check('status has readImageCalls >= 2', typeof last.readImageCalls === 'number' && last.readImageCalls >= 2, last.readImageCalls)
  check('status has calls >= 2 (describe x2)', typeof last.calls === 'number' && last.calls >= 2, last.calls)
}
// 4b) 计数持久化：模拟重启 —— 用同一状态文件重新 apply（新进程内存清零），
//     启动恢复后计数应延续，且命中继续累计
{
  const captured2 = []
  const capturedRead2 = []
  const fakeAgent2 = {
    id: 'a2',
    ctx: {
      get(name) {
        if (name === 'tools') return { register: (t) => { capturedRead2.push(t); return () => {} } }
        return undefined
      },
      effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    },
  }
  const ctx2 = {
    get(name) {
      if (name === 'tools') return { register: (t) => { captured2.push(t); return () => {} } }
      if (name === 'webServer') return ws
      if (name === 'agents') return { list: () => [fakeAgent2] }
      return undefined
    },
    on() {},
    inject(deps, cb) {
      if (typeof cb === 'function') {
        cb({ settings: { register: () => ({ get: () => ({}), watch: () => () => {} }) }, effect: () => () => {}, get: () => undefined })
      }
      return () => {}
    },
    effect(fn) { const d = fn(); if (typeof d === 'function') d(); return () => {} },
  }
  plugin.default.apply(ctx2)
  const s1 = JSON.parse(readFileSync(process.env.MMX_STATUS_FILE, 'utf8').trim().split('\n').filter(Boolean).pop())
  const restored = s1.calls >= 2 && s1.readImageCalls >= 2 && s1.cacheHits >= 4
  check('restart restores counters from status file', restored, { calls: s1.calls, readImageCalls: s1.readImageCalls, cacheHits: s1.cacheHits })
  const readImageTool2 = capturedRead2.find((t) => t.name === 'read_image')
  const url = 'http://127.0.0.1:3080/mmx-files/bridge-cachewrap0001-photo.png'
  const r2 = await readImageTool2.execute({ file_path: url }, { signal: undefined })
  check('after restart cache keeps working (hit)', r2.cached === true && r2.description === '预置通用描述', r2)
  const s2 = JSON.parse(readFileSync(process.env.MMX_STATUS_FILE, 'utf8').trim().split('\n').filter(Boolean).pop())
  check('counters continue accumulating across restart', s2.readImageCalls === s1.readImageCalls + 1 && s2.cacheHits >= s1.cacheHits + 1, { before: s1.readImageCalls, after: s2.readImageCalls, hits: s2.cacheHits })
}
// 5) set-enabled 路由支持 imagecache
{
  const route = registeredRoutes.find((r) => r.kind === 'exact' && r.path === '/api/mmx-bridge/set-enabled')
  const req = new EventEmitter(); req.method = 'POST'
  let body = ''
  req.on = (ev, cb) => { if (ev === 'data') cb(JSON.stringify({ plugin: 'imagecache', enabled: false })); if (ev === 'end') process.nextTick(() => cb()) }
  const res = { statusCode: 0, body: '', writeHead(c) { this.statusCode = c }, end(p) { if (p !== undefined) this.body += p } }
  await new Promise((resolve) => { route.handler(req, res); setTimeout(resolve, 100) })
  const ctrl = JSON.parse(readFileSync(process.env.MMX_CONTROL_FILE, 'utf8'))
  check('set-enabled imagecache=false persisted', ctrl.imageCacheEnabled === false, ctrl)
  // 复位为缺省（删除键 = 默认开启）
  writeFileSync(process.env.MMX_CONTROL_FILE, JSON.stringify({ enabled: true, count: 3, imageBridgeEnabled: true }))
}
// 6) mmx 环境管理：状态字段 / set-config mmxBin 校验 / login 空 key 拒绝 / auth-status
{
  const s1 = JSON.parse(readFileSync(process.env.MMX_STATUS_FILE, 'utf8').trim().split('\n').filter(Boolean).pop())
  check('status has mmx env fields', typeof s1.mmxFound === 'boolean' && ['none', 'config', 'scan'].indexOf(s1.mmxSource) >= 0, { mmxFound: s1.mmxFound, mmxSource: s1.mmxSource })
  const setCfg = registeredRoutes.find((r) => r.kind === 'exact' && r.path === '/api/dsh-plugins/set-config')
  const post = (route, payload) => new Promise((resolve) => {
    const req = new EventEmitter(); req.method = 'POST'
    req.on = (ev, cb) => { if (ev === 'data') cb(JSON.stringify(payload)); if (ev === 'end') process.nextTick(() => cb()) }
    const res = { statusCode: 0, body: '', writeHead(c) { this.statusCode = c }, end(p) { if (p !== undefined) this.body += p; resolve({ code: this.statusCode, body: this.body }) } }
    route.handler(req, res)
  })
  const bad = await post(setCfg, { mmxBin: join(TMP, 'no-such-mmx') })
  check('set-config invalid mmxBin -> 400', bad.code === 400, { code: bad.code })
  const valid = join(TMP, 'fake-mmx.sh')
  writeFileSync(valid, '#!/bin/sh\necho fake\n')
  const good = await post(setCfg, { mmxBin: valid })
  check('set-config valid mmxBin -> 200', good.code === 200, { code: good.code })
  const ctrlA = JSON.parse(readFileSync(process.env.MMX_CONTROL_FILE, 'utf8'))
  check('control file stores mmxBin', ctrlA.mmxBin === valid, ctrlA.mmxBin)
  const clear = await post(setCfg, { mmxBin: '' })
  const ctrlB = JSON.parse(readFileSync(process.env.MMX_CONTROL_FILE, 'utf8'))
  check('set-config empty mmxBin clears + rescan', clear.code === 200 && ctrlB.mmxBin === undefined, { code: clear.code, mmxBin: ctrlB.mmxBin })
}
// 7) login 空 apiKey -> 400（不触发真实 mmx）
{
  const loginRoute = registeredRoutes.find((r) => r.kind === 'exact' && r.path === '/api/mmx-bridge/login-mmx')
  const req = new EventEmitter(); req.method = 'POST'
  req.on = (ev, cb) => { if (ev === 'data') cb(JSON.stringify({ apiKey: '' })); if (ev === 'end') process.nextTick(() => cb()) }
  const res = { statusCode: 0, body: '', writeHead(c) { this.statusCode = c }, end(p) { if (p !== undefined) this.body += p } }
  await new Promise((resolve) => { loginRoute.handler(req, res); setTimeout(resolve, 150) })
  check('login empty apiKey -> 400', res.statusCode === 400, { code: res.statusCode, body: (res.body || '').slice(0, 80) })
}
// 8) auth-status GET 返回结构化结果（mmx 可用时运行真实 CLI，超时兜底）
{
  const ar = registeredRoutes.find((r) => r.kind === 'exact' && r.path === '/api/mmx-bridge/auth-status')
  const req = new EventEmitter(); req.method = 'GET'; req.url = ar.path
  req.on = () => {}
  const res = { statusCode: 0, body: '', writeHead(c) { this.statusCode = c }, end(p) { if (p !== undefined) this.body += p } }
  await new Promise((resolve) => { ar.handler(req, res); setTimeout(resolve, 4000) })
  const parsed = JSON.parse((res.body || '{}'))
  check('auth-status returns structured result', ['no-mmx', 'ok', 'not-logged-in', 'error'].indexOf(parsed.state) >= 0, { state: parsed.state, code: res.statusCode })
}

console.log('\nread_image wrapper tests: ' + pass + ' passed / ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)