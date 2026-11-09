#!/usr/bin/env node
/**
 * 一次性素材转换：把四张 GIF 变成带透明、统一缩放、统一地面线的动画 WebP。
 *
 * - 抠背景：淡紫 #EEEAFA（colorkey 容差），保留脚下灰色阴影
 * - 统一缩放：四张用同一个全局 scale（按最宽的那张算，目标 ≤170px），不再各缩各的
 * - 统一锚点：脚下阴影中心 x → 102、阴影底边 y → 180，四张一律
 * - 编码：ffmpeg libwebp_anim，保持原帧率与帧序；超 300KB 再降
 *
 * 用法：
 *   CAT_SRC_DIR=<四张 GIF 的目录> FFMPEG=<ffmpeg 可执行文件> PYTHON=<python 可执行文件> \
 *     node scripts/build-cat-assets.mjs
 * 未设置时使用仓库内 assets-src/、PATH 里的 ffmpeg 与 python。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const srcDir = process.env.CAT_SRC_DIR || path.join(root, 'assets-src')
const outDir = path.join(root, 'assets')
const ffmpeg = process.env.FFMPEG || 'ffmpeg'
const python = process.env.PYTHON || 'python'

const SOURCES = [
  ['小猫清醒时.gif', 'cat-idle.webp'],
  ['单击小猫时.gif', 'cat-click.webp'],
  ['长按鼠标，移动小猫时.gif', 'cat-drag.webp'],
  ['长时间待机，小猫睡觉.gif', 'cat-sleep.webp'],
]

const BG = [0xee, 0xea, 0xfa]
const KEY = `0x${BG.map((v) => v.toString(16).padStart(2, '0')).join('')}`
const CANVAS = 204
const BASELINE = 180
const CENTER_X = 102
const TARGET_W = 170

/** 内容包围盒 + 脚下阴影锚点（阴影 = 低饱和灰，约 #D8D5D0） */
function anchorsOf(file) {
  const code = `
import json, sys
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGBA')
w, h = img.size
bg = (${BG.join(',')})
tol = 12
px = img.load()
minx, miny, maxx, maxy = w, h, -1, -1
sx, sy, body = [], [], []
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        if abs(r-bg[0]) <= tol and abs(g-bg[1]) <= tol and abs(b-bg[2]) <= tol:
            continue
        if x < minx: minx = x
        if x > maxx: maxx = x
        if y < miny: miny = y
        if y > maxy: maxy = y
        if abs(r-g) <= 10 and abs(g-b) <= 12 and 195 <= r <= 235:
            sx.append(x); sy.append(y); continue
        body.append((x, y))
cut = miny + (maxy - miny) * 0.55
lower = [p[0] for p in body if p[1] >= cut]
body_w = (max(lower) - min(lower) + 1) if lower else (maxx - minx + 1)
scx = (sum(sx)/len(sx)) if sx else (minx+maxx)/2
sby = max(sy) if sy else maxy
print(json.dumps({'x': minx, 'y': miny, 'cw': maxx-minx+1, 'ch': maxy-miny+1, 'scx': scx, 'sby': sby, 'bodyW': body_w}))
`
  return JSON.parse(execFileSync(python, ['-c', code, file], { encoding: 'utf8' }).trim())
}

const anchors = SOURCES.map(([src, out]) => ({ src: path.join(srcDir, src), out, a: anchorsOf(path.join(srcDir, src)) }))

// 逐张按"躯干宽度"归一化到 170px：四张猫看起来一样大；再受"能放进画布"约束
for (const it of anchors) {
  it.scale = Math.min(TARGET_W / it.a.bodyW, 178 / it.a.ch, 0.95)
  console.log(`${it.out}: bodyW=${it.a.bodyW} scale=${it.scale.toFixed(3)}`)
}

function encode({ src, dst, a, scale, fps }) {
  const left = (a.scx - a.x) * scale
  const up = (a.sby - a.y) * scale
  const x = Math.round(CENTER_X - left)
  const y = Math.round(BASELINE - up)
  if (x < 0 || y < 0) throw new Error(`锚点放不下：${path.basename(src)} x=${x} y=${y}`)
  const w = Math.round(a.cw * scale)
  const h = Math.round(a.ch * scale)
  const chain = [
    `colorkey=${KEY}:0.075:0.0`,
    `crop=${a.cw}:${a.ch}:${a.x}:${a.y}`,
    `scale=${w}:${h}`,
    `pad=${CANVAS}:${CANVAS}:${x}:${y}:color=0x00000000`,
    'format=rgba',
  ]
  if (fps) chain.push(`fps=${fps}`)
  execFileSync(
    ffmpeg,
    ['-y', '-i', src, '-vf', chain.join(','), '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '55', '-loop', '0', '-an', dst],
    { stdio: 'pipe' },
  )
}

function build(fps) {
  return anchors.map((it) => {
    const dst = path.join(outDir, it.out)
    encode({ src: it.src, dst, a: it.a, scale: it.scale, fps })
    return { out: it.out, bytes: fs.statSync(dst).size }
  })
}

fs.mkdirSync(outDir, { recursive: true })
let made = build(null)
let total = made.reduce((n, m) => n + m.bytes, 0)
if (total > 300 * 1024) {
  made = build(10)
  total = made.reduce((n, m) => n + m.bytes, 0)
  console.log('超预算，已降到 10fps')
}

// 降级静态图 + 对照图（四种状态首帧横排）
execFileSync(ffmpeg, ['-y', '-i', path.join(outDir, 'cat-idle.webp'), '-frames:v', '1', path.join(outDir, 'cat-idle.png')], { stdio: 'pipe' })
const frames = []
for (const it of anchors) {
  const png = path.join(outDir, `.frame-${it.out}.png`)
  execFileSync(ffmpeg, ['-y', '-i', path.join(outDir, it.out), '-frames:v', '1', png], { stdio: 'pipe' })
  frames.push(png)
}
const sheet = path.join(outDir, 'cat-states.png')
execFileSync(
  ffmpeg,
  ['-y', ...frames.flatMap((f) => ['-i', f]), '-filter_complex', 'hstack=inputs=4', sheet],
  { stdio: 'pipe' },
)
for (const f of frames) fs.rmSync(f, { force: true })

for (const m of made) console.log(`${m.out.padEnd(16)} ${(m.bytes / 1024).toFixed(1).padStart(7)}KB`)
console.log(`合计 ${(total / 1024).toFixed(1)}KB（预算 300KB）`)
