// lib/video-args.js 纯函数测试（issue #2 回归）：
// --duration / --ratio 仅 MiniMax-H3 支持 → 未显式传 model 时自动补 H3；
// 显式 model 与 duration/ratio 冲突（非 H3）→ 预检报错；
// Credits/Token Plan 不支持 H3（服务器 2013）→ 报错翻译成可操作提示。
// 运行：node test/video-args.test.mjs
import * as va from '../lib/video-args.js'

let pass = 0
let fail = 0
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''))
  ok ? pass++ : fail++
}

const OUT = '/tmp/mmx-out'

// ── 1) 回归主用例：duration/ratio 出现即自动补 --model MiniMax-H3 ──
{
  const r = va.buildVideoArgs({ prompt: 'test', duration: 6, ratio: '16:9' }, OUT)
  check('duration+ratio → --model H3 added', r.argv !== undefined && r.argv.includes('--model') && r.argv[r.argv.indexOf('--model') + 1] === 'MiniMax-H3', r.argv)
  check('duration value passed', r.argv.includes('--duration') && r.argv[r.argv.indexOf('--duration') + 1] === '6')
  check('ratio value passed', r.argv.includes('--ratio') && r.argv[r.argv.indexOf('--ratio') + 1] === '16:9')
}
{
  const r = va.buildVideoArgs({ prompt: 'test', duration: 6 }, OUT)
  check('duration alone → H3', r.argv.includes('--model') && r.argv[r.argv.indexOf('--model') + 1] === 'MiniMax-H3')
}
{
  const r = va.buildVideoArgs({ prompt: 'test', ratio: '9:16' }, OUT)
  check('ratio alone → H3', r.argv.includes('--model') && r.argv[r.argv.indexOf('--model') + 1] === 'MiniMax-H3')
}
// 无 duration/ratio 时不加 --model（保持 CLI 默认 Hailuo-2.3）
{
  const r = va.buildVideoArgs({ prompt: 'test' }, OUT)
  check('no flags → no --model (CLI default Hailuo-2.3)', !r.argv.includes('--model'), r.argv)
}

// ── 2) 显式 model ──
{
  const r = va.buildVideoArgs({ prompt: 'test', model: 'MiniMax-Hailuo-2.3' }, OUT)
  check('explicit legacy model passed as-is', r.argv.includes('--model') && r.argv[r.argv.indexOf('--model') + 1] === 'MiniMax-Hailuo-2.3', r.argv)
}
{
  const r = va.buildVideoArgs({ prompt: 'test', model: 'MiniMax-H3' }, OUT)
  check('explicit H3 passed', r.argv.includes('--model') && r.argv[r.argv.indexOf('--model') + 1] === 'MiniMax-H3')
}
{
  // 大小写不敏感归一
  const r = va.buildVideoArgs({ prompt: 'test', model: 'minimax-h3', duration: 6 }, OUT)
  check('model casing normalized to MiniMax-H3', r.argv !== undefined && r.argv[r.argv.indexOf('--model') + 1] === 'MiniMax-H3', r.argv)
}
{
  const r = va.buildVideoArgs({ prompt: 'test', model: 'MiniMax-H3-Max' }, OUT)
  check('H3-Max without duration/ratio allowed', r.argv !== undefined && r.argv[r.argv.indexOf('--model') + 1] === 'MiniMax-H3-Max', r.argv)
}
// 冲突：非 H3 模型 + duration/ratio → 预检报错（CLI 对 H3-Max/legacy 同样拒绝）
{
  const r = va.buildVideoArgs({ prompt: 'test', model: 'MiniMax-H3-Max', duration: 6, ratio: '16:9' }, OUT)
  check('H3-Max + duration/ratio → conflict error', r.error !== undefined && /MiniMax-H3/.test(r.error) && /model=MiniMax-H3-Max/.test(r.error), r.error)
  check('conflict error builds no argv', r.argv === undefined)
}
{
  const r = va.buildVideoArgs({ prompt: 'test', model: 'MiniMax-Hailuo-2.3', ratio: '1:1' }, OUT)
  check('legacy model + ratio → conflict error', r.error !== undefined && /model=MiniMax-Hailuo-2\.3/.test(r.error), r.error)
}

// ── 3) 基础参数形态不变 ──
{
  const r = va.buildVideoArgs({ prompt: '  hello world  ', image: '/tmp/a.jpg' }, OUT)
  check('prompt trimmed', r.argv !== undefined && r.argv[r.argv.indexOf('--prompt') + 1] === 'hello world')
  check('image passed', r.argv.includes('--image') && r.argv[r.argv.indexOf('--image') + 1] === '/tmp/a.jpg')
  check('outFile naming video-<ts>.mp4', /^video-\d+\.mp4$/.test(r.outFile.split('/').pop()))
  check('download target == outFile', r.argv[r.argv.indexOf('--download') + 1] === r.outFile)
}
{
  const r = va.buildVideoArgs({}, OUT)
  check('missing prompt → error', r.error !== undefined && /prompt/.test(r.error))
}
{
  const r = va.buildVideoArgs({ prompt: 'x', duration: '6' }, OUT) // 非法类型：字符串时长
  check('non-number duration ignored (no H3 switch)', r.argv !== undefined && !r.argv.includes('--duration') && !r.argv.includes('--model'), r.argv)
}

// ── 4) 2013 / TokenPlan 报错翻译 ──
{
  const live = 'API error: invalid params, TokenPlan or Credit does not currently support MiniMax-H3 series models (2013) (HTTP 400)'
  const hint = va.videoErrorHint(live)
  check('2013 live error → actionable hint', hint !== null && /Credits \/ Token Plan/.test(hint) && /Hailuo-2\.3/.test(hint), hint)
}
{
  const jsonErr = '{"error":{"code":2013,"message":"TokenPlan or Credit does not currently support MiniMax-H3 series models"}}'
  const hint = va.videoErrorHint(jsonErr)
  check('2013 JSON error → hint', hint !== null)
}
{
  const hint = va.videoErrorHint('{"error":{"code":2,"message":"--reference-image, --duration, and --ratio require --model MiniMax-H3."}}')
  check('CLI code-2 error → no hint (raw error is already clear)', hint === null)
}
{
  const hint = va.videoErrorHint('some random failure')
  check('unknown error → null', hint === null)
}
{
  const hint = va.videoErrorHint('')
  check('empty error → null', hint === null)
}

console.log('')
console.log('video-args: ' + pass + ' pass, ' + fail + ' fail')
process.exit(fail === 0 ? 0 : 1)
