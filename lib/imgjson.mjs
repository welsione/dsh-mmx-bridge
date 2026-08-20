#!/usr/bin/env node
// VENDORED from welsione/imgjson v0.3.0 (https://github.com/welsione/imgjson),
// verbatim copy, zero runtime dependencies (Node builtins only).
// Used by lib/img-cache.js (read_image 识别缓存). Do not edit here — fix upstream.
/**
 * imgjson v0.3.0 — 把 JSON 写进图片，看图软件感知不到，专用代码（或本 CLI）可以原样读回。
 *
 * 三种写入方式：
 *  1) PNG 原生嵌入：把数据作为标准 tEXt 块插在 IEND 之前。PNG 规范允许任意已知/未知
 *     附加块，pngcheck 等严格校验器也不会报错；解码器读到 IEND 即止，不受影响。
 *  2) JPEG 原生嵌入：把数据作为 COM（注释）段插在 EOI(FF D9) 之前。JPEG 规范允许
 *     COM 段，各类解码器兼容。
 *  3) 文件尾追加（EOF fallback）：通用兜底，任何二进制文件都能用。
 *
 * 块结构（两种原生方式都把标准块做 base64 后放进容器文本字段/段）：
 *   [ JSON UTF-8 字节, N 字节 ][ N: UInt32BE ][ CRC32(JSON): UInt32BE ][ "IMGJSON1" 8 字节 ]
 *
 * 可选 AES-256-GCM 加密：载荷文本形如 "enc:v1:<base64(iv+tag+ct)>"，无密码不可读。
 *
 * 作为库使用：
 *   import { embedJson, extractAny, extractAllAny, stripJson, crc32,
 *            encryptText, tryDecryptText } from './imgjson.mjs'
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.3.0';

/** 尾部魔数（8 字节 ASCII），既是块结束标记也是误判校验的一部分。 */
export const MAGIC = 'IMGJSON1';

/** 一个块的固定开销：4(长度) + 4(CRC32) + 8(魔数)。 */
const OVERHEAD = 16;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND_TAIL = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

// ---------------------------------------------------------------------------
// CRC32（IEEE 802.3，与 PNG/zlib 同算法，表驱动）。无第三方依赖。
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** 计算一段 Buffer 的 CRC32。 */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// 标准块（payload + length + crc + magic）
// ---------------------------------------------------------------------------

/** 由 JSON 文本构造一个标准块 Buffer（payload + 16 字节尾）。 */
export function buildBlock(jsonText) {
  if (typeof jsonText !== 'string') throw new TypeError('jsonText 必须是字符串');
  const payload = Buffer.from(jsonText, 'utf8');
  const tail = Buffer.alloc(OVERHEAD);
  tail.writeUInt32BE(payload.length, 0);
  tail.writeUInt32BE(crc32(payload), 4);
  tail.write(MAGIC, 8, 8, 'ascii');
  return Buffer.concat([payload, tail]);
}

/**
 * 解析「裸标准块」：注意这是对 整个 buffer 就是一个块 的情况（原生嵌入时，
 * 块被 base64 后取回）。返回与 EOF 模式一致的 info 结构或 null。
 */
export function extractJson(blockBuf) {
  if (!Buffer.isBuffer(blockBuf) || blockBuf.length < OVERHEAD) return null;
  const total = blockBuf.length;
  if (blockBuf.subarray(total - 8).toString('ascii') !== MAGIC) return null;
  const n = blockBuf.readUInt32BE(total - 16);
  const crc = blockBuf.readUInt32BE(total - 12);
  if (n > total - OVERHEAD) return null;
  const start = total - OVERHEAD - n;
  if (start < 0) return null;
  const payload = blockBuf.subarray(start, total - OVERHEAD);
  if (crc32(payload) !== crc) return null;
  return {
    json: payload.toString('utf8'),
    payloadBytes: n,
    blockStart: start,
    blockBytes: OVERHEAD + n,
  };
}

// ---------------------------------------------------------------------------
// 容器识别
// ---------------------------------------------------------------------------

/** 快速识别容器类型：返回 'JPEG' | 'PNG' | 'GIF' | 'WebP' | 'BMP' | 'TIFF' | 'ICO' | '其他'。 */
export function sniffContainer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return '其他';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'JPEG';
  if (buf.subarray(0, 8).equals(PNG_SIG)) return 'PNG';
  const gifHead = buf.toString('ascii', 0, Math.min(buf.length, 6));
  if (gifHead === 'GIF87a' || gifHead === 'GIF89a') return 'GIF';
  const head = buf.toString('ascii', 0, Math.min(buf.length, 8));
  if (head.startsWith('RIFF') && buf.length >= 12 && buf.toString('ascii', 8, 12) === 'WEBP') return 'WebP';
  if (head.startsWith('BM')) return 'BMP';
  if (head.startsWith('II*\u0000') || head.startsWith('MM\u0000*')) return 'TIFF';
  if (buf.length >= 4 && buf[0] === 0x00 && (buf[1] === 0x00) && (buf[2] === 0x01 || buf[2] === 0x02) && buf[3] === 0x00) return 'ICO';
  return '其他';
}

// ---------------------------------------------------------------------------
// PNG 原生嵌入（tEXt 块，插在 IEND 之前）
// ---------------------------------------------------------------------------

function pngChunks(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const chunks = [];
  let i = 8;
  const n = buf.length;
  while (i + 12 <= n) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const dataStart = i + 8;
    const dataEnd = dataStart + len;
    const crcOff = dataEnd;
    if (crcOff + 4 > n) return null;
    chunks.push({ type, offset: i, dataStart, dataEnd, crcOff, len });
    if (type === 'IEND') break;
    i = crcOff + 4;
  }
  return chunks;
}

function makeChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

/** 构造 tEXt 块文本：imgjson:<base64 of block>。 */
function pngTextData(blockBuf) {
  const text = 'imgjson:' + blockBuf.toString('base64');
  return Buffer.concat([Buffer.from('imgjson\0', 'latin1'), Buffer.from(text, 'latin1')]);
}

function pngEmbed(buf, blockBuf) {
  const chunks = pngChunks(buf);
  if (!chunks) return null;
  const iend = chunks.find((c) => c.type === 'IEND');
  if (!iend) return null;
  const chunk = makeChunk('tEXt', pngTextData(blockBuf));
  return Buffer.concat([buf.subarray(0, iend.offset), chunk, buf.subarray(iend.offset)]);
}

/** 读取 PNG 里最后一个属于我们的 tEXt 块，返回 { info, chunk } (chunk 为 tEXt 块位置信息) 或 null。 */
function pngExtract(buf) {
  const chunks = pngChunks(buf);
  if (!chunks) return null;
  let result = null;
  let hitChunk = null;
  for (const c of chunks) {
    if (c.type !== 'tEXt') continue;
    const d = buf.subarray(c.dataStart, c.dataEnd);
    const nul = d.indexOf(0);
    if (nul < 0) continue;
    if (d.subarray(0, nul).toString('latin1') !== 'imgjson') continue;
    const text = d.subarray(nul + 1).toString('latin1');
    if (!text.startsWith('imgjson:')) continue;
    const crc = buf.readUInt32BE(c.crcOff) >>> 0;
    if (crc32(buf.subarray(c.offset + 4, c.dataEnd)) !== crc) continue; // 块损坏，跳过
    const block = Buffer.from(text.slice('imgjson:'.length), 'base64');
    const info = extractJson(block);
    if (!info) continue;
    result = info; // 取最后一个（最新）
    hitChunk = c;
  }
  return result ? { info: result, chunk: hitChunk } : null;
}

/** 移除 PNG 中所有属于我们的 tEXt 块，其余字节原样保留。 */
function pngStrip(buf) {
  const chunks = pngChunks(buf);
  if (!chunks) return buf;
  const removeAt = new Set();
  for (const c of chunks) {
    if (c.type !== 'tEXt') continue;
    const d = buf.subarray(c.dataStart, c.dataEnd);
    const nul = d.indexOf(0);
    if (nul < 0) continue;
    if (d.subarray(0, nul).toString('latin1') !== 'imgjson') continue;
    const text = d.subarray(nul + 1).toString('latin1');
    if (!text.startsWith('imgjson:')) continue;
    const crc = buf.readUInt32BE(c.crcOff) >>> 0;
    if (crc32(buf.subarray(c.offset + 4, c.dataEnd)) !== crc) continue;
    removeAt.add(c.offset);
  }
  if (removeAt.size === 0) return buf;
  const parts = [];
  let prev = 0;
  for (const c of chunks) {
    if (removeAt.has(c.offset)) {
      parts.push(buf.subarray(prev, c.offset));
      prev = c.crcOff + 4;
    }
  }
  parts.push(buf.subarray(prev));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// JPEG 原生嵌入（COM 段，插在 EOI(FF D9) 之前）
// ---------------------------------------------------------------------------

/**
 * 走 JPEG 标记序列，返回段列表 [{marker,start,end}]，或以 null 表示结构无法解析。
 * 正确处理 SOS 之后的熵编码数据（跳过 FF00 填充与 RST 段）直到 EOI。
 */
function jpegWalk(buf) {
  const n = buf.length;
  if (n < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const segs = [];
  let i = 2;
  while (i + 1 < n) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xd9) {
      segs.push({ marker: 0xd9, start: i, end: i + 2 });
      return segs;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      segs.push({ marker: m, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (i + 3 >= n) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > n) return null;
    segs.push({ marker: m, start: i, end: i + 2 + len });
    if (m === 0xda) {
      // SOS：跳过扫描头；之后是熵编码数据，但期间可能出现带长度的标记段
      //（渐进式 JPEG 的扫描间 DHT/DNL 等，或我们插入的 COM 段），按长度正确跳过并记录。
      let j = i + 2 + len;
      while (j + 1 < n) {
        if (buf[j] !== 0xff) {
          j++;
          continue;
        }
        const m2 = buf[j + 1];
        if (m2 === 0x00) { j += 2; continue; }               // FF00 字节填充
        if (m2 >= 0xd0 && m2 <= 0xd7) { j += 2; continue; }  // RST 重启动段
        if (m2 === 0xd9) { segs.push({ marker: 0xd9, start: j, end: j + 2 }); return segs; }
        if (m2 === 0xd8 || m2 === 0x01) { j += 2; continue; } // 罕见的 standalone 标记
        const segLen = buf.readUInt16BE(j + 2);
        if (segLen < 2 || j + 2 + segLen > n) return null;
        segs.push({ marker: m2, start: j, end: j + 2 + segLen });
        j += 2 + segLen;
      }
      return null; // 未找到 EOI
    }
    i += 2 + len;
  }
  return null;
}

function makeComSegment(textBytes) {
  const t = Buffer.from(textBytes, 'latin1');
  const seg = Buffer.alloc(4 + t.length);
  seg[0] = 0xff;
  seg[1] = 0xfe;
  seg.writeUInt16BE(t.length + 2, 2);
  t.copy(seg, 4);
  return seg;
}

function jpegEmbed(buf, blockBuf) {
  const segs = jpegWalk(buf);
  if (!segs) return null;
  const eoi = segs.find((s) => s.marker === 0xd9);
  if (!eoi) return null;
  const com = makeComSegment('imgjson:' + blockBuf.toString('base64'));
  return Buffer.concat([buf.subarray(0, eoi.start), com, buf.subarray(eoi.start)]);
}

/** 读取 JPEG 里最后一个属于我们的 COM 段，返回 { info, seg } 或 null。 */
function jpegExtract(buf) {
  const segs = jpegWalk(buf);
  if (!segs) return null;
  let result = null;
  let hitSeg = null;
  for (const s of segs) {
    if (s.marker !== 0xfe) continue;
    if (s.end - s.start < 4) continue;
    const text = buf.subarray(s.start + 4, s.end).toString('latin1');
    if (!text.startsWith('imgjson:')) continue;
    const block = Buffer.from(text.slice('imgjson:'.length), 'base64');
    const info = extractJson(block);
    if (!info) continue;
    result = info; // 取最后一个（最新）
    hitSeg = { start: s.start, end: s.end };
  }
  return result ? { info: result, seg: hitSeg } : null;
}

/** 移除 JPEG 中所有属于我们的 COM 段，其余字节原样保留。 */
function jpegStrip(buf) {
  const segs = jpegWalk(buf);
  if (!segs) return buf;
  const removeAt = new Set();
  for (const s of segs) {
    if (s.marker !== 0xfe || s.end - s.start < 4) continue;
    const text = buf.subarray(s.start + 4, s.end).toString('latin1');
    if (text.startsWith('imgjson:')) removeAt.add(s.start);
  }
  if (removeAt.size === 0) return buf;
  const parts = [];
  let prev = 0;
  for (const s of segs) {
    if (removeAt.has(s.start)) {
      parts.push(buf.subarray(prev, s.start));
      prev = s.end;
    }
  }
  parts.push(buf.subarray(prev));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// 原生嵌入统一入口
// ---------------------------------------------------------------------------

/** 输出环境提示：容器类型 → 原生嵌入可行性。 */
export function nativeInfo(buf) {
  const t = sniffContainer(buf);
  if (t === 'PNG') return { container: t, native: true, detail: 'tEXt 块（IEND 前）' };
  if (t === 'JPEG') return { container: t, native: true, detail: 'COM 段（EOI 前）' };
  return { container: t, native: false, detail: '无原生位置，使用文件尾追加' };
}

function embedNative(buf, blockBuf) {
  const t = sniffContainer(buf);
  if (t === 'PNG') return pngEmbed(buf, blockBuf);
  if (t === 'JPEG') return jpegEmbed(buf, blockBuf);
  return null;
}

function extractNative(buf) {
  const t = sniffContainer(buf);
  if (t === 'PNG') return pngExtract(buf);
  if (t === 'JPEG') return jpegExtract(buf);
  return null;
}

function stripNative(buf) {
  const t = sniffContainer(buf);
  if (t === 'PNG') return pngStrip(buf);
  if (t === 'JPEG') return jpegStrip(buf);
  return buf;
}

// ---------------------------------------------------------------------------
// 加密（AES-256-GCM）
// ---------------------------------------------------------------------------

const ENC_PREFIX = 'enc:v1:';

/** 用密码加密文本，返回 "enc:v1:<base64(iv+tag+ct)>"。 */
export function encryptText(text, pass) {
  if (typeof pass !== 'string' || !pass) throw new Error('密码不能为空');
  const key = crypto.scryptSync(pass, 'imgjson-v1', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * 尝试解密文本。返回 { encrypted, text }：
 *  - 非加密载荷 → { encrypted: false, text: 原样 }
 *  - 加密载荷且密码正确 → { encrypted: true, text: 明文 }
 *  - 加密载荷但密码错误/数据损坏 → 抛错
 */
export function tryDecryptText(text, pass) {
  if (typeof text !== 'string' || !text.startsWith(ENC_PREFIX)) return { encrypted: false, text };
  if (typeof pass !== 'string' || !pass) throw new Error('该载荷已加密，需要 --pass 提供密码');
  const raw = Buffer.from(text.slice(ENC_PREFIX.length), 'base64');
  if (raw.length < 12 + 16) throw new Error('加密载荷格式不完整');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 12 + 16);
  const ct = raw.subarray(12 + 16);
  const key = crypto.scryptSync(pass, 'imgjson-v1', 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  let pt;
  try {
    pt = Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new Error('密码错误或数据已被篡改（GCM 认证失败）');
  }
  return { encrypted: true, text: pt.toString('utf8') };
}

// ---------------------------------------------------------------------------
// 高层 API
// ---------------------------------------------------------------------------

/**
 * 把 JSON 写进图片：
 *  - mode: 'auto'（默认，PNG/JPEG 用原生嵌入，其余 EOF）| 'native' | 'eof'
 *  - append: true 在已有数据之上叠一层（默认替换，先剥离旧数据）
 *  - pass: 提供则 AES-256-GCM 加密后再写入
 */
export function embedJson(imageBuf, jsonText, opts = {}) {
  if (typeof jsonText !== 'string') throw new TypeError('jsonText 必须是字符串');
  const mode = opts.mode || 'auto';
  const doAppend = !!opts.append;
  const base = doAppend ? imageBuf : stripJson(imageBuf);
  const payload = typeof opts.pass === 'string' && opts.pass ? encryptText(jsonText, opts.pass) : jsonText;
  const block = buildBlock(payload);
  if (mode === 'eof') return Buffer.concat([base, block]);
  const native = embedNative(base, block);
  if (native) return native;
  if (mode === 'native') {
    // 结构异常时回退 EOF（不静默失败）
    return Buffer.concat([base, block]);
  }
  return Buffer.concat([base, block]); // auto：非 PNG/JPEG
}

/** 读取图片里的数据（原生优先，其次 EOF）。返回 { json, payloadBytes, blockBytes, mode } 或 null。 */
export function extractAny(buf) {
  const n = extractNative(buf);
  if (n) return { ...n.info, mode: 'native' };
  const e = extractJson(buf);
  if (e) return { ...e, mode: 'eof' };
  return null;
}

/** 读取全部层（原生层在前，EOF 层在后；最新写的最先出现）。 */
export function extractAllAny(buf) {
  const list = [];
  let b = buf;
  for (;;) {
    const n = extractNative(b);
    if (!n) break;
    list.push({ ...n.info, mode: 'native' });
    b = stripNative(b);
  }
  for (;;) {
    const e = extractJson(b);
    if (!e) break;
    list.push({ ...e, mode: 'eof' });
    b = b.subarray(0, e.blockStart);
  }
  return list;
}

/** 剥离所有 imgjson 数据（原生块 + EOF 块），返回纯净图片字节（独立副本）。 */
export function stripJson(buf) {
  let b = Buffer.from(buf);
  for (;;) {
    const nb = stripNative(b);
    let eb = b;
    for (;;) {
      const e = extractJson(eb);
      if (!e) break;
      eb = eb.subarray(0, e.blockStart);
    }
    if (nb.length === b.length && eb.length === b.length) return b;
    b = nb.length < eb.length ? nb : eb;
  }
}

// ---------------------------------------------------------------------------
// 容器完整性检查（encode 时给出友好提示）
// ---------------------------------------------------------------------------

/** 检查纯净图片字节是否以本格式应有的结束标记结尾。返回提示文本或 null。 */
export function checkContainer(fileName, buf) {
  const t = sniffContainer(buf);
  if (t === 'JPEG') {
    if (buf.length < 4) return 'JPEG 文件过短';
    if (!(buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9)) {
      return 'JPEG 应以 FF D9 (EOI) 结尾，但文件尾并非如此（可能被截断，或为多段式 JPEG）';
    }
    return null;
  }
  if (t === 'PNG') {
    if (buf.subarray(buf.length - 12).equals(PNG_IEND_TAIL)) return null;
    return 'PNG 应以 IEND 块结尾，但文件尾并非如此（可能被截断）';
  }
  if (t === 'GIF') {
    if (buf[buf.length - 1] === 0x3a) return null;
    return 'GIF 应以 0x3A (trailer) 结尾，但文件尾并非如此';
  }
  if (t === 'WebP') {
    const riffSize = buf.readUInt32LE(4);
    if (8 + riffSize > buf.length) return 'RIFF 声明大小超出实际文件长度（文件可能损坏）';
    if (8 + riffSize < buf.length) return `RIFF 声明末尾之后还有 ${buf.length - 8 - riffSize} 字节尾部数据`;
    return null;
  }
  if (t === 'BMP') {
    if (buf.length < 2 || buf.toString('ascii', 0, 2) !== 'BM') return 'BMP 应以 "BM" 开头';
    return null;
  }
  // TIFF / ICO / 其他：无固定结束标记，跳过检查。
  return null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `imgjson v${VERSION} — 把 JSON 写进图片，看图软件感知不到，专用代码可读回。

用法：
  imgjson encode <image> (--json <str> | --file <path> | <jsonfile> | -) [选项]
  imgjson decode <image> [--pretty] [--all] [--out <file>] [--pass <pw>]
  imgjson strip  <image> [--out <file>] [--backup]
  imgjson detect <image>

encode（写入）：
  JSON 来源三选一：
    --json '{"a":1}'   直接给 JSON 字符串
    --file data.json   从文件读取
    <jsonfile> 或 '-'  位置参数给文件路径；传 - 则从 stdin 读取
  选项：
    --pass <pw>        用密码 AES-256-GCM 加密后写入（无密码不可读）
    --mode <m>         嵌入方式：auto(默认，PNG/JPEG 用原生块) | native | eof
    --pretty           把 JSON 规整为两空格缩进后写入
    --raw              跳过 JSON 语法校验（可嵌入任意文本）
    --append           在已有数据之上再叠一层（默认是替换旧块）
    --out <file>       写到新文件，不改原文件
    --backup           原地修改前先备份一份 <原图>.bak
    --force            跳过容器完整性检查

decode（读取）：
    --pass <pw>        解密加密载荷
    --pretty           以两空格缩进打印（要求内容是合法 JSON）
    --all              文件里有多层块时全部输出（最近写的最前，块间用 --- 分隔）
    --out <file>       结果写入文件（不写则打印到 stdout）

strip（剥离）：移除所有 imgjson 数据（原生块 + EOF 块），恢复纯净图片。
detect（侦查）：显示容器格式、嵌入方式、载荷大小与是否加密。

示例：
  imgjson encode photo.jpg --json '{"from":1,"to":2,"msg":"hi"}'            # 原生 COM 段
  imgjson encode photo.png --file payload.json --pass 's3cret'              # 加密，原生 tEXt
  imgjson encode photo.gif --json '{"a":1}' --mode eof                     # 非 PNG/JPEG 走 EOF
  imgjson decode photo.png --pass 's3cret' --pretty                        # 解密并格式化
  imgjson detect photo.png                                                  # 查看嵌入情况
  imgjson strip photo.png --out clean.png
`;

function parseArgs(argv) {
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--json':
      case '--file':
      case '--out':
      case '--pass':
      case '--mode':
        if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
          throw new Error(`参数 ${a} 需要一个值`);
        }
        opts[a.slice(2)] = argv[++i];
        break;
      case '--pretty':
      case '--raw':
      case '--append':
      case '--backup':
      case '--force':
      case '--all':
        opts[a.slice(2)] = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      default:
        if (a.startsWith('-') && a !== '-') throw new Error(`未知参数：${a}`);
        opts.positional.push(a);
    }
  }
  return opts;
}

/** 读取 JSON 文本：--json 直给 → --file 读文件 → 位置参数(文件 或 '-'=stdin)。 */
function readJsonText(opts) {
  if (opts.json != null) return opts.json;
  if (opts.file != null) return readFileSync(opts.file, 'utf8');
  const jsonFile = opts.positional[1];
  if (jsonFile == null) throw new Error('缺少 JSON：请用 --json、--file，或传入 <jsonfile>/-');
  if (jsonFile === '-') {
    const s = fs.readFileSync(0, 'utf8');
    if (s == null || s === '') throw new Error('stdin 为空');
    return s;
  }
  return readFileSync(jsonFile, 'utf8');
}

function writeOutput(file, outPath, data, { backup }) {
  if (outPath) {
    fs.writeFileSync(outPath, data);
    return outPath;
  }
  if (backup) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, data);
  return file;
}

function encode(opts) {
  const imageFile = opts.positional[0];
  if (!imageFile) throw new Error('缺少图片路径：imgjson encode <image> …');
  const jsonText = readJsonText(opts);
  if (!opts.raw && !opts.pass) {
    // 有密码时先加密，明文不再可校验；无密码时校验 JSON
    try {
      JSON.parse(jsonText);
    } catch {
      throw new Error('JSON 语法校验失败。若确是合法 JSON 而校验误报，请使用 --raw 跳过校验。');
    }
  }
  const finalText = opts.pretty && !opts.pass ? JSON.stringify(JSON.parse(jsonText), null, 2) : jsonText;

  const original = readFileSync(imageFile);
  const clean = opts.append ? original : stripJson(original);

  const info = nativeInfo(clean);
  if (opts.mode === 'eof' && info.native) {
    // 用户显式要求 EOF，跳过原生
  }
  const note = checkContainer(imageFile, clean);
  if (note && !opts.force) {
    console.warn(`警告：${note}（可用 --force 忽略）`);
  }

  const outBuf = embedJson(clean, finalText, {
    append: opts.append,
    mode: opts.mode || 'auto',
    pass: opts.pass,
  });
  const target = writeOutput(imageFile, opts.out, outBuf, { backup: opts.backup });

  // 判定实际嵌入方式（结果里取一层即可）
  const got = extractAny(Buffer.from(outBuf));
  const modeName = got && got.mode === 'native' ? (info.native ? `原生 ${info.detail}` : '原生') : '文件尾追加(EOF)';
  const strippedBytes = original.length - clean.length;
  const replaceNote = strippedBytes > 0 ? `（替换了原有 ${strippedBytes} 字节数据）` : '';
  const encNote = opts.pass ? '，已加密(AES-256-GCM)' : '';
  console.log(
    `已写入 ${Buffer.byteLength(finalText, 'utf8')} 字节 JSON（${modeName}${encNote}），文件 ${original.length} → ${outBuf.length} 字节 → ${target} ${replaceNote}`
  );
  return 0;
}

function decode(opts) {
  const imageFile = opts.positional[0];
  if (!imageFile) throw new Error('缺少图片路径：imgjson decode <image> …');
  const buf = readFileSync(imageFile);
  if (opts.all) {
    const list = extractAllAny(buf);
    if (list.length === 0) return noPayload();
    const texts = list.map((i) => i.json);
    const rendered = list.map((i, idx) => {
      const header = `# ${idx + 1} (${i.mode === 'native' ? '原生' : 'EOF'})${i.json.startsWith(ENC_PREFIX) ? ' [加密]' : ''}`;
      return header + '\n' + i.json;
    });
    const out = list.length === 1 ? rendered[0] : rendered.join('\n---\n');
    return emitText(opts, out);
  }
  const info = extractAny(buf);
  if (!info) return noPayload();
  return renderPayload(info, opts);
}

function renderPayload(info, opts) {
  let text = info.json;
  let decrypted = false;
  if (text.startsWith(ENC_PREFIX)) {
    if (!opts.pass) {
      // 无密码：原样输出 + stderr 提示
      process.stderr.write('提示：该载荷已加密，可用 --pass <密码> 解密查看。\n');
      return emitText(opts, text);
    }
    try {
      text = tryDecryptText(text, opts.pass).text;
      decrypted = true;
    } catch (e) {
      chooseError(opts, e.message);
      return 1;
    }
  }
  if (opts.pretty) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      if (decrypted || !text.startsWith(ENC_PREFIX)) {
        chooseError(opts, '存储内容不是合法 JSON，--pretty 无法格式化，去掉 --pretty 原样输出');
        return 1;
      }
    }
  }
  return emitText(opts, text);
}

function chooseError(opts, msg) {
  if (opts.out) console.error(`错误：${msg}`);
  else throw new Error(msg);
}

function noPayload() {
  console.error('未发现 imgjson 数据（无原生块，文件尾也无 "IMGJSON1" 魔数块）。');
  return 1;
}

function emitText(opts, text) {
  if (opts.out) {
    fs.writeFileSync(opts.out, text.endsWith('\n') ? text : text + '\n');
    console.log(`已写入 ${opts.out}`);
  } else {
    process.stdout.write(text.endsWith('\n') ? text : text + '\n');
  }
  return 0;
}

function strip(opts) {
  const imageFile = opts.positional[0];
  if (!imageFile) throw new Error('缺少图片路径：imgjson strip <image> …');
  const buf = readFileSync(imageFile);
  const clean = stripJson(buf);
  if (clean.length === buf.length) {
    console.log('没有需要剥离的数据。');
    return 0;
  }
  const target = writeOutput(imageFile, opts.out, clean, { backup: opts.backup });
  console.log(`已剥离 ${buf.length - clean.length} 字节 → ${target}（${clean.length} 字节）`);
  return 0;
}

function detect(opts) {
  const imageFile = opts.positional[0];
  if (!imageFile) throw new Error('缺少图片路径：imgjson detect <image> …');
  const buf = readFileSync(imageFile);
  const ni = nativeInfo(buf);
  const native = extractNative(buf);
  const eof = extractJson(buf);
  const kind = native ? '原生块' : eof ? '文件尾(EOF)' : '无';
  const encFlag = (native ? native.info.json : eof ? eof.json : '').startsWith(ENC_PREFIX) ? '，已加密' : '';
  console.log(`格式: ${ni.container}`);
  console.log(`嵌入: ${kind}${encFlag}`);
  if (native) {
    console.log(`  方式: ${ni.detail}`);
    console.log(`  载荷: ${native.info.payloadBytes} 字节 JSON`);
  } else if (eof) {
    console.log(`  载荷: ${eof.payloadBytes} 字节 JSON`);
  }
  return 0;
}

/**
 * 程序入口。返回进程退出码。
 */
export function main(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    console.error(HELP);
    return 0;
  }
  if (argv[0] === '-h' || argv[0] === '--help') {
    console.log(HELP);
    return 0;
  }
  if (argv[0] === '-v' || argv[0] === '--version') {
    console.log(`imgjson ${VERSION}`);
    return 0;
  }
  const [cmd, ...rest] = argv;
  let opts;
  try {
    opts = parseArgs(rest);
  } catch (e) {
    console.error(`错误：${e.message}`);
    console.error(HELP);
    return 1;
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (opts.version) {
    console.log(`imgjson ${VERSION}`);
    return 0;
  }
  try {
    switch (cmd) {
      case 'encode':
        return encode(opts);
      case 'decode':
      case 'decoder':
        return decode(opts);
      case 'strip':
        return strip(opts);
      case 'detect':
        return detect(opts);
      case 'version':
        console.log(`imgjson ${VERSION}`);
        return 0;
      case 'help':
        console.log(HELP);
        return 0;
      default:
        console.error(`未知命令：${cmd}`);
        console.error(HELP);
        return 1;
    }
  } catch (e) {
    console.error(`错误：${e.message}`);
    return 1;
  }
}

// 直接运行（node imgjson.mjs 或已安装的 imgjson 软链接）时执行 CLI；作为库被 import 时不执行。
if (process.argv[1]) {
  try {
    const invoked = realpathSync(process.argv[1]);
    const self = realpathSync(fileURLToPath(import.meta.url));
    if (invoked === self) process.exit(main());
  } catch {
    if (path.basename(process.argv[1]).startsWith('imgjson')) process.exit(main());
  }
}