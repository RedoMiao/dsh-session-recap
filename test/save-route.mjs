// /save 决策体单测：previewId 归属、旧稿拒绝、正在保存、EISDIR 转人话
import assert from 'node:assert'
import { decideSave, humanError } from '../lib/save-route.js'
import { makePending } from '../lib/limit.js'

const pending = makePending()
pending.put('session-A', { previewId: 'p1', file: 'a.md', markdown: 'x' })

assert.equal(decideSave('session-A', pending, 'p1').status, 200)
console.log('· 会话 + previewId 匹配 → 200')

assert.equal(decideSave('session-B', pending, 'p1').status, 409)
console.log('· 不匹配会话 → 409')

const stale = decideSave('session-A', pending, 'p0')
assert.equal(stale.status, 409)
assert.equal(stale.body.code, 'PREVIEW_STALE')
assert.ok(stale.body.error.includes('刷新'), '旧稿提示应让用户刷新')
console.log('· 旧 previewId → 409', stale.body.code)

// 网页入口必须带非空字符串编号：缺失/空白/错类型一律拒绝，不能退化成存最新稿
for (const bad of [undefined, '', '   ', null, 123, {}, [], true]) {
  const rejected = decideSave('session-A', pending, bad)
  assert.equal(rejected.status, 409, `previewId=${JSON.stringify(bad)} 应拒绝`)
  assert.equal(rejected.body.code, 'PREVIEW_STALE')
  assert.ok(rejected.body.error.includes('刷新'), '缺失编号的提示应让用户刷新页面')
}
console.log('· 缺失/空白/错类型 previewId → 409，拒绝保存')

// 另一笔正在写：第二笔不许同时进来
const claimed = pending.claim('session-A', 'p1')
assert.equal(claimed.previewId, 'p1')
const busy = decideSave('session-A', pending, 'p1')
assert.equal(busy.status, 409)
assert.equal(busy.body.code, 'PREVIEW_SAVING')
console.log('· 正在保存 → 409', busy.body.code)

// 写失败释放后可以重试；成功 commit 后不能重复写
pending.release('session-A', 'p1')
assert.equal(pending.inspect('session-A').state, 'ready', '失败后应回到可保存')
assert.equal(decideSave('session-A', pending, 'p1').status, 200)
pending.claim('session-A', 'p1')
pending.commit('session-A', 'p1')
const again = decideSave('session-A', pending, 'p1')
assert.equal(again.status, 409)
assert.equal(again.body.code, 'NO_PREVIEW')
console.log('· 失败可重试 / 成功后重复保存 → 409', again.body.code)

// commit 只删同一稿：后来替换的新稿不能被旧保存收尾误删
const p2 = makePending()
p2.put('S', { previewId: 'old', file: 'a.md', markdown: 'old' })
p2.put('S', { previewId: 'new', file: 'b.md', markdown: 'new' })
assert.equal(p2.commit('S', 'old'), false, '旧稿不能删掉新稿')
assert.equal(p2.peek('S').previewId, 'new')
console.log('· 旧稿收尾不影响新稿')

const eisdir = humanError(Object.assign(new Error('EISDIR: illegal operation'), { code: 'EISDIR' }))
assert.equal(eisdir.status, 409)
assert.ok(eisdir.message.includes('同名文件夹'))
console.log('· EISDIR →', eisdir.status, eisdir.message)

const other = humanError(new Error('boom'))
assert.equal(other.status, 500)
assert.equal(humanError(Object.assign(new Error('x'), { code: 'PREVIEW_STALE' })).status, 409)
console.log('· 普通错误 → 500 / PREVIEW_STALE → 409')
console.log('save-route ok')
