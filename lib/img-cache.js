// lib/img-cache.js — read_image / mmx_bridge(describe) 识别缓存层（纯函数，无 ctx 依赖，可单测）。
//
// 机制：识别结果以「单个 imgjson 块」写回图片本身（JPEG/PNG 原生 COM/tEXt，其余格式 EOF 兜底），
// 块内是按 prompt 键值分层的 map —— 同一张图的通用描述与各次追问答案并存、互不覆盖：
//
//   { v:1, tool:"dsh-mmx-bridge", ts, layers: { "<prompt>": { ts, sha256, description } } }
//
// 命中条件 = 对应键存在 且 该键的 sha256 与当前「纯图片字节」哈希一致；不满足即该层失效
// （stale）。同 prompt 重复识别 → 覆盖该键（不新增块、不膨胀）；新 prompt → 增键。
// URL/远程不参与（无法写回远程）。
//
// 安全护栏（本模块强制执行）：
//  - 写回仅限 outDir 内的插件自建副本（bridge-* 等），绝不触碰 DSH attachments 存储；
//  - 图片里已有非本插件数据（foreign）或 imgjson 加密载荷（encrypted）时拒绝覆盖；
//  - 只读缓存不受目录限制，任何本地文件都可命中；
//  - 原子写入（tmp + rename），失败不损坏原图。

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { extractAny, embedJson, stripJson } from './imgjson.mjs'

export const CACHE_TOOL = 'dsh-mmx-bridge'
export const CACHE_VERSION = 1
const ENC_PREFIX = 'enc:v1:'
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const MAX_LAYERS = 100

/** 是否为远程/数据 URL（无法读写本地文件）。 */
export function isRemotePath(p) {
  if (typeof p !== 'string' || !p) return false
  return /^(https?|data):/i.test(p)
}

/** prompt 归一化：非字符串→默认档 ''；trim。 */
export function normalizePrompt(p) {
  if (typeof p !== 'string') return ''
  return p.trim()
}

/** 纯图片字节的 sha256（先剥离所有 imgjson 块，随嵌入次数稳定）。 */
export function pureImageSha256(buf) {
  return createHash('sha256').update(stripJson(buf)).digest('hex')
}

/** 由 layers map 构造缓存载荷（JSON 字符串）。 */
function buildPayload(layers) {
  return JSON.stringify({
    v: CACHE_VERSION,
    tool: CACHE_TOOL,
    ts: Math.floor(Date.now() / 1000),
    layers,
  })
}

/**
 * 解析图片内嵌的载荷文本。
 * 返回 { kind: 'ours'|'encrypted'|'foreign'|'empty', payload? }
 *  - ours      本插件缓存载荷（可读/可覆盖）
 *  - encrypted imgjson 加密载荷（无密码不可读，拒绝覆盖）
 *  - foreign   别人的内嵌数据（拒绝覆盖）
 */
export function parsePayload(jsonText) {
  if (typeof jsonText !== 'string' || !jsonText) return { kind: 'empty' }
  if (jsonText.startsWith(ENC_PREFIX)) return { kind: 'encrypted' }
  let obj
  try {
    obj = JSON.parse(jsonText)
  } catch (e) {
    return { kind: 'foreign' }
  }
  if (
    obj !== null &&
    typeof obj === 'object' &&
    obj.v === CACHE_VERSION &&
    obj.tool === CACHE_TOOL &&
    obj.layers !== null &&
    typeof obj.layers === 'object' &&
    !Array.isArray(obj.layers)
  ) {
    return { kind: 'ours', payload: obj }
  }
  return { kind: 'foreign' }
}

/**
 * 读取一个本地图片文件中、指定 prompt 层的识别结果。
 * 返回 { hit, description?, ts?, encrypted?, foreign?, stale?, reason? }
 *  - hit=true  该层描述可用（键存在且 sha256 与当前纯图字节一致）
 *  - encrypted 已有加密载荷（命中失败，且不可覆盖）
 *  - foreign   已有他人数据（命中失败，且不可覆盖）
 *  - stale     本插件该层存在但图片已被改过（描述过期，需重识别后覆盖）
 */
export function readImageCache(filePath, prompt, opts = {}) {
  const key = normalizePrompt(prompt)
  const maxBytes = typeof opts.maxBytes === 'number' ? opts.maxBytes : DEFAULT_MAX_BYTES
  try {
    const st = statSync(filePath)
    if (!st.isFile()) return { hit: false, reason: 'not-a-file' }
    if (st.size > maxBytes) return { hit: false, reason: 'too-large' }
    const bytes = readFileSync(filePath)
    const found = extractAny(bytes)
    if (!found) return { hit: false, reason: 'none' }
    const parsed = parsePayload(found.json)
    if (parsed.kind === 'encrypted') return { hit: false, encrypted: true }
    if (parsed.kind !== 'ours') return { hit: false, foreign: true }
    const entry = parsed.payload.layers[key]
    if (entry === undefined || entry === null || typeof entry !== 'object') return { hit: false, reason: 'no-layer' }
    if (typeof entry.description !== 'string' || typeof entry.sha256 !== 'string') return { hit: false, reason: 'bad-entry' }
    if (pureImageSha256(bytes) !== entry.sha256) return { hit: false, stale: true }
    return { hit: true, description: entry.description, ts: typeof entry.ts === 'number' ? entry.ts : undefined }
  } catch (err) {
    return { hit: false, reason: 'probe-error', error: String(err && err.message ? err.message : err) }
  }
}

/**
 * 把识别结果写入图片的指定 prompt 层（单块替换语义：先剥离旧块再写，图片不叠加膨胀）。
 * 返回 { wrote, reason?, bytes? }
 *  - 仅当文件位于 outDir 内才写回（opts.outDir 缺省则拒绝写）；
 *  - 已有加密/他人数据时拒绝覆盖；
 *  - 层数上限 MAX_LAYERS，超出按 ts 淘汰最旧层；
 *  - 原子写入（tmp + rename），失败不损坏原图。
 */
export function writeImageCache(filePath, prompt, description, opts = {}) {
  const key = normalizePrompt(prompt)
  const outDir = typeof opts.outDir === 'string' && opts.outDir ? opts.outDir : ''
  const maxBytes = typeof opts.maxBytes === 'number' ? opts.maxBytes : DEFAULT_MAX_BYTES
  try {
    const target = resolve(filePath)
    if (outDir) {
      const root = resolve(outDir)
      if (target !== root && !target.startsWith(root + sep)) return { wrote: false, reason: 'not-in-outdir' }
    } else {
      return { wrote: false, reason: 'no-outdir' }
    }
    const st = statSync(target)
    if (!st.isFile()) return { wrote: false, reason: 'not-a-file' }
    if (st.size > maxBytes) return { wrote: false, reason: 'too-large' }
    const bytes = readFileSync(target)
    let layers = {}
    const found = extractAny(bytes)
    if (found) {
      const parsed = parsePayload(found.json)
      if (parsed.kind === 'encrypted') return { wrote: false, reason: 'encrypted' }
      if (parsed.kind === 'foreign') return { wrote: false, reason: 'foreign' }
      if (parsed.kind === 'ours') layers = parsed.payload.layers || {}
    }
    layers[key] = {
      ts: Math.floor(Date.now() / 1000),
      sha256: pureImageSha256(bytes),
      description,
    }
    // 层数上限：超出按 ts 淘汰最旧层
    const keys = Object.keys(layers)
    if (keys.length > MAX_LAYERS) {
      keys
        .sort((a, b) => (layers[a].ts || 0) - (layers[b].ts || 0))
        .slice(0, keys.length - MAX_LAYERS)
        .forEach((k) => delete layers[k])
    }
    const payload = buildPayload(layers)
    const embedded = embedJson(bytes, payload, { mode: 'auto' })
    const tmp = target + '.imgjson-tmp'
    writeFileSync(tmp, embedded)
    renameSync(tmp, target)
    return { wrote: true, bytes: embedded.length }
  } catch (err) {
    return { wrote: false, reason: 'write-error', error: String(err && err.message ? err.message : err) }
  }
}