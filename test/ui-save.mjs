// 保存按钮生产分支：断网、响应解析失败、回执丢失、旧稿/正在写入。
// 直接调用 lib/flow.js 的 runSave（ui.js 用的就是它），不复制一份实现。
import assert from 'node:assert'
import { runSave } from '../lib/flow.js'

const PREVIEW = '# 项目总结\n\n- 修好了保存链路\n- 原稿必须留着'

// 1) 请求完全没到服务端：POST reject → 保留原稿、允许重试
const netFail = await runSave({
  post: async () => {
    throw new TypeError('Failed to fetch')
  },
  sessionId: 'S',
  previewId: 'p1',
  previewMarkdown: PREVIEW,
  toText: (s) => s,
})
assert.equal(netFail.action, 'retry')
assert.equal(netFail.canRetry, true, '断网后按钮必须恢复可点')
assert.equal(netFail.uncertain, true)
assert.ok(netFail.message.includes(PREVIEW), '断网后原预览应保留在界面文案里')
console.log('· POST reject（请求没到服务端）→ 保留原稿、可重试')

// 2) JSON 解析失败也走同一个异常分支：不能把按钮永久禁用
const parseFail = await runSave({
  post: async () => {
    throw new SyntaxError('Unexpected token < in JSON')
  },
  sessionId: 'S',
  previewId: 'p1',
  previewMarkdown: PREVIEW,
  toText: (s) => s,
})
assert.equal(parseFail.action, 'retry')
assert.equal(parseFail.canRetry, true)
assert.equal(parseFail.uncertain, true)
assert.ok(parseFail.message.includes(PREVIEW))
console.log('· 响应不是 JSON → 保留原稿、可重试')

// 3) 服务端已写成功但回执丢失：重试只得到 NO_PREVIEW，不能多写、不能谎报成功
let writes = 0
let consumed = false
const lostPost = async () => {
  consumed = true
  writes += 1
  throw new TypeError('Failed to fetch')
}
const lostTry = await runSave({
  post: lostPost,
  sessionId: 'S',
  previewId: 'p2',
  previewMarkdown: PREVIEW,
  toText: (s) => s,
})
assert.equal(lostTry.action, 'retry')
assert.equal(lostTry.uncertain, true)
assert.equal(consumed, true)
const lostRetry = await runSave({
  post: async () => ({ ok: false, code: 'NO_PREVIEW', error: '还没有预览可保存' }),
  sessionId: 'S',
  previewId: 'p2',
  previewMarkdown: PREVIEW,
  uncertain: lostTry.uncertain,
  toText: (s) => s,
})
assert.equal(lostRetry.action, 'already')
assert.equal(lostRetry.canRetry, false, '服务端已没有这稿时不该让同一份稿反复 POST')
assert.equal(lostRetry.uncertain, true)
assert.ok(!lostRetry.message.includes('已写入'), '结果不明时不能显示“已写入”')
assert.ok(lostRetry.message.includes('很可能上一次其实已经写进去了'))
assert.ok(lostRetry.message.includes(PREVIEW))
assert.equal(writes, 1, '重试不应再写一份')
console.log('· 已写成功但回执丢失 → 重试不重复写、不谎报成功')

// 4) 重试真的成功：清空动作由调用方按 saved 处理
const ok = await runSave({
  post: async () => ({ ok: true, file: 'D:/库/笔记.md' }),
  sessionId: 'S',
  previewId: 'p3',
  previewMarkdown: PREVIEW,
  uncertain: true,
  toText: (s) => s,
})
assert.equal(ok.action, 'saved')
assert.equal(ok.uncertain, false)
assert.equal(ok.file, 'D:/库/笔记.md')
console.log('· 重试成功 → saved，交给界面清预览')

// 5) 旧稿被拒：禁用保存，提示刷新，不再 POST
const stale = await runSave({
  post: async () => ({ ok: false, code: 'PREVIEW_STALE', error: '这稿已经被替换' }),
  sessionId: 'S',
  previewId: 'p-old',
  previewMarkdown: PREVIEW,
  toText: (s) => s,
})
assert.equal(stale.action, 'stale')
assert.equal(stale.canRetry, false)
assert.ok(stale.message.includes('刷新'))
console.log('· PREVIEW_STALE → 禁用保存并提示刷新')

// 6) 另一笔正在写：保留原稿，可稍后重试；不确定状态不能被抹掉
const saving = await runSave({
  post: async () => ({ ok: false, code: 'PREVIEW_SAVING', error: '这稿正在写入' }),
  sessionId: 'S',
  previewId: 'p4',
  previewMarkdown: PREVIEW,
  uncertain: true,
  toText: (s) => s,
})
assert.equal(saving.action, 'retry')
assert.equal(saving.canRetry, true)
assert.equal(saving.uncertain, true)
assert.ok(saving.message.includes('正在写入'))
assert.ok(saving.message.includes(PREVIEW))
console.log('· PREVIEW_SAVING → 保留原稿、可稍后重试')

// 7) 普通写盘失败（如 EISDIR）：显示原因，保留原稿，允许重试
const failed = await runSave({
  post: async () => ({ ok: false, error: '目标位置有个同名文件夹，换个名字或先把它挪走' }),
  sessionId: 'S',
  previewId: 'p5',
  previewMarkdown: PREVIEW,
  toText: (s) => s,
})
assert.equal(failed.action, 'retry')
assert.equal(failed.canRetry, true)
assert.ok(failed.message.includes('同名文件夹'))
assert.ok(failed.message.includes(PREVIEW))
console.log('· 写盘失败 → 显示原因、保留原稿、可重试')

// 8) 明确没有预览：不再让用户对同一份稿反复点保存
const noPreview = await runSave({
  post: async () => ({ ok: false, code: 'NO_PREVIEW', error: '还没有预览可保存' }),
  sessionId: 'S',
  previewId: 'p6',
  previewMarkdown: PREVIEW,
  toText: (s) => s,
})
assert.equal(noPreview.action, 'no-preview')
assert.equal(noPreview.canRetry, false)
assert.ok(noPreview.message.includes('重新生成'))
console.log('· NO_PREVIEW（非回执丢失）→ 引导去库里确认或重新生成')

console.log('ui-save ok')
