// 测试夹具：生成真实可解码的 PNG / JPEG 文件（无外部图片依赖）。
// PNG 用 zlib + CRC32 手工构造；JPEG 在 macOS 上用 sips 由 PNG 转换（不可用时跳过 JPEG 用例）。
import fs from 'node:fs'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { crc32 } from '../lib/imgjson.mjs'

function chunk(t, d) {
  const l = Buffer.alloc(4)
  l.writeUInt32BE(d.length)
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t, 'ascii'), d])))
  return Buffer.concat([l, Buffer.from(t, 'ascii'), d, c])
}

export function makePng(filePath) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(8, 0) // width
  ihdr.writeUInt32BE(8, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 255)])))
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  fs.writeFileSync(filePath, png)
  return png
}

/** 尝试生成 JPEG（macOS sips 转换）；返回 true/false。 */
export function tryMakeJpeg(pngPath, jpegPath) {
  try {
    execFileSync('sips', ['-s', 'format', 'jpeg', pngPath, '--out', jpegPath], { stdio: 'ignore' })
    return fs.existsSync(jpegPath)
  } catch (e) {
    return false
  }
}

export function sipsAvailable() {
  try {
    execFileSync('sips', ['--version'], { stdio: 'ignore' })
    return true
  } catch (e) {
    return false
  }
}