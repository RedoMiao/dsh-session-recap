// ② 状态机单测：不需要 jsdom，直接断言纯逻辑
import assert from 'node:assert'
import { createFlow, needsReload, bannerFor, createVaultPick } from '../lib/flow.js'

// 选库状态机：未选不可确认 / 选中可确认 / 确认后保留选中并给回执
const vp = createVaultPick()
assert.equal(vp.canConfirm(), false, '未选中时不应可确认')
vp.select({ path: 'C:/vaults/A', name: 'A' })
assert.equal(vp.canConfirm(), true, '选中后应可确认')
vp.confirm('A')
assert.equal(vp.state().selected?.name, 'A', '确认后选中应保留')
assert.equal(vp.state().receipt, '已设置为：A', '确认后应有回执')
assert.equal(vp.canConfirm(), true, '确认后仍指向该库，可再次确认')
console.log('· vault 状态机: 未选 false / 选中 true / 确认后保留选中 + 回执:', vp.state().receipt)

const vp2 = createVaultPick()
vp2.select({ path: 'Q:/nope', name: 'nope' })
vp2.fail('目录不存在')
assert.equal(vp2.state().error, '目录不存在')
assert.equal(vp2.state().receipt, '', '失败不该有成功回执')
console.log('· vault 校验失败:', vp2.state().error)

// 候选与手填互斥：打字清掉候选选中
const vp3 = createVaultPick()
vp3.select({ path: 'C:/vaults/A', name: 'A' })
assert.equal(vp3.current().path, 'C:/vaults/A')
vp3.typed('c')
assert.equal(vp3.state().selected, null, '打字后候选选中应清空')
assert.equal(vp3.current().path, 'c', '当前选择应变成手填值')
assert.equal(vp3.canConfirm(), true, '手填非空仍可确认')
console.log('· 打字清空候选选中，当前选择 = 手填值:', vp3.current().path)

// 回归：确认后仍保留选中，且回执不被"自动选中"抹掉
const vp5 = createVaultPick()
vp5.select({ path: 'C:/vaults/A', name: 'A' })
vp5.confirm('A')
assert.equal(vp5.state().selected?.name, 'A', '确认后选中应保留（不被清空）')
assert.ok(vp5.state().receipt.includes('已设置为'), '确认后应有回执')
vp5.ensureSelected([{ path: 'C:/vaults/B', name: 'B' }])
assert.equal(vp5.state().receipt, '已设置为：A', '渲染/自动选中不得抹掉回执')
assert.equal(vp5.state().selected?.name, 'A', '已有选中时 ensureSelected 不应改选')
console.log('· 确认后保留选中，二次渲染回执仍在:', vp5.state().receipt)

// 默认选中只在显式调用时发生
const vp6 = createVaultPick()
vp6.ensureSelected([{ path: 'C:/vaults/First', name: 'First' }])
assert.equal(vp6.state().selected?.name, 'First', 'ensureSelected 应选中第一条')
vp6.ensureSelected([])
assert.equal(vp6.state().selected?.name, 'First', '空列表不应清掉已有选中')
console.log('· ensureSelected 选中第一条，空列表不动')


const f = createFlow()

// 1) pick(A) → confirm → summaryDone(A) → 可保存
f.pick('A')
f.confirm()
f.summaryDone('A')
assert.equal(f.canSave(), true)
console.log('· 用例1 完成一轮后可保存:', f.canSave())

// 2) 再 pick(B) → 不可保存，提示含 A
f.pick('B')
assert.equal(f.canSave(), false)
assert.ok(f.hint().includes('A'), '提示里应出现 A')
console.log('· 用例2 切到 B 后 canSave:', f.canSave(), '| hint:', f.hint())

// 3) 切回 A → 可保存
f.pick('A')
assert.equal(f.canSave(), true)
console.log('· 用例3 切回 A 后 canSave:', f.canSave())

// 4) 保存成功后回到 idle，预览清空
f.saved()
assert.equal(f.state().phase, 'idle')
assert.equal(f.state().preview, null)
console.log('· 用例4 保存后:', f.state())

// 5) 降级：拿不到列表仍可确认
const g = createFlow()
g.degrade()
g.confirm()
g.summaryDone('X')
assert.equal(g.canSave(), true)
assert.equal(g.state().degraded, true)
console.log('· 用例5 降级时仍可确认并保存:', g.canSave(), '| degraded:', g.state().degraded)

console.log('flow ok')

// 构建一致时不该提示刷新
assert.equal(needsReload('0.1.0-abc', '0.1.0-abc'), false)
assert.equal(needsReload('0.1.0-abc', '0.1.0-def'), true)
assert.equal(needsReload(undefined, '0.1.0-def'), false)
assert.equal(needsReload('0.1.0-abc', ''), false)
console.log('· needsReload: 相同 false / 不同 true / 缺一 false')
console.log('flow ok')

const b1 = bannerFor('0.1.0-aaa', '0.1.0-bbb')
assert.ok(b1 && b1.text.includes('0.1.0-aaa') && b1.text.includes('0.1.0-bbb'), '不一致时应带两边版本')
assert.equal(bannerFor('0.1.0-aaa', '0.1.0-aaa'), '', '一致时为空')
assert.equal(bannerFor('', '0.1.0-bbb'), '', '缺一为空')
console.log('· bannerFor: 不一致带两版本 / 一致空 / 缺一空')
console.log('flow ok')
