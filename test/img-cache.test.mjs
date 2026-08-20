// lib/img-cache.js（图片识别缓存）纯函数测试：真实 PNG/JPEG + 全部缓存语义。
// 运行：node test/img-cache.test.mjs（无外部依赖；JPEG 用例在无 sips 时自动跳过）。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as cache from '../lib/img-cache.js'
import * as imgjson from '../lib/imgjson.mjs'
import { makePng, tryMakeJpeg, sipsAvailable } from './fixture.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, 'tmp')
const OUT = join(TMP, 'out')
mkdirSync(OUT, { recursive: true })

const png = join(TMP, 'photo.png')
const jpg = join(TMP, 'photo.jpg')
makePng(png)
const hasJpeg = tryMakeJpeg(png, jpg)

let pass = 0
let fail = 0
let skip = 0
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''))
  ok ? pass++ : fail++
}
function skipCheck(name) {
  console.log('SKIP  ' + name)
  skip++
}
const jpegOk = existsSync(jpg) && readFileSync(jpg)[0] === 0xff && readFileSync(jpg)[1] === 0xd8
const pngSig = readFileSync(png).subarray(0, 8).toString('hex')
check('fixture PNG (89PNG) + JPEG (FFD8)', pngSig === '89504e470d0a1a0a' && (!hasJpeg || jpegOk))

// 复制进 outDir（插件产物语义：bridge-* 副本）
const outJpg = join(OUT, 'bridge-aaaa111111-photo.jpg')
const outPng = join(OUT, 'bridge-aaaa111111-photo.png')
writeFileSync(outJpg, readFileSync(jpg))
writeFileSync(outPng, readFileSync(png))

// ── 1) 基础写入 + 命中 ──
{
  const w1 = cache.writeImageCache(outPng, '', '一只宇航员猫的详细描述', { outDir: OUT })
  check('write default layer (PNG)', w1.wrote === true, w1)
  const r1 = cache.readImageCache(outPng, '')
  check('read default layer hit', r1.hit === true && r1.description === '一只宇航员猫的详细描述', r1)
}
// 纯图哈希稳定（写入前后不变）
{
  const before = cache.pureImageSha256(readFileSync(png))
  const after = cache.pureImageSha256(readFileSync(outPng))
  check('pureImageSha256 stable across embed', before === after)
}
// ── 2) 同 prompt 覆盖：不新增层、值被替换 ──
{
  const w2 = cache.writeImageCache(outPng, '', '第二版详细描述', { outDir: OUT })
  check('same prompt rewrite wrote', w2.wrote === true, w2)
  const parsed = imgjson.extractAny(readFileSync(outPng))
  const layers = parsed ? JSON.parse(parsed.json).layers : null
  check('same prompt keeps 1 layer', layers !== null && Object.keys(layers).length === 1)
  const r2 = cache.readImageCache(outPng, '')
  check('read after rewrite = new value', r2.hit === true && r2.description === '第二版详细描述', r2)
}
// ── 3) 多 prompt 分层：各层独立、互不串读 ──
{
  cache.writeImageCache(outJpg, '', '通用详细描述', { outDir: OUT })
  cache.writeImageCache(outJpg, '照片里猫的帽子是什么颜色？', '红色的宇航员头盔', { outDir: OUT })
  cache.writeImageCache(outJpg, '招牌上写着什么字？', '写着 DSH', { outDir: OUT })
  const layers = JSON.parse(imgjson.extractAny(readFileSync(outJpg)).json).layers
  const keyCount = Object.keys(layers).length
  check('3 prompts -> 3 layers (JPEG)', keyCount === 3, Object.keys(layers))
  const rDefault = cache.readImageCache(outJpg, '')
  const rColor = cache.readImageCache(outJpg, '照片里猫的帽子是什么颜色？')
  const rSign = cache.readImageCache(outJpg, '招牌上写着什么字？')
  check('default layer intact', rDefault.hit && rDefault.description === '通用详细描述', rDefault)
  check('color layer answers color', rColor.hit && rColor.description === '红色的宇航员头盔', rColor)
  check('sign layer answers sign', rSign.hit && rSign.description === '写着 DSH', rSign)
  check('unknown prompt -> miss', cache.readImageCache(outJpg, '没问过的问题').hit === false)
}
// ── 4) 图片被改（EOI 后追加字节改变纯图字节，不影响段结构解析）→ 所有层 stale → 重识别覆盖后恢复 ──
{
  writeFileSync(outJpg, Buffer.concat([readFileSync(outJpg), Buffer.from('TAMPERED-BYTES')]))
  const rStale = cache.readImageCache(outJpg, '')
  check('modified image -> stale (default layer)', rStale.hit === false && rStale.stale === true, rStale)
  const wNew = cache.writeImageCache(outJpg, '', '重新识别后的新描述', { outDir: OUT })
  check('stale refresh overwrite', wNew.wrote === true, wNew)
  const rFresh = cache.readImageCache(outJpg, '')
  check('after refresh -> hit with new desc', rFresh.hit === true && rFresh.description === '重新识别后的新描述', rFresh)
}
// ── 5) 加密载荷：只读不写 ──
{
  const encFile = join(OUT, 'bridge-encrypted-enc.png')
  writeFileSync(encFile, readFileSync(png))
  const enc = imgjson.encryptText('{"secret":1}', 'password')
  writeFileSync(encFile, imgjson.embedJson(readFileSync(encFile), enc, { mode: 'auto' }))
  const r = cache.readImageCache(encFile, '')
  check('encrypted payload -> encrypted flag', r.hit === false && r.encrypted === true, r)
  const before = readFileSync(encFile)
  const w = cache.writeImageCache(encFile, '', '想覆盖', { outDir: OUT })
  check('write refuses encrypted (file untouched)', w.wrote === false && w.reason === 'encrypted' && before.equals(readFileSync(encFile)), w)
}
// ── 6) 他方数据：只读不写 ──
{
  const foreignFile = join(OUT, 'bridge-foreign-frn.png')
  writeFileSync(foreignFile, readFileSync(png))
  writeFileSync(foreignFile, imgjson.embedJson(readFileSync(foreignFile), '{"from":"other-tool","note":1}', { mode: 'auto' }))
  const r = cache.readImageCache(foreignFile, '')
  check('foreign payload -> foreign flag', r.hit === false && r.foreign === true, r)
  const before = readFileSync(foreignFile)
  const w = cache.writeImageCache(foreignFile, '', '想覆盖', { outDir: OUT })
  check('write refuses foreign (file untouched)', w.wrote === false && w.reason === 'foreign' && before.equals(readFileSync(foreignFile)), w)
}
// ── 7) outDir 外文件：拒绝写 ──
{
  const outsideFile = join(TMP, 'outside.png')
  writeFileSync(outsideFile, readFileSync(png))
  const w = cache.writeImageCache(outsideFile, '', '描述', { outDir: OUT })
  check('write refuses outside outDir', w.wrote === false && w.reason === 'not-in-outdir', w)
  const r = cache.readImageCache(outsideFile, '')
  check('read allowed outside outDir (miss)', r.hit === false)
}
// ── 8) 远程 URL 判定 ──
{
  check('https URL remote', cache.isRemotePath('https://example.com/a.png') === true)
  check('data URL remote', cache.isRemotePath('data:image/png;base64,xx') === true)
  check('local path not remote', cache.isRemotePath('/tmp/x.png') === false)
  check('normalizePrompt trims & defaults', cache.normalizePrompt('  a  ') === 'a' && cache.normalizePrompt(undefined) === '')
}
// ── 9) 写回后图片仍可解码（sips）──
if (sipsAvailable()) {
  for (const f of [outJpg, outPng]) {
    try {
      execFileSync('sips', ['-g', 'pixelWidth', f], { stdio: 'ignore' })
      check('sips decodes after embed: ' + f.split('/').pop(), true)
    } catch (e) {
      check('sips decodes after embed: ' + f.split('/').pop(), false, String(e))
    }
  }
} else {
  skipCheck('sips decode checks')
}
// ── 10) 空/无块文件 ──
{
  const emptyFile = join(OUT, 'bridge-empty-nil.png')
  writeFileSync(emptyFile, readFileSync(png))
  const r = cache.readImageCache(emptyFile, '')
  check('no block -> miss(none)', r.hit === false && r.reason === 'none', r)
}

console.log('\nimg-cache tests: ' + pass + ' passed / ' + fail + ' failed / ' + skip + ' skipped')
process.exit(fail === 0 ? 0 : 1)