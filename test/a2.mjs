// A2：长对话材料取舍 + 无活跃会话的手动选择。
// 全部用生产函数、真实注册路由/命令和 mock 模型；不碰真实配置与笔记。
import assert from 'node:assert'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { buildFactsPrompt, factsToPrompt, PROMPT_LIMITS } from '../lib/facts.js'
import { sessionChoice, createFlow, readSessions } from '../lib/flow.js'
import { pickFreshSession, SESSION_FRESH_MS } from '../lib/sessions.js'

// ——— 1. 纯逻辑：最初目标、第 16 条、最后一条更正都进材料 ———
const asks = []
for (let i = 0; i < 25; i++) {
  if (i === 0) asks.push({ seq: 1, text: '最初目标：把 DSH 对话整理成 Obsidian 项目笔记' })
  else if (i === 15) asks.push({ seq: 16, text: '第 16 条关键更正：旧页面没有编号时，绝不能保存另一窗口的新稿' })
  else if (i === 24) asks.push({ seq: 25, text: '最终决定：保存失败后必须能直接重试，不要重新调用模型' })
  else asks.push({ seq: i + 1, text: `第 ${i + 1} 条普通诉求：继续完善插件功能` })
}
const longFacts = {
  cwd: 'D:/work/demo',
  title: '长对话',
  startedAt: 0,
  turns: 25,
  steps: 80,
  model: 'mock / mock',
  asks,
  files: new Map(),
  shells: [],
  searches: [],
  presents: [],
  errors: [],
  turnWords: [],
}
const built = buildFactsPrompt(longFacts)
for (const key of ['最初目标', '第 16 条关键更正', '最终决定：保存失败后必须能直接重试']) {
  assert.ok(built.text.includes(key), `材料漏了：${key}`)
}
assert.equal(factsToPrompt(longFacts), built.text, 'factsToPrompt 兼容入口返回值不一致')
assert.ok(built.text.indexOf('最初目标') < built.text.indexOf('第 16 条关键更正'), '诉求没有保持时间顺序')
assert.ok(built.text.indexOf('第 16 条关键更正') < built.text.indexOf('最终决定'), '诉求没有保持时间顺序')
assert.ok(built.trim.sentAsks < longFacts.asks.length, '25 条诉求应按名额裁剪')
assert.ok(built.notice.includes('条较早的诉求'), '条数裁剪应有可见说明')
assert.ok(built.text.length <= PROMPT_LIMITS.totalChars, '材料超过总长度上限')
console.log('· 25 条诉求：最初目标 / 第 16 条更正 / 最终决定都进入材料，且按时间排序；裁剪说明可见')

// 单条超长消息：开头目标和末尾更正都要保留，中间省略
const huge = '这是很长的一段说明。'.repeat(800)
const oneLong = buildFactsPrompt({
  ...longFacts,
  asks: [
    { seq: 1, text: '最初目标：修保存' },
    { seq: 2, text: huge + '尾部不能整段发给模型' },
    { seq: 3, text: '最后决定：用临时文件再原子占位' },
  ],
})
assert.ok(oneLong.text.includes('这是很长的一段说明。'), '长消息开头应保留')
assert.ok(oneLong.text.includes('尾部不能整段发给模型'), '长消息末尾的关键更正应保留')
assert.ok(oneLong.text.length < huge.length, '单条长消息没有被截断')
assert.ok(oneLong.notice.includes('只读了重点'), '长消息截断要有平实说明')
assert.ok(!/材料|裁剪|未发送/.test(oneLong.notice), '说明里不能出现材料/裁剪/未发送')
console.log('· 单条超长消息：保留开头和结尾，中间省略，提示改成平实说法')

// 复核用例：唯一更正就在 400 条背景说明之后，生产裁剪仍要保住它
const reproTail = '最终更正：取消云端同步，笔记只保存在本机 FINAL_OVERRIDE_LOCAL_ONLY'
const tailOnly = buildFactsPrompt({
  asks: [
    { text: '最初目标：整理项目笔记 INITIAL_GOAL' },
    { text: '背景说明。'.repeat(400) + reproTail },
  ],
  files: new Map(),
})
assert.ok(tailOnly.text.includes('INITIAL_GOAL'), '最初目标被裁掉了')
assert.ok(tailOnly.text.includes(reproTail), '长消息尾部的最终更正被裁掉了')
assert.ok(tailOnly.notice.includes('只读了重点'), '尾部保留要有平实说明')
console.log('· 复核用例：400 条背景说明后的最终更正进入材料，最初目标同时保留')

// 总量超限：压缩明细并丢掉部分中间诉求，首尾仍在，长度守住
const manyFiles = new Map()
for (let i = 0; i < 60; i++) manyFiles.set(`D:/work/文件-${i}.js`, { ops: new Set(['edit']), hits: i + 1 })
const over = buildFactsPrompt(
  {
    ...longFacts,
    files: manyFiles,
    shells: Array.from({ length: 30 }, (_, i) => `npm run 命令-${i}`),
    errors: Array.from({ length: 30 }, (_, i) => ({ name: 'pwsh', text: `错误-${i}` })),
  },
  { totalChars: 1200 },
)
assert.ok(over.text.length <= 1200, `总量超限后仍超过上限：${over.text.length}`)
assert.ok(over.text.includes('最初目标'), '压缩时不该丢最初目标')
assert.ok(over.text.includes('最终决定'), '压缩时不该丢最后决定')
assert.ok(over.trim.forced, '总量压缩应标记 forced')
assert.ok(over.trim.sentAsks < longFacts.asks.length, '总量超限应减少发送的诉求')
assert.ok(over.notice.includes('只读了重点'), '总量压缩应有可见说明')
assert.ok(!/材料|裁剪|未发送/.test(over.notice), '总量压缩说明不能出现材料/裁剪/未发送')
console.log('· 总量超限：先压缩明细再减少中间诉求，首尾保留，长度 <= 1200，提示可见')

// ——— 2. 会话选择决策：失败可重试、空闲必须手选、不自动挑最近 ———
const list = {
  ok: true,
  current: null,
  items: [
    { sessionId: 'session-11111111-1111-1111-1111-111111111111', title: '对话 A', turns: 3 },
    { sessionId: 'session-22222222-2222-2222-2222-222222222222', title: '对话 B', turns: 4 },
  ],
}
const failed = sessionChoice({ ok: false, error: 'network' })
assert.equal(failed.mode, 'retry', '列表失败应给重试入口')
assert.equal(sessionChoice(list).mode, 'pick', '没有活跃会话时必须手动选')
assert.equal(sessionChoice(list).selected, null, '没有活跃会话时不该自动选中')
const onlyOne = { ...list, items: [list.items[0]] }
assert.equal(sessionChoice(onlyOne).mode, 'pick', '只剩一条也不该自动当成当前会话')
assert.equal(sessionChoice(list, list.items[1].sessionId).mode, 'confirm')
assert.equal(sessionChoice(list, list.items[1].sessionId).selected, list.items[1].sessionId)
assert.equal(sessionChoice({ ...list, current: list.items[0].sessionId }).mode, 'confirm', '有活跃会话时应进入确认条')
assert.equal(sessionChoice({ ...list, current: list.items[0].sessionId }).selected, list.items[0].sessionId)
const stale = sessionChoice(list, 'session-99999999-9999-9999-9999-999999999999')
assert.equal(stale.mode, 'pick', '选中的会话已不在列表时应回到手选')
assert.ok(stale.staleSelection, '应记录失效的旧选择')
const recovered = sessionChoice(list)
assert.equal(recovered.mode, 'pick', '列表恢复后应允许重新选择')

// 生产读取入口：第一次网络失败返回 ok:false，再拉一次恢复；界面重试就是再调它
let sessionCalls = 0
const flakyGet = async () => {
  sessionCalls += 1
  if (sessionCalls === 1) throw new TypeError('Failed to fetch')
  return list
}
const firstRead = await readSessions(flakyGet)
assert.equal(firstRead.ok, false, '首次失败应返回 ok:false')
assert.equal(sessionChoice(firstRead).mode, 'retry', '首次失败应给重试入口')
const secondRead = await readSessions(flakyGet)
assert.equal(secondRead.ok, true, '重试后应恢复')
assert.equal(sessionChoice(secondRead).mode, 'pick', '恢复后应允许选定会话')
console.log('· 会话选择：失败→重试；无活跃/只剩一条→手选；恢复后可选；不自动挑最近')

// 两个会话都超过 2 分钟：生产的新鲜度判定返回 null（不等待、不改系统时钟）
const now = 1_000_000_000
const bothIdle = new Map([
  [list.items[0].sessionId, now - SESSION_FRESH_MS - 1],
  [list.items[1].sessionId, now - SESSION_FRESH_MS - 60_000],
])
assert.equal(pickFreshSession(bothIdle, now), null, '两个都超过 2 分钟不该算活跃')
const oneFresh = new Map([
  [list.items[0].sessionId, now - SESSION_FRESH_MS - 1],
  [list.items[1].sessionId, now - 1000],
])
assert.equal(pickFreshSession(oneFresh, now), list.items[1].sessionId, '2 分钟内活跃的会话应被识别')
assert.equal(pickFreshSession(new Map(), now), null, '刚启用没有任何事件时应为 null')
console.log('· 2 分钟新鲜度：两条都过期→null；一条新鲜→该条；空记录（刚启用）→null')

// ——— 3. 真实插件链路：mock 模型收到的是裁剪后的材料 ———
const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'recap-a2-home-'))
const vault = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'recap-a2-vault-')), '库')
await fsp.mkdir(path.join(vault, '.obsidian'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const A = list.items[0].sessionId
const B = list.items[1].sessionId
const C = 'session-33333333-3333-3333-3333-333333333333'
const sessions = [
  { id: A, header: { createdAt: 1 } },
  { id: B, header: { createdAt: 2 } },
]
let liveSessions = sessions.slice()

const eventsFor = (id) => {
  if (id === A) {
    const events = []
    asks.forEach((a, i) => {
      // 普通诉求也写得长一些，用来验证「模板很长时，事实材料会被压进剩余预算」
      const text = [0, 15, 24].includes(i) ? a.text : `${a.text}。补充细节：${'背景说明'.repeat(60)}`
      events.push({ type: 'turn/start', data: { turn: i + 1 } })
      events.push({
        type: 'user/message',
        seq: i + 1,
        data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
      })
      events.push({
        type: 'assistant/message',
        data: { turn: i + 1, message: { content: [{ type: 'text', text: `第 ${i + 1} 轮回复` }] } },
      })
      events.push({ type: 'turn/end', data: { turn: i + 1 }, time: 100 + i })
    })
    return { session: { id, cwd: 'D:/work/项目A', createdAt: 1 }, events }
  }
  if (id === C) {
    // 第一条单独超长：最初目标在开头，唯一最终更正在 400 段背景之后
    const text =
      '最初目标：把复盘整理成笔记 INITIAL_GOAL。' +
      '背景说明。'.repeat(400) +
      '最终更正：取消云端同步，笔记只保存在本机 FINAL_OVERRIDE_LOCAL_ONLY'
    return {
      session: { id, cwd: 'D:/work/项目C', createdAt: 3 },
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        {
          type: 'user/message',
          seq: 1,
          data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
        },
        {
          type: 'assistant/message',
          data: { turn: 1, message: { content: [{ type: 'text', text: '收到' }] } },
        },
        { type: 'turn/end', data: { turn: 1 }, time: 300 },
      ],
    }
  }
  return {
    session: { id, cwd: 'D:/work/项目B', createdAt: 2 },
    events: [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        seq: 1,
        data: {
          content: [{ type: 'text', text: 'B 专属需求：把小猫放在右下角，可以拖动' }],
          source: { kind: 'user' },
        },
      },
      {
        type: 'assistant/message',
        data: { turn: 1, message: { content: [{ type: 'text', text: '好' }] } },
      },
      { type: 'turn/end', data: { turn: 1 }, time: 200 },
    ],
  }
}

const routes = []
const commands = new Map()
const events = {}
let tapIndex = null
const prompts = []
const requests = []
let callNo = 0
let emptyAttempts = 0

const ctx = {
  on: (name, fn) => {
    events[name] = fn
    return () => {}
  },
  get: (name) => (name === 'sessions' ? { list: () => liveSessions } : undefined),
  commands: {
    register: (def) => {
      commands.set(def.name, def)
      return () => {}
    },
  },
  sessionQuery: {
    readSession: async (id) => eventsFor(id),
    readTitle: async (id) => ({ title: id === A ? '长对话 A' : '短对话 B' }),
  },
  llm: {
    resolveModelInfo: async () => ({ defaultMaxTokens: 8000 }),
    stream: (opts) => {
      const prompt = opts.messages?.[0]?.content?.[0]?.text ?? ''
      prompts.push(prompt)
      requests.push({ prompt, system: opts.system ?? '', total: prompt.length + (opts.system ?? '').length })
      callNo += 1
      const empty = emptyAttempts > 0
      if (empty) emptyAttempts -= 1
      const body = `# 笔记 ${callNo}\n\n正文 ${callNo}`
      return (async function* () {
        if (!empty) yield { type: 'text-delta', text: body }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  },
  inject: (_deps, fn) =>
    fn({
      webServer: {
        register: (r) => (routes.push(r), () => {}),
        tapIndex: (fn2) => (tapIndex = fn2),
      },
    }),
  effect: () => () => {},
}

const { default: plugin, PROMPT_TOTAL_MAX, SYSTEM, SYSTEM_TASK } = await import('../lib/index.js')
assert.equal(PROMPT_TOTAL_MAX, 24000, '硬上限必须是 24000，不能悄悄提高')
plugin(ctx, {})

const html = tapIndex('<!doctype html>')
const token = JSON.parse(html.match(/__dshRecapToken=(("(?:[^"\\]|\\.)*"))/)[1])

function call(routePath, { method = 'POST', headers = {}, body = '' } = {}) {
  const route = routes.find((r) => r.path === routePath)
  assert.ok(route, `没有路由 ${routePath}`)
  return new Promise((resolve, reject) => {
    const req = new Readable({ read() {} })
    req.method = method
    req.headers = {
      host: '127.0.0.1:1',
      'content-type': 'application/json',
      'x-recap-token': token,
      ...headers,
    }
    const res = {
      headersSent: false,
      statusCode: 0,
      payload: '',
      writeHead(code) {
        this.statusCode = code
        this.headersSent = true
      },
      end(text) {
        this.payload = String(text ?? '')
        resolve(this)
      },
    }
    Promise.resolve(route.handler(req, res)).catch(reject)
    req.push(body)
    req.push(null)
  })
}
const json = (res) => JSON.parse(res.payload)

let res = await call('/dsh-recap/config', {
  body: JSON.stringify({
    config: { vaultPath: vault, provider: 'deepseek', model: 'deepseek-chat', projectRoot: '项目经历' },
  }),
})
assert.equal(res.statusCode, 200)

// 插件刚启用、两个会话都空闲超过 2 分钟：current=null，列表仍可手选
res = await call('/dsh-recap/sessions', { method: 'GET' })
const sessionsPayload = json(res)
assert.equal(sessionsPayload.current, null, '刚启用时不该有最近活跃会话')
assert.equal(sessionsPayload.items.length, 2)
assert.equal(sessionChoice(sessionsPayload).mode, 'pick', '两个空闲会话应进入手选')
console.log('· 真实 /sessions：两个会话空闲、current=null，生产决策为手选')

// 追加「第一条消息超长」的会话，供后面的生产总结链路回归
sessions.push({ id: C, header: { createdAt: 3 } })
liveSessions = sessions.slice()

// 只剩一条也不自动：HTTP /summary 缺 sessionId 必须 409，且不调用模型
liveSessions = [sessions[0]]
const promptsBefore = prompts.length
res = await call('/dsh-recap/summary', { body: '{}' })
assert.equal(res.statusCode, 409, '只剩一条也不该自动总结')
assert.equal(prompts.length, promptsBefore, '缺 sessionId 时不该调用模型')
liveSessions = sessions.slice()
console.log('· 只剩一条且缺 sessionId → 409，未调用模型')

// 命令入口跑完整长对话链路：mock 模型实际收到的提示词包含三处关键内容
const summaryCmd = commands.get('summary')
assert.ok(summaryCmd, '没有注册 /summary')
const longPreview = await summaryCmd.handler({ agent: { id: A } })
assert.equal(longPreview.kind, 'success')
const longPrompt = prompts.at(-1)
for (const key of ['最初目标', '第 16 条关键更正', '最终决定：保存失败后必须能直接重试']) {
  assert.ok(longPrompt.includes(key), `模型实际输入漏了：${key}`)
}
assert.ok(longPrompt.length + SYSTEM.length <= PROMPT_TOTAL_MAX, `整段请求超长：${longPrompt.length + SYSTEM.length}`)
assert.ok(longPreview.text.includes('只读了重点'), '/summary 预览应显示平实的读取范围说明')
assert.ok(!/材料经过裁剪|未发送/.test(longPreview.text), '/summary 不能出现旧的裁剪话术')
console.log('· 生产 /summary + mock 模型：实际输入包含最初目标、第 16 条更正、最终决定；预览带裁剪说明')

// 第一条消息单独超长：唯一最终更正在 400 段背景之后，生产链路仍要送到模型
const tailPreview = await summaryCmd.handler({ agent: { id: C } })
assert.equal(tailPreview.kind, 'success')
const tailPrompt = prompts.at(-1)
assert.ok(tailPrompt.includes('INITIAL_GOAL'), '模型实际输入漏了开头的初始目标')
assert.ok(tailPrompt.includes('FINAL_OVERRIDE_LOCAL_ONLY'), '模型实际输入漏了长消息尾部的最终更正')
assert.ok(tailPreview.text.includes('只读了重点'), '预览里的读取范围说明缺失')
console.log('· 生产 /summary + mock 模型：第一条超长消息的初始目标与末尾最终更正都进入实际输入')

// 模板本身很长时，整个提示词仍有硬上限：只压事实材料，不动用户模板
const cfgNow = json(await call('/dsh-recap/config', { method: 'GET' })).config
const hugeBody = '要求：只写结论与踩坑。\n' + '背景说明。'.repeat(4000)
res = await call('/dsh-recap/config', {
  body: JSON.stringify({ config: { templates: [{ name: '超长模板', body: hugeBody, color: '#f3dfae' }], activeTemplate: 0 } }),
})
assert.equal(res.statusCode, 200)
const hugePreview = await summaryCmd.handler({ agent: { id: A } })
assert.equal(hugePreview.kind, 'success')
const hugePrompt = prompts.at(-1)
assert.ok(hugePrompt.includes(hugeBody.slice(0, 200)), '用户模板应原样保留')
// 这段正文不含【】，0.2.6 起走指令模式，比较时要算它实际使用的系统提示词。
assert.ok(
  hugePrompt.length + SYSTEM_TASK.length <= PROMPT_TOTAL_MAX,
  `整段请求超过硬上限：${hugePrompt.length + SYSTEM_TASK.length}`,
)
assert.ok(hugePreview.text.includes('只读了重点'), '模板很长时预览应显示读取范围说明')
console.log('· 20k 模板 + 长对话：system+用户 <= 24000，模板不裁剪，事实材料按剩余预算压缩并提示')

// 模板封顶 20480 + 前两次空回复：三次真实请求都要守住 24000，模板完整、关键要求仍在
const maxTemplateBody = ('【上限模板】' + '模'.repeat(20480)).slice(0, 20 * 1024)
assert.equal(maxTemplateBody.length, 20480, '测试模板必须正好 20480 字符')
res = await call('/dsh-recap/config', {
  body: JSON.stringify({
    config: { templates: [{ name: '上限模板', body: maxTemplateBody, color: '#f3dfae' }], activeTemplate: 0 },
  }),
})
assert.equal(res.statusCode, 200)
emptyAttempts = 2
const beforeRequests = requests.length
const retryPreview = await summaryCmd.handler({ agent: { id: A } })
assert.equal(retryPreview.kind, 'success', '第三次兜底应返回笔记')
const retryRequests = requests.slice(beforeRequests)
assert.equal(retryRequests.length, 3, '前两次空回复后应正好发起三次请求')
const retryKeys = ['最初目标', '第 16 条关键更正', '最终决定：保存失败后必须能直接重试']
for (const [i, req] of retryRequests.entries()) {
  assert.ok(
    req.total <= PROMPT_TOTAL_MAX,
    `第 ${i + 1} 次请求 system+用户 = ${req.total}，超过 ${PROMPT_TOTAL_MAX}`,
  )
  assert.ok(req.prompt.includes(maxTemplateBody), `第 ${i + 1} 次请求的用户模板被裁剪`)
  for (const key of retryKeys) assert.ok(req.prompt.includes(key), `第 ${i + 1} 次请求漏了：${key}`)
}
assert.ok(retryPreview.text.includes('只读了重点'), '长模板重试链路应有可见读取范围说明')
console.log(
  `· 20480 模板 + 两次空回复：三次请求 system+用户 = ${retryRequests.map((r) => r.total).join('/')}，均 <= 24000，模板完整、关键要求保留`,
)
res = await call('/dsh-recap/config', {
  body: JSON.stringify({ config: { templates: cfgNow.templates, activeTemplate: cfgNow.activeTemplate } }),
})
assert.equal(res.statusCode, 200)

// 明确选 B：总结、模型输入、预览归属、保存必须都是 B
// 限流窗口 5 秒；上面缺 sessionId 的请求也走了一次限流判断，这里让开窗口
await new Promise((r) => setTimeout(r, 5100))
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: B }) })
assert.equal(res.statusCode, 200)
const bPreview = json(res)
assert.equal(bPreview.sessionId, B, '响应归属不是 B')
assert.equal(bPreview.meta.sessionId, B, '预览归属不是 B')
const bPrompt = prompts.at(-1)
assert.ok(bPrompt.includes('B 专属需求'), '模型输入不是 B 的内容')
assert.ok(!bPrompt.includes('最初目标：把 DSH 对话'), '模型输入混入了 A 的内容')

// 拿 B 的稿冒充 A 保存：必须拒绝，且不写盘
const bDir = path.dirname(bPreview.file)
const filesBefore = fs.existsSync(bDir) ? fs.readdirSync(bDir).length : 0
res = await call('/dsh-recap/save', { body: JSON.stringify({ sessionId: A, previewId: bPreview.previewId }) })
assert.equal(res.statusCode, 409)
assert.equal(json(res).code, 'PREVIEW_STALE')
assert.equal(fs.existsSync(bDir) ? fs.readdirSync(bDir).length : 0, filesBefore, '串会话保存写盘了')

// 正常保存 B：文件落在 B 的项目目录，正文与预览一致
res = await call('/dsh-recap/save', { body: JSON.stringify({ sessionId: B, previewId: bPreview.previewId }) })
assert.equal(res.statusCode, 200)
const bFile = json(res).file
assert.ok(bFile.includes('项目B'), '文件没有落在 B 的目录')
assert.ok(!bFile.includes('项目A'), '文件落到了 A 的目录')
assert.equal(fs.readFileSync(bFile, 'utf8'), bPreview.markdown, '磁盘正文与预览不一致')
console.log('· 手选 B：模型输入 / 预览归属 / 保存路径 / 磁盘正文全部是 B；冒充 A 保存 409 且不写盘')

// UI 状态机：B 的预览还在时切到 A，不能保存 B 的稿
const flow = createFlow()
flow.pick(B)
flow.summaryDone(B)
flow.pick(A)
assert.equal(flow.canSave(), false, '切到 A 后不该还能保存 B 的稿')
assert.ok(flow.hint().includes(B), '提示应说明预览属于 B')
console.log('· 预览属于 B 时切到 A：canSave=false，提示指向 B')

await fsp.rm(home, { recursive: true, force: true })
await fsp.rm(path.dirname(vault), { recursive: true, force: true })
console.log('a2 ok')
