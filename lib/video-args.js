// mmx_bridge(video) 的纯函数层：参数构造 + 报错翻译（零依赖，便于脱离 DSH 单测）。
//
// 背景（issue #2）：mmx CLI 的 `--duration` / `--ratio` 仅 `MiniMax-H3` 支持——
// 缺 `--model MiniMax-H3` 时 CLI 直接以 code 2 拒绝（`--model MiniMax-H3-Max`
// 等其余模型同样不被接受）。因此：
//   1) 传了 duration/ratio 而未显式指定 model 时，自动补 `--model MiniMax-H3`；
//   2) 显式 model 与 duration/ratio 冲突（非 H3）时，预检报错而不是让 CLI 猜；
//   3) Credits / Token Plan 账号不支持 H3 系列（服务器 2013 报错），把这段
//      密码式报错翻译成可操作提示。
// 有效模型（mmx video generate --help，mmx-cli ≥ 1.0.19 实测）：
//   MiniMax-Hailuo-2.3（默认）| MiniMax-Hailuo-2.3-Fast（仅 I2V，需 image）|
//   MiniMax-H3 | MiniMax-H3-Max（不带 duration/ratio 时）

export const H3_MODEL = 'MiniMax-H3'

export const VIDEO_MODEL_NOTE =
  'MiniMax-Hailuo-2.3（默认）| MiniMax-Hailuo-2.3-Fast（仅图生视频，需 image）| ' +
  'MiniMax-H3 | MiniMax-H3-Max'

/**
 * 由工具参数构造 `mmx video generate` 的 argv。
 * @returns {{ argv: string[], outFile: string } | { error: string }}
 */
export function buildVideoArgs(args, outDir) {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (!prompt) return { error: 'video 生成需要 prompt' }
  const outFile = outDir + '/video-' + Date.now() + '.mp4'
  const argv = ['video', 'generate', '--prompt', prompt, '--download', outFile, '--output', 'json', '--quiet', '--non-interactive']
  if (typeof args.image === 'string' && args.image) argv.push('--image', args.image)
  const duration = typeof args.duration === 'number' ? args.duration : null
  const ratio = typeof args.ratio === 'string' && args.ratio.trim() ? args.ratio.trim() : null
  const model = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : null
  const needsH3 = duration !== null || ratio !== null
  if (model !== null) {
    const isH3 = model.toLowerCase() === H3_MODEL.toLowerCase()
    if (needsH3 && !isH3) {
      return {
        error:
          'duration/ratio 仅 MiniMax-H3 支持，与 model=' + model + ' 冲突。' +
          '去掉 duration/ratio（默认 Hailuo-2.3 约 6 秒、16:9），或把 model 设为 MiniMax-H3',
      }
    }
    // 大小写不敏感地归一到 CLI 接受的规范写法
    argv.push('--model', isH3 ? H3_MODEL : model)
  } else if (needsH3) {
    argv.push('--model', H3_MODEL)
  }
  if (duration !== null) argv.push('--duration', String(duration))
  if (ratio !== null) argv.push('--ratio', ratio)
  return { argv, outFile }
}

/**
 * 把 mmx 失败输出翻译成可操作提示；不匹配已知模式时返回 null（沿用原始报错）。
 * @param {string} text  stdout+stderr 合并文本
 * @returns {string | null}
 */
export function videoErrorHint(text) {
  const s = String(text || '')
  const mentionsH3 = /MiniMax-H3/i.test(s)
  const accountDenied = /\b2013\b/.test(s) || /TokenPlan or Credit does not currently support/i.test(s)
  if (mentionsH3 && accountDenied) {
    return (
      '当前账号（Credits / Token Plan 套餐）不支持 MiniMax-H3 系列，而 duration/ratio 需要 H3。' +
      '请去掉 duration/ratio 用默认 Hailuo-2.3（约 6 秒、16:9），或改用支持 H3 的账号/计费方式。'
    )
  }
  return null
}
