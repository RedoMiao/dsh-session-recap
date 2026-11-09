// 0.2.5：无库生成 / 长对话读取范围 / 读全部分段 / 续写 / 输出以模板为准。
// 真实插件 + 真实路由 + 假 ctx.llm/sessionQuery；只写临时 HOME 和临时库。
import assert from 'node:assert'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'recap-b25-home-'))
const vault = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'recap-b25-vault-')), '库')
await fsp.mkdir(path.join(vault, '.obsidian'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const { default: plugin, SYSTEM } = await import('../lib/index.js')
const { splitFactsForAll, fullFactsText } = await import('../lib/facts.js')

assert.ok(SYSTEM.includes('篇幅以模板或用户要求为准'), '系统提示词没有改成以模板篇幅为准')
assert.ok(!SYSTEM.includes('800-1500'), '系统提示词里仍写死 800-1500 字')

const LONG = 'session-11111111-1111-1111-1111-111111111111'
const SHORT = 'session-22222222-2222-2222-2222-222222222222'
const TRUNC = 'session-33333333-3333-3333-3333-333333333333'
const CMD = 'session-44444444-4444-4444-4444-444444444444'

const longAsks = Array.from({ length: 137 }, (_, i) => {
  const tag = i === 0 ? '最初目标' : i === 136 ? '最后决定' : `中间诉求${i + 1}`
  return `【L${i + 1}】第 ${i + 1} 条${tag}：把 DSH 会话里的${'细节'.repeat(80)}记进笔记`
})
const shortAsks = ['【S1】最初需求：无库也能生成', '【S2】更正：保存时才要库', '【S3】最后确认：原稿不能丢']
const cmdAsks = ['【C1】命令入口也要能无库预览']
const truncAsks = ['【T1】写一篇长文', '【T2】不要遗漏结论']

function eventsFor(id, asks, steps = asks.length) {
  const events = []
  asks.forEach((text, i) => {
    events.push({ type: 'turn/start', data: { turn: i + 1 } })
    events.push({ type: 'step/start', data: {} })
    events.push({
      type: 'user/message',
      seq: i + 1,
      data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
    })
    events.push({
      type: 'assistant/message',
      data: { turn: i + 1, message: { content: [{ type: 'text', text: `第 ${i + 1} 轮回复` }] } },
    })
    events.push({ type: 'turn/end', data: { turn: i + 1 }, time: i })
  })
  for (let i = asks.length; i < steps; i++) {
    events.push({ type: 'step/start', data: {} })
    events.push({
      type: 'tool/call',
      data: { name: 'pwsh', arguments: JSON.stringify({ description: `命令 ${i}` }), callId: `call-${i}` },
    })
  }
  return { session: { id, cwd: `D:/work/${id}`, createdAt: 1 }, events }
}

const sessions = [
  { id: LONG, header: { createdAt: 3 } },
  { id: SHORT, header: { createdAt: 2 } },
  { id: TRUNC, header: { createdAt: 1 } },
  { id: CMD, header: { createdAt: 0 } },
]

const routes = []
const commands = new Map()
const events = {}
let tapIndex = null
const calls = []
let callNo = 0
let truncateNext = false

const ctx = {
  on: (name, fn) => {
    events[name] = fn
    return () => {}
  },
  get: (name) => (name === 'sessions' ? { list: () => sessions } : undefined),
  commands: {
    register: (def) => {
      commands.set(def.name, def)
      return () => {}
    },
  },
  sessionQuery: {
    readSession: async (id) => {
      if (id === LONG) return eventsFor(id, longAsks, 800)
      if (id === TRUNC) return eventsFor(id, truncAsks)
      if (id === CMD) return eventsFor(id, cmdAsks)
      return eventsFor(id, shortAsks)
    },
    readTitle: async (id) => ({ title: `合成会话 ${id.slice(8, 12)}` }),
  },
  llm: {
    resolveModelInfo: async () => ({ defaultMaxTokens: 8000 }),
    stream: (opts) => {
      const system = opts.system ?? ''
      const prompt = opts.messages?.[0]?.content?.[0]?.text ?? ''
      calls.push({ system, prompt })
      callNo += 1
      const isExtract = system.includes('事实提取助手')
      if (isExtract) {
        const m = prompt.match(/第 \d+\/\d+ 段\n([\s\S]*?)\n\n请提取/)
        const body = m ? m[1] : prompt
        return (async function* () {
          yield { type: 'text-delta', text: body }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      }
      if (prompt.includes('## 已写好的部分')) {
        return (async function* () {
          yield { type: 'text-delta', text: '【续写】后半段结论：保存写全文，不丢前半段。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      }
      if (truncateNext) {
        truncateNext = false
        return (async function* () {
          yield { type: 'text-delta', text: '# 半稿\n\n【前半段】写到单次上限。' }
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        })()
      }
      return (async function* () {
        yield { type: 'text-delta', text: `# 笔记 ${callNo}\n\n正文 ${callNo}` }
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let res = await call('/dsh-recap/config', {
  body: JSON.stringify({
    config: {
      provider: 'mock',
      model: 'mock-model',
      projectRoot: '项目经历',
      templates: [
        { name: '测试模板', body: '# 标题\n\n## 要点\n- 【填写】\n\n## 结论\n- 【填写】', color: '#f3dfae' },
        { name: '空模板', body: '', color: '#c9e4d2' },
      ],
      activeTemplate: 0,
    },
  }),
})
assert.equal(res.statusCode, 200)

// —— 1. 长对话：先 NEED_SCOPE，不调模型；只读重点只调 1 次；读全部 = 分段数 + 1 ——
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: LONG }) })
assert.equal(res.statusCode, 409)
const need = json(res)
assert.equal(need.code, 'NEED_SCOPE')
assert.equal(calls.length, 0, 'NEED_SCOPE 不能调用模型')
assert.equal(need.stats.asks, 137)
assert.equal(need.stats.steps, 800)
assert.ok(need.stats.estChunks > 1, '137 条诉求 / 800 步应估算出多段')
assert.ok(need.error.includes('先选怎么读'))
console.log(`· 长对话 NEED_SCOPE：模型 0 调用，stats=${JSON.stringify(need.stats)}`)

res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: LONG, scope: 'recent' }) })
assert.equal(res.statusCode, 200)
const recent = json(res)
assert.equal(calls.length, 1, '只读重点应只调用 1 次模型')
assert.equal(recent.scope, 'recent')
assert.equal(recent.file, '', '无库时预览的 file 应为空')
assert.ok(recent.markdown)
assert.ok(recent.trimNotice.includes('只读了重点'), '只读重点要有平实说明')
assert.ok(!/材料|裁剪|未发送|上限/.test(recent.trimNotice), '说明里不能出现旧话术')
assert.ok(recent.trimNotice.includes('改用完整读取'), '说明要指向完整读取入口')
console.log('· 只读重点：1 次模型调用，file 为空，说明无「材料/裁剪/未发送」')

const beforeAll = calls.length
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: LONG, scope: 'all' }) })
assert.equal(res.statusCode, 200)
const all = json(res)
assert.equal(all.scope, 'all')
assert.ok(all.chunks > 1, '读全部应分段')
assert.equal(calls.length - beforeAll, all.chunks + 1, '读全部调用次数应为分段数 + 1')
assert.ok(all.trimNotice.includes('读全部时'), '分段读全部要有如实说明')
assert.equal(all.file, '')
const finalPrompt = calls.at(-1).prompt
for (const tag of ['【L1】', '【L35】', '【L70】', '【L105】', '【L137】']) {
  assert.ok(finalPrompt.includes(tag), `最终提示词漏了 ${tag}`)
}
assert.ok(!/本次总结的材料经过裁剪|未发送/.test(finalPrompt), '最终提示词不应含旧话术')
console.log(
  `· 读全部：${all.chunks} 段 + 1 次生成 = ${calls.length - beforeAll} 次调用；首条/中间三条/最后一条都进最终提示词`,
)

// 纯函数：分段覆盖第一条到最后一条，且每段不超上限太多
const plan = splitFactsForAll(
  { asks: longAsks.map((text, i) => ({ seq: i, text })), steps: 800, turns: 137, files: new Map(), shells: [], searches: [], presents: [], errors: [], turnWords: [] },
  4000,
)
assert.ok(plan.count > 1)
assert.ok(plan.chunks[0].includes('【L1】'))
assert.ok(plan.chunks.at(-1).includes('【L137】'))
for (const c of plan.chunks) assert.ok(c.length <= 4080, `分段过长：${c.length}`)
assert.ok(fullFactsText({ asks: longAsks.map((text) => ({ text })), files: new Map(), shells: [], searches: [], presents: [], errors: [], turnWords: [] }).includes('【L137】'))
console.log('· 分段纯函数：首尾覆盖，每段受控，完整材料不丢最后一条')

// 命令入口无库：照常预览，不出现「将写入：」空路径
const summaryCmd = commands.get('summary')
assert.ok(summaryCmd, '没有注册 /summary')
const cmdPreview = await summaryCmd.handler({ agent: { id: CMD } })
assert.equal(cmdPreview.kind, 'success')
assert.ok(cmdPreview.text.includes('还没选库'), '无库命令预览应提示选库')
assert.ok(!cmdPreview.text.includes('将写入：'), '无库命令预览不能出现空写入路径')
console.log('· 命令 /summary 无库：仍出预览，结尾提示选库，没有空写入路径')

// —— 2. 短对话不询问，直接生成；无库保存 409，选库后同一稿成功 ——
await sleep(5100)
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: SHORT }) })
assert.equal(res.statusCode, 200)
const shortPreview = json(res)
assert.equal(shortPreview.scope, 'direct')
assert.equal(shortPreview.trimNotice, '', '短对话不应出现读取范围提示')
assert.equal(shortPreview.file, '')
console.log('· 短对话：直接生成，无 NEED_SCOPE，无多余提示')

res = await call('/dsh-recap/save', {
  body: JSON.stringify({ sessionId: SHORT, previewId: shortPreview.previewId }),
})
assert.equal(res.statusCode, 409)
assert.equal(json(res).code, 'NO_VAULT')
assert.ok(json(res).error.includes('这稿还在'))
console.log('· 无库保存：409 NO_VAULT，提示原稿还在')

res = await call('/dsh-recap/config', { body: JSON.stringify({ config: { vaultPath: vault } }) })
assert.equal(res.statusCode, 200)
res = await call('/dsh-recap/save', {
  body: JSON.stringify({ sessionId: SHORT, previewId: shortPreview.previewId }),
})
assert.equal(res.statusCode, 200, '选库后同一 previewId 应能保存')
const shortFile = json(res).file
assert.ok(shortFile.includes('项目经历'), '保存路径不在库的项目经历下')
assert.ok(shortFile.includes('session-2222'), '保存路径没有项目名')
assert.equal(fs.readFileSync(shortFile, 'utf8'), shortPreview.markdown, '磁盘正文与预览不一致')
console.log('· 选库后同一稿保存成功，路径/正文正确，未重新生成')

// —— 3. 触顶 + 继续写：新 previewId，保存写追加后的全文 ——
truncateNext = true
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: TRUNC, scope: 'recent' }) })
assert.equal(res.statusCode, 200)
const half = json(res)
assert.equal(half.truncated, true, 'max-tokens 必须标 truncated')
assert.equal(half.markdown, '# 半稿\n\n【前半段】写到单次上限。')
res = await call('/dsh-recap/summary', {
  body: JSON.stringify({ sessionId: TRUNC, continueFrom: '00000000-0000-4000-8000-000000000000' }),
})
assert.equal(res.statusCode, 409)
assert.equal(json(res).code, 'PREVIEW_STALE', '续写旧编号应拒绝')
res = await call('/dsh-recap/summary', {
  body: JSON.stringify({ sessionId: TRUNC, continueFrom: half.previewId }),
})
assert.equal(res.statusCode, 200)
const continued = json(res)
assert.notEqual(continued.previewId, half.previewId, '续写后应换新 previewId')
assert.equal(continued.truncated, false)
assert.ok(continued.markdown.startsWith(half.markdown), '续写后全文应保留前半段')
assert.ok(continued.markdown.includes('【续写】'), '续写后全文应包含新增内容')
assert.ok(calls.at(-1).prompt.includes('【前半段】'), '续写提示应包含已写部分')
assert.ok(calls.at(-1).prompt.includes('只输出新增内容'), '续写提示应要求只输出新增内容')
res = await call('/dsh-recap/save', {
  body: JSON.stringify({ sessionId: TRUNC, previewId: continued.previewId }),
})
assert.equal(res.statusCode, 200)
assert.equal(fs.readFileSync(json(res).file, 'utf8'), continued.markdown, '保存内容应等于追加后的全文')
console.log('· 触顶 truncated=true；续写新 previewId、提示含已写部分；保存为追加后全文')

// —— 4. 包内/源码边界：读全部不得偷偷只读 20 条 ——
assert.ok(all.chunks > 1)
assert.ok(calls.some((c) => c.system.includes('事实提取助手')), '读全部应真实调用分段提取')
console.log('· 读全部确实走分段提取，不是号称读全却仍只读 20 条')

await fsp.rm(home, { recursive: true, force: true })
await fsp.rm(path.dirname(vault), { recursive: true, force: true })
console.log('b25 ok')
