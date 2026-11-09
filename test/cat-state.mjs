// 小猫状态机四条断言
import assert from 'node:assert'
import { catState, CLICK_MS, SLEEP_MS } from '../lib/flow.js'

// 1) 点击 → click，播满一个循环后回 idle
let s = catState({ state: 'idle' }, { type: 'click' }, 1000)
assert.equal(s.state, 'click')
s = catState(s, { type: 'tick' }, 1000 + CLICK_MS - 1)
assert.equal(s.state, 'click', '循环没播完不该回 idle')
s = catState(s, { type: 'tick' }, 1000 + CLICK_MS)
assert.equal(s.state, 'idle', '一个循环后应回 idle')
console.log('· 点击后', CLICK_MS, 'ms 回 idle:', s.state)

// 2) 拖拽优先于 sleep：即使已超 60 秒无交互，拖动仍是 drag
let d = catState({ state: 'idle', lastActivity: 0 }, { type: 'dragstart' }, 5 * SLEEP_MS)
assert.equal(d.state, 'drag')
d = catState(d, { type: 'tick' }, 6 * SLEEP_MS)
assert.equal(d.state, 'drag', '拖动中不得进入 sleep')
d = catState(d, { type: 'dragend' }, 6 * SLEEP_MS)
assert.equal(d.state, 'idle')
console.log('· 拖拽优先：tick 后仍为', d.state === 'idle' ? 'drag→idle' : d.state, '（松开回 idle）')

// 3) 60 秒无交互且面板关闭 → sleep
let sl = catState({ state: 'idle', lastActivity: 0 }, { type: 'tick', panelOpen: false }, SLEEP_MS - 1)
assert.equal(sl.state, 'idle', '不到 60 秒不该睡')
sl = catState({ state: 'idle', lastActivity: 0 }, { type: 'tick', panelOpen: false }, SLEEP_MS)
assert.equal(sl.state, 'sleep', '满 60 秒应入睡')
const open = catState({ state: 'idle', lastActivity: 0 }, { type: 'tick', panelOpen: true }, SLEEP_MS * 2)
assert.equal(open.state, 'idle', '面板开着不该睡')
console.log('· 60 秒 → sleep:', sl.state, '| 面板开着保持:', open.state)

// 4) 页面隐藏只暂停，不改变状态
const hidden = catState({ state: 'click', until: 5000 }, { type: 'hidden' }, 2000)
assert.equal(hidden.state, 'click', '隐藏不该改状态')
assert.equal(hidden.paused, true, '隐藏应标记为暂停')
const visible = catState(hidden, { type: 'visible' }, 3000)
assert.equal(visible.paused, false)
console.log('· hidden 暂停但不换状态:', hidden.state, '| paused=', hidden.paused)

// 附加：sleep 状态下任意活动 → idle
const wake = catState({ state: 'sleep' }, { type: 'activity' }, 1000)
assert.equal(wake.state, 'idle')
console.log('· sleep + activity →', wake.state)

console.log('catState ok')

// —— 指针语义 ——
// 1) 按下不移动 2 秒 → 仍是 idle
let p = catState({ state: 'idle' }, { type: 'press' }, 1000)
p = catState(p, { type: 'tick', panelOpen: false }, 3000)
assert.equal(p.state, 'idle', '按下不移动不应进 drag')
console.log('· 按下不移动 2 秒 →', p.state)

// 2) 移动 10px → drag；松手 → idle
let d2 = catState({ state: 'idle' }, { type: 'press' }, 1000)
d2 = catState(d2, { type: 'dragstart' }, 1100)
assert.equal(d2.state, 'drag')
d2 = catState(d2, { type: 'dragend' }, 1200)
assert.equal(d2.state, 'idle')
console.log('· 移动后 drag → 松手', d2.state)

// 3) click 1299ms 仍 click，1301ms 回 idle
let c = catState({ state: 'idle' }, { type: 'click' }, 1000)
c = catState(c, { type: 'tick', panelOpen: true }, 1000 + CLICK_MS - 1)
assert.equal(c.state, 'click')
c = catState(c, { type: 'tick', panelOpen: true }, 1000 + CLICK_MS + 1)
assert.equal(c.state, 'idle')
console.log('· click 播满一个循环后才回', c.state)

// 4) click 期间 tick 不得切到 drag/sleep
let k = catState({ state: 'idle' }, { type: 'click' }, 1000)
k = catState(k, { type: 'tick', panelOpen: false }, 1000 + CLICK_MS - 100)
assert.equal(k.state, 'click', 'click 期间 tick 不能改状态')
console.log('· click 期间 tick 保持', k.state)

console.log('catState pointer ok')
