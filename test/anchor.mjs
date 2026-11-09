// anchorFor 四类几何断言：上方放得下 / 下方放得下 / 左右越界夹回 / 面板过高限高
import assert from 'node:assert'
import { anchorFor } from '../lib/flow.js'

const vp = { width: 1200, height: 800 }
const catBottom = { left: 1000, top: 600, width: 68, height: 68 }
const catTop = { left: 300, top: 40, width: 68, height: 68 }

// 1) 上方放得下：面板在猫上方，尖角朝下
const a = anchorFor({ width: 420, height: 300 }, catBottom, vp)
assert.equal(a.dir, 'down')
assert.ok(a.top + a.height <= catBottom.top, '面板底边应在猫上方')
assert.ok(a.left >= 12 && a.left + a.width <= vp.width - 12, 'left 应在视口内')
console.log('· 上方放得下:', JSON.stringify({ dir: a.dir, top: a.top, left: a.left }))

// 2) 猫贴顶：面板放下面，尖角朝上
const b = anchorFor({ width: 420, height: 200 }, catTop, vp)
assert.equal(b.dir, 'up')
assert.ok(b.top >= catTop.top + catTop.height, '面板顶边应在猫下方')
console.log('· 猫贴顶放下方:', JSON.stringify({ dir: b.dir, top: b.top }))

// 3) 左右越界：夹回视口内
const c = anchorFor({ width: 420, height: 200 }, { ...catTop, left: 10 }, vp)
assert.equal(c.left, 12)
const d = anchorFor({ width: 420, height: 200 }, { ...catTop, left: 1140 }, vp)
assert.equal(d.left, vp.width - 420 - 12)
console.log('· 左越界 left =', c.left, '| 右越界 left =', d.left)

// 4) 面板过高：maxHeight 收紧到可用空间，top 不越界
const e = anchorFor({ width: 420, height: 2000 }, catBottom, vp)
assert.ok(e.maxHeight < 2000, 'maxHeight 应收紧')
assert.ok(e.top >= 12 && e.top + e.height <= vp.height - 12, 'top 应在视口内')
assert.ok(e.maxHeight <= Math.round(vp.height * 0.7), '不应超过视口 70%')
console.log('· 过高限高:', JSON.stringify({ maxHeight: e.maxHeight, height: e.height, top: e.top }))

// 5) 尖角贴边：夹到顶后仍朝猫
const f = anchorFor({ width: 420, height: 700 }, catBottom, vp)
assert.equal(f.dir, 'down')
console.log('· 贴顶后朝向:', f.dir, 'top =', f.top)

console.log('anchor ok')
