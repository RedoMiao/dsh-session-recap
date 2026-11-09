// 模拟宿主集成测试：真实路由 + 真实 preview/保存链路，不碰真实配置与笔记。
// 用临时 HOME，所以 CONFIG_PATH 落在临时目录；库也是临时目录。
import assert from 'node:assert'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { runSave } from '../lib/flow.js'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'recap-home-'))
const vault = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'recap-vault-')), '库')
await fsp.mkdir(path.join(vault, '.obsidian'), { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home

const { default: plugin } = await import('../lib/index.js')

const routes = []
const commands = new Map()
const events = {}
let tapIndex = null
let prompts = []
let callNo = 0
const sessions = [
  { id: 'session-11111111-1111-1111-1111-111111111111', header: { createdAt: 3 } },
  { id: 'session-22222222-2222-2222-2222-222222222222', header: { createdAt: 2 } },
]

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
    readSession: async (id) => ({
      session: { id, cwd: 'D:/AI工具箱/skill与插件创建区/dsh-session-recap', createdAt: 1 },
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { content: [{ type: 'text', text: '给插件修保存' }], source: { kind: 'user' } } },
        { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '好' }] } } },
        { type: 'turn/end', data: { turn: 1 } },
      ],
    }),
    readTitle: async (id) => ({ title: `对话 ${String(id).slice(8, 12)}` }),
  },
  llm: {
    resolveModelInfo: async () => ({ defaultMaxTokens: 8000 }),
    stream: (opts) => {
      prompts.push(opts.messages?.[0]?.content?.[0]?.text ?? '')
      callNo += 1
      const body = `# 笔记 ${callNo}\n\n正文 ${callNo}`
      return (async function* () {
        yield { type: 'text-delta', text: body }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  },
  inject: (_deps, fn) => fn({ webServer: { register: (r) => (routes.push(r), () => {}), tapIndex: (fn2) => (tapIndex = fn2) } }),
  effect: () => () => {},
}

plugin(ctx, {})

assert.ok(routes.length > 5, '路由没注册')
const html = tapIndex('<!doctype html>')
const token = JSON.parse(html.match(/__dshRecapToken=(("(?:[^"\\]|\\.)*"))/)[1])
assert.ok(token && token.length > 10, '拿不到口令')

function call(routePath, { method = 'POST', headers = {}, body = '', withToken = true } = {}) {
  const route = routes.find((r) => r.path === routePath)
  assert.ok(route, `没有路由 ${routePath}`)
  return new Promise((resolve, reject) => {
    const req = new Readable({ read() {} })
    req.method = method
    req.headers = {
      host: '127.0.0.1:1',
      'content-type': 'application/json',
      ...(withToken ? { 'x-recap-token': token } : {}),
      ...headers,
    }
    const res = {
      headersSent: false,
      statusCode: 0,
      payload: '',
      writeHead(code, h) {
        this.statusCode = code
        this.headersSent = true
        this.headers = h
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

// 预览渲染器必须由插件自己发出去，不能依赖 CDN 或构建步骤
{
  const js = await call('/dsh-recap/markdown.js', { method: 'GET', withToken: false })
  assert.equal(js.statusCode, 200, 'markdown.js 静态路由应可加载')
  assert.ok(String(js.headers?.['content-type'] ?? '').includes('text/javascript'), 'content-type 应为 JS')
  assert.ok(String(js.payload).includes('export function renderMarkdown'), '返回内容应是渲染器模块')
}
console.log('· 预览渲染器静态路由可加载')
// 限流窗口是 5 秒：每轮总结之间要让开，才测得到真实链路
const cooldown = () => sleep(5100)

// —— 访问控制：无口令一律 403 ——
for (const [p, method] of [
  ['/dsh-recap/sessions', 'GET'],
  ['/dsh-recap/config', 'GET'],
  ['/dsh-recap/vaults', 'GET'],
  ['/dsh-recap/summary', 'POST'],
  ['/dsh-recap/save', 'POST'],
]) {
  const res = await call(p, { method, withToken: false, body: '{}' })
  assert.equal(res.statusCode, 403, `${method} ${p} 无口令应 403`)
}
console.log('· 无口令 5 个端点全部 403')

// —— 配置库路径与模型（写在临时 HOME 里）——
let res = await call('/dsh-recap/config', {
  body: JSON.stringify({ config: { vaultPath: vault, provider: 'deepseek', model: 'deepseek-chat', projectRoot: '项目经历' } }),
})
assert.equal(res.statusCode, 200)
assert.equal(json(res).config.vaultPath, vault)
console.log('· 配置写入临时 HOME，库指向临时目录')

res = await call('/dsh-recap/sessions', { method: 'GET' })
assert.equal(res.statusCode, 200)
assert.equal(json(res).items.length, 2)
console.log('· 会话列表 2 条')

// —— 显式空模板：生产路由 / 命令都必须拒绝，模型 0 调用、无 pending、无文件 ——
const summaryCmd = commands.get('summary')
assert.ok(summaryCmd, '没有注册 /summary 命令')
const vaultFiles = () =>
  fs.readdirSync(vault, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
const initialTemplates = json(await call('/dsh-recap/config', { method: 'GET' })).config.templates
assert.ok(initialTemplates[0].body.trim(), '初次默认模板应有正文，不能是空壳')

res = await call('/dsh-recap/config', {
  body: JSON.stringify({ config: { templates: [{ name: '空模板', body: '', color: '#f3dfae' }], activeTemplate: 0 } }),
})
assert.equal(res.statusCode, 200)
const promptsBeforeEmpty = prompts.length
const filesBeforeEmpty = vaultFiles()
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: sessions[0].id }) })
assert.equal(res.statusCode, 409, '空字符串模板不应进入生成')
assert.equal(json(res).code, 'TEMPLATE_EMPTY')
assert.ok(json(res).error.includes('还没有提示词'))
assert.equal(prompts.length, promptsBeforeEmpty, '空字符串模板调用了模型')
assert.deepEqual(vaultFiles(), filesBeforeEmpty, '空字符串模板写入了文件')
res = await call('/dsh-recap/save', { body: JSON.stringify({ sessionId: sessions[0].id, previewId: 'no-such-preview' }) })
assert.equal(json(res).code, 'NO_PREVIEW', '空模板不应产生新 previewId')

const cmdEmpty = await summaryCmd.handler({ agent: { id: sessions[0].id } })
assert.equal(cmdEmpty.kind, 'error', '空模板时 /summary 命令应失败')
assert.ok(cmdEmpty.text.includes('还没有提示词'))
assert.equal(prompts.length, promptsBeforeEmpty, '空模板命令调用了模型')

res = await call('/dsh-recap/config', {
  body: JSON.stringify({ config: { templates: [{ name: '空白模板', body: ' \r\n\t ', color: '#f3dfae' }], activeTemplate: 0 } }),
})
assert.equal(res.statusCode, 200)
const cmdBlank = await summaryCmd.handler({ agent: { id: sessions[0].id } })
assert.equal(cmdBlank.kind, 'error', '纯空白模板时 /summary 命令应失败')
assert.equal(prompts.length, promptsBeforeEmpty, '纯空白模板命令调用了模型')

res = await call('/dsh-recap/config', {
  body: JSON.stringify({ config: { templates: [{ name: '缺正文模板', color: '#f3dfae' }], activeTemplate: 0 } }),
})
assert.equal(res.statusCode, 200)
const cmdMissing = await summaryCmd.handler({ agent: { id: sessions[0].id } })
assert.equal(cmdMissing.kind, 'error', '缺失正文模板时 /summary 命令应失败')
assert.equal(prompts.length, promptsBeforeEmpty, '缺失正文模板命令调用了模型')

await cooldown()
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: sessions[0].id }) })
assert.equal(res.statusCode, 409, '纯空白模板不应进入生成')
assert.equal(json(res).code, 'TEMPLATE_EMPTY')
assert.equal(prompts.length, promptsBeforeEmpty, '纯空白模板调用了模型')
assert.deepEqual(vaultFiles(), filesBeforeEmpty, '空模板系列写入了文件')
console.log('· 显式空模板（空串/空白/缺失）：路由与命令均 TEMPLATE_EMPTY，模型 0 调用，无 pending / 文件')

res = await call('/dsh-recap/config', {
  body: JSON.stringify({ config: { templates: initialTemplates, activeTemplate: 0 } }),
})
assert.equal(res.statusCode, 200)
console.log('· 初次默认模板有正文，恢复后仍可正常总结')

// —— 生成 → 保存 → 不能重复保存 ——
await cooldown()
const A = sessions[0].id
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: A }) })
assert.equal(res.statusCode, 200)
const first = json(res)
assert.ok(first.previewId, '预览没有独立标识')
const savedFile = first.file
res = await call('/dsh-recap/save', { body: JSON.stringify({ sessionId: A, previewId: first.previewId }) })
assert.equal(res.statusCode, 200)
assert.equal(fs.readFileSync(savedFile, 'utf8'), first.markdown, '磁盘正文与预览不一致')
const filesAfterFirst = fs.readdirSync(path.dirname(savedFile))
res = await call('/dsh-recap/save', { body: JSON.stringify({ sessionId: A, previewId: first.previewId }) })
assert.equal(res.statusCode, 409)
assert.equal(json(res).code, 'NO_PREVIEW')
assert.deepEqual(fs.readdirSync(path.dirname(savedFile)), filesAfterFirst, '重复保存写出了第二份')
console.log('· 生成 → 保存正文一致 → 重复保存 409，不写第二份')

// —— 旧页面拿过期预览：明确拒绝，不写错稿 ——
await cooldown()
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: A }) })
const older = json(res)
await cooldown()
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: A }) })
const newer = json(res)
assert.notEqual(older.previewId, newer.previewId)
const filesBeforeStale = fs.readdirSync(path.dirname(older.file))
res = await call('/dsh-recap/save', { body: JSON.stringify({ sessionId: A, previewId: older.previewId }) })
assert.equal(res.statusCode, 409)
assert.equal(json(res).code, 'PREVIEW_STALE')
assert.ok(json(res).error.includes('刷新'), '过期提示要说清刷新')
assert.deepEqual(fs.readdirSync(path.dirname(older.file)), filesBeforeStale, '旧稿保存不该多出文件')
assert.equal(fs.readFileSync(first.file, 'utf8'), first.markdown, '旧稿保存不该改动已有笔记')
console.log('· 同会话两稿：旧稿保存 → PREVIEW_STALE，未写盘')

// —— 写盘失败 → 原预览保留 → 障碍移除后直接重试（不重新调模型）——
await cooldown()
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: A }) })
const retryDraft = json(res)
// 清掉同名的旧测试笔记，再用同名目录占住目标位置，制造一次写盘失败
await fsp.rm(retryDraft.file, { recursive: true, force: true })
await fsp.mkdir(retryDraft.file, { recursive: true })
res = await call('/dsh-recap/save', { body: JSON.stringify({ sessionId: A, previewId: retryDraft.previewId }) })
assert.equal(res.statusCode, 409)
assert.ok(json(res).error.includes('同名文件夹'))
await fsp.rm(retryDraft.file, { recursive: true, force: true })
res = await call('/dsh-recap/save', { body: JSON.stringify({ sessionId: A, previewId: retryDraft.previewId }) })
assert.equal(res.statusCode, 200, '障碍移除后应能直接重试')
assert.equal(fs.readFileSync(retryDraft.file, 'utf8'), retryDraft.markdown)
console.log('· 同名目录制造写失败 → 预览保留 → 移除后重试成功')

// —— 两个会话同名目标：并发保存各自完整、互不覆盖 ——
await cooldown()
const B = sessions[1].id
const one = json(await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: A }) }))
await cooldown()
const two = json(await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: B }) }))
assert.equal(one.file, two.file, '两个会话应落在同一个目标名上（测试前提）')
const [r1, r2] = await Promise.all([
  call('/dsh-recap/save', { body: JSON.stringify({ sessionId: A, previewId: one.previewId }) }),
  call('/dsh-recap/save', { body: JSON.stringify({ sessionId: B, previewId: two.previewId }) }),
])
assert.equal(r1.statusCode, 200)
assert.equal(r2.statusCode, 200)
assert.notEqual(json(r1).file, json(r2).file, '同名并发保存撞了同一个文件名')
const bodies = [fs.readFileSync(json(r1).file, 'utf8'), fs.readFileSync(json(r2).file, 'utf8')]
assert.deepEqual(bodies.sort(), [one.markdown, two.markdown].sort(), '并发保存正文串了')
console.log('· 两会话同名并发保存：两个文件、正文各自正确')

// —— 模板切换真的进了提示词 ——
const config = json(await call('/dsh-recap/config', { method: 'GET' }))
res = await call('/dsh-recap/config', {
  body: JSON.stringify({ config: { templates: config.config.templates, activeTemplate: 1 } }),
})
assert.equal(res.statusCode, 200)
await cooldown()
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: A }) })
assert.equal(res.statusCode, 200)
const todayTemplate = config.config.templates[1]
assert.equal(todayTemplate.name, '今日小结')
assert.ok(prompts.at(-1).includes(todayTemplate.body), '有效模板原文没有原样进入模型输入')
assert.ok(prompts.at(-1).includes('今日小结'), '切换模板后提示词没跟着换')
console.log('· 模板切换 → 模型实际输入包含「今日小结」完整原文')

// —— 旧页面不带编号 / 编号无效：一律拒绝且不写盘；有效编号才保存 ——
const tplPreview = json(res)
const tplDir = path.dirname(tplPreview.file)
const filesBeforeBadSave = fs.readdirSync(tplDir).length
for (const body of [
  { sessionId: A },
  { sessionId: A, previewId: '' },
  { sessionId: A, previewId: '   ' },
  { sessionId: A, previewId: null },
  { sessionId: A, previewId: 123 },
  { sessionId: A, previewId: {} },
  { sessionId: A, previewId: [] },
  { sessionId: A, previewId: true },
  { sessionId: A, previewId: '00000000-0000-4000-8000-000000000000' },
]) {
  res = await call('/dsh-recap/save', { body: JSON.stringify(body) })
  assert.equal(res.statusCode, 409, `保存请求 ${JSON.stringify(body)} 应被拒绝`)
  assert.equal(json(res).code, 'PREVIEW_STALE')
  assert.ok(json(res).error.includes('刷新') || json(res).error.includes('重新生成'), '拒绝时要提示刷新或重新生成')
}
assert.equal(fs.readdirSync(tplDir).length, filesBeforeBadSave, '缺失/无效编号的保存请求写盘了')
console.log('· 旧页面缺编号 / 空值 / 错类型 / 过期编号 → 全部 409，未写盘')

res = await call('/dsh-recap/save', { body: JSON.stringify({ sessionId: A, previewId: tplPreview.previewId }) })
assert.equal(res.statusCode, 200, '有效编号应能保存')
assert.equal(fs.readFileSync(json(res).file, 'utf8'), tplPreview.markdown, '有效编号保存的正文与预览不一致')
const filesAfterValidSave = fs.readdirSync(tplDir).length
assert.equal(filesAfterValidSave, filesBeforeBadSave + 1)
res = await call('/dsh-recap/save', { body: JSON.stringify({ sessionId: A, previewId: tplPreview.previewId }) })
assert.equal(res.statusCode, 409)
assert.equal(json(res).code, 'NO_PREVIEW')
assert.equal(fs.readdirSync(tplDir).length, filesAfterValidSave, '同一编号重复保存写出了第二份')
console.log('· 有效编号保存正确；重复保存 409，不写第二份')

// —— 无活跃会话时不瞎猜：两个会话且都不新鲜 → 409 ——
await cooldown()
res = await call('/dsh-recap/summary', { body: '{}' })
assert.equal(res.statusCode, 409)
console.log('· 无活跃会话且列表多条 → 409，不凭最近活跃乱选')

// —— 命令入口回归：/summary → /save（不带 previewId）仍按原方式保存 ——
const commandSession = 'session-33333333-3333-3333-3333-333333333333'
const saveCmd = commands.get('save')
assert.ok(summaryCmd && saveCmd, '没有注册 /summary /save 命令')
const cmdSummary = await summaryCmd.handler({ agent: { id: commandSession } })
assert.equal(cmdSummary.kind, 'success')
const cmdMarkdown = cmdSummary.text.match(/\*\*预览（还没写入）\*\*\n\n([\s\S]*?)\n\n---\n将写入：/)?.[1]
assert.ok(cmdMarkdown, '命令预览里拿不到正文')
const cmdSaved = await saveCmd.handler({ agent: { id: commandSession } })
assert.equal(cmdSaved.kind, 'success')
const cmdFile = cmdSaved.text.match(/`([^`]+)`/)?.[1]
assert.ok(cmdFile && fs.existsSync(cmdFile), '命令保存后文件不存在')
assert.equal(fs.readFileSync(cmdFile, 'utf8'), cmdMarkdown, '命令保存的正文与预览不一致')
const cmdAgain = await saveCmd.handler({ agent: { id: commandSession } })
assert.equal(cmdAgain.kind, 'error', '命令重复保存应报错')
console.log('· 命令 /summary → /save（无编号）正常保存；重复 /save 报错')

const postRoute = async (p, body) => JSON.parse((await call(p, { body: JSON.stringify(body) })).payload)

// —— 服务端已写成功但回执丢失：重试不能再写一份，也不能谎报成功 ——
await cooldown()
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: A }) })
const lostDraft = json(res)
const lostDir = path.dirname(lostDraft.file)
const filesBeforeLost = fs.readdirSync(lostDir).length
const lostPost = async (p, body) => {
  await call(p, { body: JSON.stringify(body) })
  throw new TypeError('Failed to fetch')
}
const lostTry = await runSave({
  post: lostPost,
  sessionId: A,
  previewId: lostDraft.previewId,
  previewMarkdown: lostDraft.markdown,
  toText: (s) => s,
})
assert.equal(lostTry.action, 'retry')
assert.equal(lostTry.canRetry, true, '回执丢失后应允许再点保存')
assert.equal(lostTry.uncertain, true)
assert.ok(lostTry.message.includes(lostDraft.markdown), '回执丢失后应保留原稿')
assert.equal(fs.readdirSync(lostDir).length, filesBeforeLost + 1, '模拟丢失前服务端应已写入一份')
const lostRetry = await runSave({
  post: postRoute,
  sessionId: A,
  previewId: lostDraft.previewId,
  previewMarkdown: lostDraft.markdown,
  uncertain: lostTry.uncertain,
  toText: (s) => s,
})
assert.equal(lostRetry.action, 'already')
assert.equal(lostRetry.canRetry, false)
assert.ok(!lostRetry.message.includes('已写入'), '结果不明时不能谎报成功')
assert.equal(fs.readdirSync(lostDir).length, filesBeforeLost + 1, '回执丢失后重试多写了一份')
console.log('· 已写成功但回执丢失 → 重试不重复写，不谎报成功')

// —— 请求完全没到服务端：原稿保留、可重试，重试后只写一份 ——
await cooldown()
res = await call('/dsh-recap/summary', { body: JSON.stringify({ sessionId: A }) })
const netDraft = json(res)
const netDir = path.dirname(netDraft.file)
const filesBeforeNet = fs.readdirSync(netDir).length
const down = async () => {
  throw new TypeError('Failed to fetch')
}
const netTry = await runSave({
  post: down,
  sessionId: A,
  previewId: netDraft.previewId,
  previewMarkdown: netDraft.markdown,
  toText: (s) => s,
})
assert.equal(netTry.action, 'retry')
assert.equal(netTry.canRetry, true)
assert.equal(netTry.uncertain, true)
assert.ok(netTry.message.includes(netDraft.markdown), '断网后应保留原稿')
assert.equal(fs.readdirSync(netDir).length, filesBeforeNet, '请求没到服务端却写了盘')
const netRetry = await runSave({
  post: postRoute,
  sessionId: A,
  previewId: netDraft.previewId,
  previewMarkdown: netDraft.markdown,
  uncertain: netTry.uncertain,
  toText: (s) => s,
})
assert.equal(netRetry.action, 'saved')
assert.equal(fs.readdirSync(netDir).length, filesBeforeNet + 1)
assert.equal(fs.readFileSync(netRetry.file, 'utf8'), netDraft.markdown)
console.log('· 请求没到服务端 → 原稿保留可重试 → 重试只写一份')

await fsp.rm(home, { recursive: true, force: true })
await fsp.rm(path.dirname(vault), { recursive: true, force: true })
console.log('routes ok')
