// 0.2.6：模板正文就是这次任务的完整指令。
// 真实插件 + 真实路由 + 假 ctx.llm/sessionQuery；只写临时 HOME 和临时库。
import assert from 'node:assert'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'recap-b26-home-'))
const vault = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'recap-b26-vault-')), '库')
await fsp.mkdir(path.join(vault, '.obsidian'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const { default: plugin, SYSTEM, SYSTEM_TASK } = await import('../lib/index.js')
const { factsFromEvents, buildFactsPrompt, fullTaskMaterial, splitTextForAll } = await import('../lib/facts.js')

const TEMPLATE_A = `## 任务
数一数这次对话里出现了几次 DSH 这个词。只数对话原文里的，不数这段说明。
只回三行：
1. 次数：<数字>
2. 命中摘录：最多 5 条，每条一句原话
3. 读取范围：读全部 / 只读最近 20 条

## 执行说明
不要写成笔记，不要加标题和小结，不要解释方法。
数字必须来自原文；数不清就写「数不清」并说明卡在哪。`

const TEMPLATE_B = `## 任务
从这次对话里只挑出还没做完或待确认的事，其他一律不写。
输出一个表格：事情 | 谁在做 | 现在卡在哪 | 原话依据（一句）
按紧急程度排序，最多 10 行。没有就回一行「没有待办」。

## 执行说明
不要总结全文，不要复述已完成的事。每行都要能在对话原文里找到依据。`

const NOTE_TEMPLATE = '# 【标题】\n\n## 要点\n- 【填写】\n\n## 结论\n- 【填写】'

const COUNT = 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const LONG = 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const TODO = 'session-cccccccc-cccc-cccc-cccc-cccccccccccc'
const TRUNC = 'session-dddddddd-dddd-dddd-dddd-dddddddddddd'
const FALLBACK = 'session-eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

// fixture 里 DSH 精确 17 次：1+1+0+2+0+13 条各 1 次。
const countAsks = [
  '【K1】DSH 第一次出现',
  '【K2】这里只有一个 DSH',
  '【K3】普通消息，没有关键词',
  '【K4】DSH 和 DSH 出现两次',
  '【K5】普通消息，继续',
  ...Array.from({ length: 13 }, (_, i) => `【K${i + 6}】DSH 第 ${i + 6} 条`),
]
const RAW_CMD =
  'node scripts/check.mjs --mode full --target ' + 'x'.repeat(120) + ' RAW_CMD_MARKER_0.2.6'
const todoAsks = [
  '【T1】0.2.6 已经做完的部分：记一笔。',
  '【T2】还没做完：复核 0.2.6 的包。',
  '【T3】待确认：要不要请 Redo 现在安装。',
  '【T4】已完成：报告初稿写好了。',
  '【T5】还没做完：同步未验证清单。',
]
const longAsks = Array.from({ length: 150 }, (_, i) => {
  const n = i + 1
  const mark = [1, 51, 101, 150].includes(n) ? `DSH 命中【L${n}】 ` : `【L${n}】`
  return `${mark}第 ${n} 条：${'这段是长对话里的细节，'.repeat(12)}`
})

function eventsFor(id, asks, extra = {}) {
  const events = []
  if (extra.title) {
    events.push({ type: 'session/title', data: { title: extra.title } })
  }
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
      data: { turn: i + 1, message: { content: [{ type: 'text', text: `第 ${i + 1} 轮回复，继续。` }] } },
    })
    events.push({ type: 'turn/end', data: { turn: i + 1 }, time: i })
  })
  if (extra.command) {
    events.push({ type: 'step/start', data: {} })
    events.push({
      type: 'tool/call',
      data: {
        name: 'pwsh',
        arguments: JSON.stringify({ command: extra.command }),
        callId: 'call-raw-1',
      },
    })
  }
  return { session: { id, cwd: `D:/work/${id}`, createdAt: 1 }, events }
}

// fixture 计数自检：17 次 DSH，且助手回复里没有 DSH。
const fixtureCount = countAsks.reduce((n, text) => n + (text.match(/DSH/g)?.length ?? 0), 0)
assert.equal(fixtureCount, 17, `fixture 的 DSH 次数应为 17，实际 ${fixtureCount}`)

const sessions = [
  { id: COUNT, header: { createdAt: 5 } },
  { id: LONG, header: { createdAt: 4 } },
  { id: TODO, header: { createdAt: 3 } },
  { id: TRUNC, header: { createdAt: 2 } },
  { id: FALLBACK, header: { createdAt: 1 } },
]

const routes = []
const commands = new Map()
const calls = []
let tapIndex = null
let truncateNext = false

const countDsh = (text) => (String(text ?? '').match(/DSH/g) || []).length

function taskMaterial(prompt) {
  const heads = ['## 分段执行结果', '## 对话材料']
  for (const head of heads) {
    const start = prompt.indexOf(head)
    if (start < 0) continue
    const end = prompt.indexOf('## 用户指令', start + head.length)
    return prompt.slice(start + head.length, end < 0 ? undefined : end).trim()
  }
  return ''
}

const ctx = {
  on: (name, fn) => {
    void fn
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
      if (id === COUNT) return eventsFor(id, countAsks, { command: RAW_CMD })
      if (id === LONG) return eventsFor(id, longAsks)
      if (id === TODO) return eventsFor(id, todoAsks)
      if (id === FALLBACK) return eventsFor(id, ['【F1】回退命名的会话'], { title: '回退标题' })
      return eventsFor(id, ['【R1】写一篇长文', '【R2】不要遗漏结论'])
    },
    readTitle: async (id) => ({ title: `合成会话 ${id.slice(8, 12)}` }),
  },
  llm: {
    resolveModelInfo: async () => ({ defaultMaxTokens: 8000 }),
    stream: (opts) => {
      const system = opts.system ?? ''
      const prompt = opts.messages?.[0]?.content?.[0]?.text ?? ''
      calls.push({ system, prompt })

      if (truncateNext) {
        truncateNext = false
        return (async function* () {
          yield { type: 'text-delta', text: '# 半稿\n\n【前半段】写到单次上限。' }
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        })()
      }

      if (prompt.includes('## 已写好的部分')) {
        return (async function* () {
          yield { type: 'text-delta', text: '【续写】后半段仍按原指令：次数不变。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      }

      if (system === SYSTEM) {
        return (async function* () {
          yield { type: 'text-delta', text: '# 项目笔记\n\n## 要点\n- 按骨架填好的笔记\n\n## 结论\n- 保持笔记模式' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      }

      assert.equal(system, SYSTEM_TASK, '指令模式必须使用 SYSTEM_TASK')

      if (prompt.includes('只挑出还没做完')) {
        return (async function* () {
          yield {
            type: 'text-delta',
            text:
              '| 事情 | 谁在做 | 现在卡在哪 | 原话依据（一句） |\n' +
              '| --- | --- | --- | --- |\n' +
              '| 复核 0.2.6 的包 | 小指挥 | 等打包 | 「还没做完：复核 0.2.6 的包。」 |\n' +
              '| 同步未验证清单 | 打工D | 待补 | 「还没做完：同步未验证清单。」 |',
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      }

      const material = taskMaterial(prompt)
      const isChunk = /^下面是全部对话按顺序切出的第 \d+\/\d+ 段。/m.test(prompt)
      const isMerge = prompt.includes('## 分段执行结果')

      if (isMerge) {
        const nums = [...material.matchAll(/本段命中：(\d+)/g)].map((m) => Number(m[1]))
        const total = nums.length ? nums.reduce((a, b) => a + b, 0) : countDsh(material)
        const quotes = material
          .split('\n')
          .filter((l) => /^- /.test(l) && (l.includes('DSH') || /【L\d+】/.test(l)))
          .slice(0, 5)
        return (async function* () {
          yield { type: 'text-delta', text: `次数：${total}\n命中摘录：\n${quotes.join('\n')}\n读取范围：读全部` }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      }

      if (isChunk) {
        const n = countDsh(material)
        const lines = material.split('\n').filter((l) => l.trim())
        const hits = lines.filter((l) => l.includes('DSH'))
        const quotes = (hits.length ? hits : lines.slice(0, 1)).slice(0, 5)
        return (async function* () {
          yield {
            type: 'text-delta',
            text: `本段命中：${n}\n命中摘录：\n${quotes.map((l) => `- ${l}`).join('\n')}\n读取范围：读全部`,
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      }

      const n = countDsh(material)
      const lines = material.split('\n').filter((l) => l.includes('DSH')).slice(0, 5)
      return (async function* () {
        yield {
          type: 'text-delta',
          text: `次数：${n}\n命中摘录：\n${lines.map((l) => `- ${l}`).join('\n')}\n读取范围：只读最近 20 条`,
        }
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
        { name: '数DSH次数', body: TEMPLATE_A, color: '#f3dfae' },
        { name: '只挑待办', body: TEMPLATE_B, color: '#c9e4d2' },
        { name: '项目总结', body: NOTE_TEMPLATE, color: '#c9dcf2' },
        { name: '', body: '只回一行结论。', color: '#f2d0da' },
      ],
      activeTemplate: 0,
    },
  }),
})
assert.equal(res.statusCode, 200)

// —— 1. 长对话：先 NEED_SCOPE，不调模型；只读重点 1 次；读全部按指令分段 ——
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: LONG }) })
assert.equal(res.statusCode, 409)
const need = json(res)
assert.equal(need.code, 'NEED_SCOPE')
assert.equal(calls.length, 0, 'NEED_SCOPE 不能调用模型')
assert.equal(need.stats.asks, 150)
assert.ok(need.stats.estChunks > 1, '150 条长材料应估算出多段')
console.log(`· 长对话 NEED_SCOPE：模型 0 调用，stats=${JSON.stringify(need.stats)}`)

res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: LONG, scope: 'recent' }) })
assert.equal(res.statusCode, 200)
const recent = json(res)
assert.equal(calls.length, 1, '只读重点应只调用 1 次模型')
assert.equal(recent.scope, 'recent')
assert.ok(recent.trimNotice.includes('只读了重点'))
assert.ok(!/材料经过裁剪|未发送/.test(recent.trimNotice), '说明不能出现旧话术')
assert.equal(calls[0].system, SYSTEM_TASK)
console.log('· 只读重点：1 次模型调用，SYSTEM_TASK，说明无旧话术')

const beforeAll = calls.length
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: LONG, scope: 'all' }) })
assert.equal(res.statusCode, 200)
const all = json(res)
assert.equal(all.scope, 'all')
assert.ok(all.chunks > 1, '读全部应分段')
assert.equal(calls.length - beforeAll, all.chunks + 1, '读全部调用次数应为分段数 + 1')
const chunkCalls = calls.slice(beforeAll, calls.length - 1)
for (const c of chunkCalls) {
  assert.equal(c.system, SYSTEM_TASK, '分段执行也要用指令模式')
  assert.ok(c.prompt.includes('数一数这次对话里出现了几次 DSH'), '每段都要带同一条用户指令')
  assert.ok(c.prompt.includes('## 用户指令'), '每段都要有用户指令段')
}
const mergePrompt = calls.at(-1).prompt
assert.ok(mergePrompt.includes('数一数这次对话里出现了几次 DSH'), '合并提示必须带用户指令原文')
assert.ok(mergePrompt.includes('## 分段执行结果'), '合并提示缺少分段结果')
assert.ok(mergePrompt.includes('【L1】'), '最终合并漏了首段命中项')
assert.ok(mergePrompt.includes('【L150】'), '最终合并漏了末段命中项')
assert.ok(all.trimNotice.includes('段执行你的指令'), '读全部要如实说明是分段执行指令')
assert.ok(!/裁剪|未发送/.test(all.trimNotice), '读全部说明不能出现旧话术')
assert.ok(all.markdown.includes('次数：4'), `合并后的计数应为 4，实际：${all.markdown}`)
console.log(
  `· 读全部：${all.chunks} 段 + 1 次合并 = ${calls.length - beforeAll} 次；每段含同一指令；首尾命中都进合并；计数 4`,
)

// 纯函数：完整原文覆盖首尾，分段不丢内容
const longFacts = factsFromEvents(eventsFor(LONG, longAsks).events)
const fullText = fullTaskMaterial(longFacts)
assert.ok(fullText.includes('【L1】') && fullText.includes('【L150】'))
const plan = splitTextForAll(fullText, 4000)
assert.ok(plan.count > 1)
assert.ok(plan.chunks[0].includes('【L1】'), '首段漏了第一条')
assert.ok(plan.chunks.at(-1).includes('【L150】'), '末段漏了最后一条')
console.log('· 原文分段：首尾覆盖，不整段丢弃')

// 等过限流，测短会话的直接生成（不经过 scope 分支）
await sleep(5100)
const countEvents = eventsFor(COUNT, countAsks, { command: RAW_CMD })
const beforeCount = calls.length
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: COUNT }) })
assert.equal(res.statusCode, 200)
const counted = json(res)
assert.equal(counted.scope, 'direct')
assert.equal(calls.length - beforeCount, 1, '短对话直接生成只调 1 次')
assert.ok(counted.markdown.includes('17'), `计数模板必须答 17，实际：${counted.markdown}`)
assert.ok(!counted.markdown.includes('## 项目总结'), '计数结果不能变成会话总结')
assert.ok(!counted.markdown.includes('【填写】'), '不能输出模板的【】填充结构')
assert.ok(!counted.markdown.includes('## 要点'), '不能套用笔记模板的小节')
assert.equal(calls.at(-1).system, SYSTEM_TASK)
assert.ok(calls.at(-1).prompt.includes('## 对话材料'))
assert.ok(calls.at(-1).prompt.includes('## 用户指令'))
assert.ok(calls.at(-1).prompt.includes('数一数这次对话里出现了几次 DSH'))
assert.ok(calls.at(-1).prompt.includes('RAW_CMD_MARKER_0.2.6'), '指令模式材料要含完整命令原文')
assert.equal(counted.file, '', '无库预览不应提前给绝对路径')
console.log(`· 计数模板：1 次调用，精确答 17，无笔记结构；无库预览路径为空`)

// 同一 fixture 的 0.2.5 事实要点渲染确实看不到长命令尾部的标记
const compact = buildFactsPrompt(factsFromEvents(countEvents.events)).text
assert.ok(!compact.includes('RAW_CMD_MARKER_0.2.6'), '对照失败：事实要点渲染不应含命令尾部标记')
console.log('· 原文材料对照：指令模式有完整命令，0.2.5 事实要点看不到尾部标记')

// —— 2. 只挑待办：只有表格，没有「已完成」段落 ——
res = await call('/dsh-recap/config', {
  body: JSON.stringify({ config: { activeTemplate: 1 } }),
})
assert.equal(res.statusCode, 200)
const beforeTodo = calls.length
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: TODO, scope: 'recent' }) })
assert.equal(res.statusCode, 200)
const todo = json(res)
assert.equal(calls.length - beforeTodo, 1)
assert.ok(todo.markdown.includes('| 事情 | 谁在做 |'), '待办模板应只输出表格')
assert.ok(!todo.markdown.includes('已完成'), '不得复述已完成的事')
assert.ok(!todo.markdown.includes('## 项目总结'), '不得改写成总结')
assert.equal(calls.at(-1).system, SYSTEM_TASK)
console.log('· 待办模板：只出表格，不含「已完成」段落')

// —— 3. 笔记模式回归：带【】的模板仍走旧 SYSTEM / 旧包装 ——
res = await call('/dsh-recap/config', { body: JSON.stringify({ config: { activeTemplate: 2 } }) })
assert.equal(res.statusCode, 200)
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: TODO, scope: 'recent' }) })
assert.equal(res.statusCode, 200)
const note = json(res)
assert.equal(calls.at(-1).system, SYSTEM, '带【】的模板必须仍用旧 SYSTEM')
assert.ok(calls.at(-1).prompt.includes('## 模板正文（照它填）'), '笔记模式旧包装丢了')
assert.ok(calls.at(-1).prompt.includes('现在输出填好的整篇笔记。'), '笔记模式结尾包装丢了')
assert.ok(note.markdown.includes('## 要点'), '笔记模式输出被改了')
console.log('· 笔记模式：SYSTEM / 「照它填」/「整篇笔记」全部保持不变')

// —— 4. 触顶 + 继续写：续写仍是指令模式，带原指令 ——
res = await call('/dsh-recap/config', { body: JSON.stringify({ config: { activeTemplate: 0 } }) })
assert.equal(res.statusCode, 200)
truncateNext = true
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: TRUNC, scope: 'recent' }) })
assert.equal(res.statusCode, 200)
const half = json(res)
assert.equal(half.truncated, true, 'max-tokens 必须标 truncated')
res = await call('/dsh-recap/summary', {
  body: JSON.stringify({ sessionId: TRUNC, continueFrom: '00000000-0000-4000-8000-000000000000' }),
})
assert.equal(res.statusCode, 409)
assert.equal(json(res).code, 'PREVIEW_STALE')
res = await call('/dsh-recap/summary', {
  body: JSON.stringify({ sessionId: TRUNC, continueFrom: half.previewId }),
})
assert.equal(res.statusCode, 200)
const continued = json(res)
assert.notEqual(continued.previewId, half.previewId)
assert.ok(continued.markdown.startsWith(half.markdown), '续写应保留前半段')
assert.equal(calls.at(-1).system, SYSTEM_TASK, '续写仍须使用指令模式')
assert.ok(calls.at(-1).prompt.includes('## 原指令'), '续写提示要带原指令')
assert.ok(calls.at(-1).prompt.includes('数一数这次对话里出现了几次 DSH'), '续写提示丢了原指令正文')
assert.ok(calls.at(-1).prompt.includes('不要改成会话总结'), '续写时要明确别滑回总结')
console.log('· 触顶续写：新 previewId，SYSTEM_TASK + 原指令，未滑回笔记模式')

// —— 5. 无库生成 / 无库保存 409 / 选库同稿保存 ——
assert.equal(counted.file.startsWith('D:') || counted.file.startsWith('/'), false, '无库预览不应给绝对路径')
res = await call('/dsh-recap/save', {
  body: JSON.stringify({ sessionId: COUNT, previewId: counted.previewId }),
})
assert.equal(res.statusCode, 409)
assert.equal(json(res).code, 'NO_VAULT')
res = await call('/dsh-recap/config', { body: JSON.stringify({ config: { vaultPath: vault } }) })
assert.equal(res.statusCode, 200)
res = await call('/dsh-recap/save', {
  body: JSON.stringify({ sessionId: COUNT, previewId: counted.previewId }),
})
assert.equal(res.statusCode, 200, '选库后同一 previewId 应能保存')
const savedFile = json(res).file
assert.ok(savedFile.includes('数DSH次数'), `保存路径应含模板名，实际：${savedFile}`)
assert.equal(fs.readFileSync(savedFile, 'utf8'), counted.markdown, '磁盘正文与预览不一致')
console.log('· 无库生成 → 409 NO_VAULT → 选库同一稿保存；文件名用模板名')

// —— 6. 模板名为空时回退旧命名 ——
res = await call('/dsh-recap/config', { body: JSON.stringify({ config: { activeTemplate: 3 } }) })
assert.equal(res.statusCode, 200)
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: FALLBACK, scope: 'recent' }) })
assert.equal(res.statusCode, 200)
const fallback = json(res)
assert.ok(fallback.file.includes('回退标题'), `模板名为空时应回退会话标题，实际：${fallback.file}`)
console.log('· 模板名为空：文件名回退会话标题')

// 命令入口也走同一套：/summary 无库仍能生成
const summaryCmd = commands.get('summary')
assert.ok(summaryCmd, '没有注册 /summary')
res = await call('/dsh-recap/config', { body: JSON.stringify({ config: { activeTemplate: 0, vaultPath: '' } }) })
assert.equal(res.statusCode, 200)
await sleep(5100)
const cmdPreview = await summaryCmd.handler({ agent: { id: COUNT } })
assert.equal(cmdPreview.kind, 'success')
assert.ok(cmdPreview.text.includes('17'), '命令入口也必须按指令答 17')
assert.ok(cmdPreview.text.includes('还没选库'), '无库命令预览应提示选库')
console.log('· 命令入口：同一模板精确答 17，无库仍出预览')

await fsp.rm(home, { recursive: true, force: true })
await fsp.rm(path.dirname(vault), { recursive: true, force: true })
console.log('b26 ok')
