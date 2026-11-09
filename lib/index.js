/**
 * dsh-session-recap — 把一次 DSH 会话总结成 Obsidian 笔记。
 * 命令：/summary 预览、/save 落盘；界面：右下角猫按钮。
 *
 * 阶段 1 约束：
 *  - 不写死任何人的库路径；未配置时拒绝保存并给引导
 *  - 所有写盘走 safe.js（安全文件名 / 唯一名 / 原子写 / 库内断言）
 *  - 配置带 schemaVersion、白名单校验、原子写、旧文件留 .bak
 *  - HTTP 端点做同源 + 口令 + 体积上限 + 限流
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import {
  factsFromEvents,
  buildFactsPrompt,
  buildTaskMaterial,
  fullFactsText,
  fullTaskMaterial,
  splitFactsForAll,
  splitTextForAll,
  ALL_CHUNK_CHARS,
  PROMPT_LIMITS,
} from './facts.js'
import { safeName, writeNote, checkDir } from './safe.js'
import { candidateVaults, lastOpenedVault } from './vault.js'
import { HOST_TEXT as T } from './strings.js'
import { makeRateLimiter, makePending, previewError } from './limit.js'
import { decideSave, humanError } from './save-route.js'
import { makePersist } from './persist.js'
import { SESSION_FRESH_MS, pickFreshSession } from './sessions.js'

export const name = 'session-recap'
export const inject = ['commands', 'sessionQuery', 'llm', 'sessions']

const here = path.dirname(fileURLToPath(import.meta.url))
const builtinTemplate = path.join(here, '..', 'templates', 'project-note.md')
const uiFile = path.join(here, 'ui.js')
const catFile = path.join(here, '..', 'assets', 'cat-idle.png')
const catSound = path.join(here, '..', 'assets', 'cat.mp3')
const catStates = ['cat-idle', 'cat-click', 'cat-drag', 'cat-sleep']

const CONFIG_PATH = path.join(os.homedir(), '.dsh', 'session-recap.json')
const CONFIG_VERSION = 2
const MAX_BODY = 64 * 1024
const MAX_TEMPLATE = 20 * 1024
const RATE_MS = 5000

const TOKEN = crypto.randomBytes(16).toString('hex')

/** 构建标识：页面拿它和宿主比对，不一致就提示刷新（防止用到旧的 ui.js） */
const BUILD = (() => {
  let version = '0.1.0'
  let commit = 'nogit'
  try {
    version = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version ?? version
  } catch {
    /* 用默认 */
  }
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: path.join(here, '..') }).toString().trim()
  } catch {
    /* 打包环境可能没有 git */
  }
  return `${version}-${commit}`
})()

function log(msg) {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'dsh-recap.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    /* 日志失败不影响主流程 */
  }
}

// ——— 配置 ———
const KEYS = new Set(['schemaVersion', 'vaultPath', 'projectRoot', 'templates', 'activeTemplate', 'provider', 'model'])

const DEFAULT_TEMPLATES = [
  { name: '项目总结', body: '', color: '#f3dfae' },
  {
    name: '今日小结',
    body: '---\n日期: 【YYYY-MM-DD】\n---\n\n# 【日期】今日小结\n\n**今天做成了什么**：【一句话】\n\n## 做了什么\n- 【2-4 条】\n\n## 卡住的地方\n- 【现象 → 原因 → 怎么绕过去】\n\n## 明天接着做什么\n- 【1-2 条】',
    color: '#c9e4d2',
  },
]

function sanitizeTemplates(input) {
  if (!Array.isArray(input)) return null
  const out = []
  for (const t of input.slice(0, 6)) {
    if (!t || typeof t !== 'object') continue
    out.push({
      name: String(t.name ?? '').slice(0, 24),
      body: String(t.body ?? '').slice(0, MAX_TEMPLATE),
      color: /^#[0-9a-f]{6}$/i.test(String(t.color ?? '')) ? t.color : '',
    })
  }
  return out.length ? out : null
}

function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return { schemaVersion: CONFIG_VERSION }
  const out = { schemaVersion: CONFIG_VERSION }
  for (const key of KEYS) {
    if (!(key in raw)) continue
    const value = raw[key]
    if (key === 'templates') {
      const tpl = sanitizeTemplates(value)
      if (tpl) out.templates = tpl
      continue
    }
    if (key === 'activeTemplate') {
      const n = Number(value)
      if (Number.isFinite(n) && n >= 0) out.activeTemplate = Math.floor(n)
      continue
    }
    if (typeof value === 'string') out[key] = value.slice(0, key === 'vaultPath' ? 400 : 64)
  }
  return out
}

function readConfig() {
  try {
    return sanitizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')))
  } catch (error) {
    if (error?.code !== 'ENOENT') log(`config read failed: ${error?.message ?? error}`)
    return { schemaVersion: CONFIG_VERSION }
  }
}

let saved = readConfig()

function cfg() {
  return {
    vaultPath: saved.vaultPath ?? '',
    projectRoot: saved.projectRoot || '项目经历',
    provider: saved.provider ?? '',
    model: saved.model ?? '',
    templates: saved.templates ?? INITIAL_TEMPLATES,
    activeTemplate: Math.max(0, Number(saved.activeTemplate) || 0),
  }
}

async function saveConfig(patch) {
  const clean = { ...(patch || {}) }
  // 空数组不覆盖已有模板：前端尚未加载完时的空保存不能清空用户模板
  if (Array.isArray(clean.templates) && clean.templates.length === 0) delete clean.templates
  const next = sanitizeConfig({ ...saved, ...clean, schemaVersion: CONFIG_VERSION })
  await fsp.mkdir(path.dirname(CONFIG_PATH), { recursive: true })
  try {
    await fsp.copyFile(CONFIG_PATH, `${CONFIG_PATH}.bak`)
  } catch {
    /* 首次没有旧文件 */
  }
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await fsp.rename(tmp, CONFIG_PATH)
  saved = next
  return next
}

// ——— 模板与提示词 ———
function loadTemplateFile(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const fence = raw.match(/```markdown\r?\n([\s\S]*?)```/)
  return { body: (fence ? fence[1] : raw).trim(), rules: raw.split(/^##\s*执行说明.*$/m)[1]?.trim() ?? '', freeform: false }
}

// 初次没有保存过模板时，仍用内置项目模板作为「项目总结」的正文：
// 这样首次安装的默认模板从第一天起就是有内容的，不再靠生成时偷偷回退。
const INITIAL_TEMPLATES = [
  { ...DEFAULT_TEMPLATES[0], body: loadTemplateFile(builtinTemplate).body },
  { ...DEFAULT_TEMPLATES[1] },
]

// 每次模型请求的硬上限：system 指令 + 用户提示词合计不超过这个数。
// 模板归用户，不裁剪模板，只把事实材料压到剩余预算里。
export const PROMPT_TOTAL_MAX = 24000

export const SYSTEM = [
  '你是项目笔记整理助手。只依据给定的事实写笔记，不编造任何数字、链接或产物。',
  '有模板骨架时严格沿用它的字段名、标题层级和顺序，把【】占位符替换成真实内容。',
  '如果用户给的是「总结要求」而不是骨架，就按那些要求自行组织一篇结构清晰的笔记。',
  '信息不足时：数字写"待补"，链接写"未导出"，不要保留【】也不要留空。',
  '模板里的每一节都必须写；篇幅以模板或用户要求为准；模板没规定时，按内容需要写完整，不为了简短删掉用户要的条目、数字和结论。',
  '不要照抄对话里的代码、日志片段、报错原文或命令细节，只写结论和取舍。',
  '只输出最终笔记的 markdown 全文，不要任何解释、不要代码块包裹。',
].join('\n')

/**
 * 指令模式的系统提示词：模板正文就是这次任务的完整指令。
 * 与笔记模式的 SYSTEM 完全分开，避免把「数 DSH」又拉回「写总结」。
 */
export const SYSTEM_TASK = [
  '你是对话分析助手，严格按用户指令执行。用户的指令优先于任何默认格式和默认任务。',
  '用户要计数就给数字，要清单就给清单，要表格就给表格；不要改写成会话总结，不要加指令以外的章节。',
  '只依据给定的对话材料；数字和原话必须能在材料里找到。材料不够就明说缺什么，不要猜。',
  '输出用 markdown，便于保存；除指令要求的格式外不加解释。',
].join('\n')

/** 自由指令模板走 SYSTEM_TASK；带【】骨架的模板保持 0.2.5 笔记模式。 */
export function systemFor(template) {
  return template?.freeform ? SYSTEM_TASK : SYSTEM
}

// 重试时加在用户提示词前后的固定文字；预算必须提前扣掉，不能再让重试变长。
const RETRY_PREFIX = '直接输出结果 markdown，不要任何推理过程。\n\n'
const LEAN_SUFFIX = '\n\n（篇幅尽量短，优先保留已经给出的关键要求。）'

function assemblePrompt(template, materialText, factHeading = '本次会话的事实') {
  return [
    template.freeform ? '## 总结要求（按这些要求写笔记，不必套固定字段）' : '## 模板正文（照它填）',
    template.body,
    '',
    '## 模板的执行规则（写的时候遵守，不要写进笔记）',
    template.rules || '（无）',
    '',
    `## ${factHeading}`,
    materialText,
    '',
    '现在输出填好的整篇笔记。',
  ].join('\n')
}

/** 指令模式：只给「对话材料」+「用户指令」，不再加「照它填」「输出整篇笔记」。 */
function assembleTaskPrompt(template, materialText) {
  return [
    '## 对话材料',
    materialText,
    '',
    '## 用户指令',
    template.body,
    '',
    '按上面的用户指令处理这段对话材料，只输出指令要求的内容。',
  ].join('\n')
}

/** 单次请求里用户提示词可用的字符数：总数先扣掉 system 和额外包装。 */
function userBudget(extraChars = 0, system = SYSTEM) {
  return Math.max(0, PROMPT_TOTAL_MAX - system.length - extraChars)
}

function promptBudget(template, extraChars = 0) {
  return userBudget(extraChars, systemFor(template))
}

function buildPrompt(template, facts, limits, budget = promptBudget(template)) {
  const maxUser = Math.max(0, budget)
  const taskMode = Boolean(template?.freeform)
  const fixedLength = (taskMode ? assembleTaskPrompt(template, '') : assemblePrompt(template, '')).length
  const wanted = Number.isFinite(limits?.totalChars) ? limits.totalChars : PROMPT_LIMITS.totalChars
  // 模板再长也不给它保底材料预算：剩余多少就发多少，避免整体溢出。
  const factsLimit = Math.min(wanted, Math.max(0, maxUser - fixedLength))
  const material = taskMode
    ? buildTaskMaterial(facts, { ...(limits || {}), totalChars: factsLimit })
    : buildFactsPrompt(facts, { ...(limits || {}), totalChars: factsLimit })
  const prompt = taskMode ? assembleTaskPrompt(template, material.text) : assemblePrompt(template, material.text)
  return { notice: material.notice, prompt, material, template }
}

async function budgetFor(ctx, provider, model) {
  try {
    const info = await ctx.llm.resolveModelInfo?.(provider, model)
    const cap = info?.defaultMaxTokens ?? 0
    if (cap > 2000) return Math.min(cap, 32000)
  } catch {
    /* 读不到就用保守值 */
  }
  return 12000
}

async function once(ctx, provider, model, system, prompt, maxTokens, effort, signal) {
  let text = ''
  let finish = ''
  const stream = ctx.llm.stream({
    provider,
    model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens,
    temperature: 0.3,
    ...(effort ? { reasoningEffort: effort } : {}),
    signal,
  })
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type === 'block-end' && chunk.block?.type === 'text' && !text) text += chunk.block.text
    if (chunk.type === 'finish') {
      finish = chunk.reason?.kind ?? ''
      if (finish === 'error') throw new Error(chunk.reason.failure?.message ?? T.modelEmpty)
      if (finish === 'aborted') throw new Error('模型调用被中断')
    }
  }
  return { text: text.trim(), finish }
}

/** 宿主真实枚举是 max-tokens；兼容旧值 length，避免换宿主时静默漏报。 */
function isLengthFinish(finish) {
  return finish === 'max-tokens' || finish === 'length'
}

async function callModel(ctx, conf, facts, built, signal) {
  const fromFacts = facts.model?.match(/^(.+?)\s*\/\s*(.+)$/)
  const provider = conf.provider || fromFacts?.[1] || ''
  const model = conf.model || fromFacts?.[2] || ''
  if (!provider || !model) throw new Error(T.modelMissing)

  const budget = await budgetFor(ctx, provider, model)
  const system = systemFor(built.template)

  // 第一次：正常写
  let out = await once(ctx, provider, model, system, built.prompt, budget, 'low', signal)
  if (out.text) return { ...out, truncated: isLengthFinish(out.finish) }

  // 没写出来（预算被推理吃掉）→ 关掉推理、要求直接写；前缀预算已在首轮预留
  const urgent = RETRY_PREFIX + built.prompt
  out = await once(ctx, provider, model, system, urgent, budget, undefined, signal)
  if (out.text) return { ...out, truncated: isLengthFinish(out.finish) }

  // 再不行：重新按更小的材料预算组装，不再把整份提示词重复拼一遍
  const lean = buildPrompt(
    built.template,
    facts,
    {},
    promptBudget(built.template, RETRY_PREFIX.length + LEAN_SUFFIX.length),
  )
  out = await once(ctx, provider, model, system, RETRY_PREFIX + lean.prompt + LEAN_SUFFIX, budget, undefined, signal)
  if (out.text) return { ...out, truncated: isLengthFinish(out.finish) }

  throw new Error(`${T.modelEmpty}（finish=${out.finish || 'none'}）`)
}

/** 读全部 / 续写用：严格按给定提示词调用，不在失败时偷偷压缩材料。 */
async function callExact(ctx, conf, facts, system, prompt, signal) {
  const fromFacts = facts?.model?.match(/^(.+?)\s*\/\s*(.+)$/)
  const provider = conf.provider || fromFacts?.[1] || ''
  const model = conf.model || fromFacts?.[2] || ''
  if (!provider || !model) throw new Error(T.modelMissing)
  const budget = await budgetFor(ctx, provider, model)
  let out = await once(ctx, provider, model, system, prompt, budget, 'low', signal)
  if (out.text) return { ...out, truncated: isLengthFinish(out.finish) }
  out = await once(ctx, provider, model, system, RETRY_PREFIX + prompt, budget, undefined, signal)
  if (out.text) return { ...out, truncated: isLengthFinish(out.finish) }
  throw new Error(`${T.modelEmpty}（finish=${out.finish || 'none'}）`)
}

const EXTRACT_SYSTEM = [
  '你是事实提取助手。只从给定的对话记录里提取事实要点：诉求、决定、更正、文件、命令、报错、交付物和结论。',
  '按原对话顺序列点；保留数字、名称和关键原话；不要写成文章，不要套用任何笔记模板，不要自行总结成一篇笔记。',
  '只输出提取到的事实要点，不要解释。',
].join('\n')

function extractPrompt(chunk, index, total) {
  return [
    `下面是全部对话按顺序切出的第 ${index}/${total} 段。`,
    '',
    chunk,
    '',
    '请提取这一段的事实要点（诉求、决定、更正、文件、命令、报错、交付物、结论），按顺序列点。',
  ].join('\n')
}

function mergeExtractions(parts) {
  const lines = ['以下是从全部对话按时间顺序分段提取的事实要点：', '']
  parts.forEach((text, i) => {
    lines.push(`### 第 ${i + 1} 段`)
    lines.push(String(text ?? '').trim())
    lines.push('')
  })
  return lines.join('\n')
}

/** 指令模式读全部：每一段执行同一条用户指令，而不是固定的「提取事实要点」。 */
function taskChunkPrompt(chunk, index, total, instruction) {
  return [
    `下面是全部对话按顺序切出的第 ${index}/${total} 段。`,
    '',
    '## 对话材料',
    chunk,
    '',
    '## 用户指令',
    instruction,
    '',
    '请只针对这一段执行上面的用户指令，给出这一段的中间结果。',
    '不要编造，不要改成会话总结，不要输出指令以外的东西。',
  ].join('\n')
}

function mergeTaskParts(parts, count) {
  const lines = [`以下是把全部对话按时间顺序分成 ${count} 段、分别执行同一条用户指令得到的中间结果：`, '']
  parts.forEach((text, i) => {
    lines.push(`### 第 ${i + 1} 段`)
    lines.push(String(text ?? '').trim())
    lines.push('')
  })
  return lines.join('\n')
}

/** 指令模式的分段合并：最终答案仍以用户指令为准，不套笔记结构。 */
function assembleTaskMergePrompt(template, mergedText, count) {
  return [
    '## 分段执行结果',
    mergedText,
    '',
    '## 用户指令',
    template.body,
    '',
    `请按上面的用户指令合并这 ${count} 段的中间结果，给出最终答案。`,
    '全部对话已按顺序覆盖；不要遗漏各段里的命中项和数字，不要改成会话总结。',
  ].join('\n')
}

/** 合并后的要点仍超预算时，只压措辞、逐行缩短，不整条删掉。 */
function fitMerged(text, max) {
  const source = String(text ?? '')
  if (source.length <= max) return { text: source, condensed: false }
  const lines = source.split('\n')
  let cap = Math.max(80, Math.floor(max / Math.max(1, lines.length)) - 1)
  let out = lines.map((line) => (line.length > cap ? line.slice(0, cap) + '…' : line)).join('\n')
  while (out.length > max && cap > 24) {
    cap = Math.max(24, Math.floor(cap * 0.8))
    out = lines.map((line) => (line.length > cap ? line.slice(0, cap) + '…' : line)).join('\n')
  }
  const hardClipped = out.length > max
  if (hardClipped) out = out.slice(0, Math.max(0, max - 12)) + '\n…（后段略）'
  return { text: out, condensed: true, hardClipped }
}

/**
 * 续写提示：带上已经写好的部分，要求只输出新增内容。
 * 指令模式额外带上原指令，避免续写时又滑回「写笔记」。
 */
function continuationPrompt(markdown, template = { freeform: false }, system = SYSTEM) {
  const taskMode = Boolean(template?.freeform)
  const intro = '下面这篇稿子写到了单次输出上限，还没写完。'
  const task = [
    '',
    '## 任务',
    '从中断处接着写，只输出新增内容，不要重复已写部分，不要重新开头。',
    taskMode
      ? '继续按原用户指令输出，不要改成会话总结或笔记；不要解释你在续写。'
      : '保持模板要求的格式、标题层级和语气；不要解释你在续写。',
    ...(taskMode ? ['', '## 原指令', String(template.body ?? '')] : []),
  ].join('\n')
  const room = Math.max(1200, userBudget(0, system) - intro.length - task.length - 40)
  let written = String(markdown ?? '')
  if (written.length > room) {
    const head = Math.floor(room * 0.35)
    const tail = Math.max(0, room - head - 20)
    written = written.slice(0, head) + '\n…（中间已写部分省略）…\n' + written.slice(-tail)
  }
  return `${intro}\n\n## 已写好的部分\n${written}${task}`
}

function joinContinuation(before, addition) {
  return `${String(before ?? '').replace(/\s+$/, '')}\n\n${String(addition ?? '').replace(/^\s+/, '')}`.trim()
}

/** 库内相对路径：生成时不依赖库，保存时才拼当前库路径。 */
function targetRelative(conf, facts, templateName = '') {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const project = safeName(path.basename(facts.cwd || ''), '未命名项目')
  const root = safeName(conf.projectRoot, '项目经历')
  // 文件名优先用模板名（例如「数DSH次数」）；取不到时回退旧的会话标题/日期命名。
  const title = safeName(templateName || facts.title || `${yy}${mm}${dd} 会话总结`, '会话总结')
  const dir = path.join(root, `${yy}.${mm}`, `${Number(mm)}.${Number(dd)} ${project}`)
  return path.join(dir, `${project} · ${title}.md`)
}

function targetPaths(conf, facts, templateName = '') {
  const rel = targetRelative(conf, facts, templateName)
  return { rel, file: conf.vaultPath ? path.join(conf.vaultPath, rel) : '' }
}

const sendJson = (res, code, value) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

const sendFile = (res, file, type) => {
  try {
    const buf = fs.readFileSync(file)
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(buf)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0
    let raw = ''
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error(T.tooLarge), { status: 413 }))
        req.destroy()
        return
      }
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(Object.assign(new Error(T.badRequest), { status: 400 }))
      }
    })
    req.on('error', () => reject(Object.assign(new Error(T.badRequest), { status: 400 })))
  })

export function apply(ctx, config = {}) {
  try {
    log(`apply ok; vault=${saved.vaultPath || '(未配置)'}`)

    let alive = true
    const pending = makePending()
    const recent = new Map()
    const limiter = makeRateLimiter(RATE_MS)

    try {
      ctx.on('session/event', (session) => {
        const id = String(session?.id ?? '')
        if (id) recent.set(id, Date.now())
      })
    } catch (error) {
      log(`session tracking unavailable: ${error?.message ?? error}`)
    }

    const freshSessionId = () => pickFreshSession(recent, Date.now(), SESSION_FRESH_MS)

    // 网页请求必须明确带着要总结的会话：不再按「只有一条 / 最近活跃」兜底。
    const explicitSessionId = (given) =>
      typeof given === 'string' && /^session-[0-9a-f-]{36}$/i.test(given) ? given : null

    const needScope = (facts) => {
      const error = new Error(T.needScope)
      error.code = 'NEED_SCOPE'
      error.status = 409
      error.stats = {
        asks: facts.asks.length,
        steps: facts.steps,
        turns: facts.turns,
        estChunks: splitFactsForAll(facts, ALL_CHUNK_CHARS).count,
      }
      return error
    }

    /**
     * 指令模式读全部：优先单次；放不下就按时间切原文，
     * 每段执行同一条用户指令，最后按指令合并。调用次数 = 段数 + 1。
     */
    const generateAllTask = async (conf, facts, template, signal) => {
      const full = fullTaskMaterial(facts)
      const single = assembleTaskPrompt(template, full)
      if (single.length <= promptBudget(template)) {
        const out = await callExact(ctx, conf, facts, SYSTEM_TASK, single, signal)
        return { markdown: out.text, truncated: out.truncated, chunks: 1, notice: '' }
      }

      const plan = splitTextForAll(full, ALL_CHUNK_CHARS)
      const parts = []
      let chunkTruncated = false
      for (let i = 0; i < plan.chunks.length; i++) {
        const prompt = taskChunkPrompt(plan.chunks[i], i + 1, plan.count, template.body)
        const out = await callExact(ctx, conf, facts, SYSTEM_TASK, prompt, signal)
        parts.push(out.text)
        if (out.truncated) chunkTruncated = true
      }

      const merged = mergeTaskParts(parts, plan.count)
      const fixed = assembleTaskMergePrompt(template, '', plan.count).length
      const room = Math.max(600, promptBudget(template) - fixed)
      const fitted = fitMerged(merged, room)
      const prompt = assembleTaskMergePrompt(template, fitted.text, plan.count)
      const out = await callExact(ctx, conf, facts, SYSTEM_TASK, prompt, signal)
      return {
        markdown: out.text,
        truncated: out.truncated,
        chunks: plan.count,
        notice:
          `读全部时按时间顺序分 ${plan.count} 段执行你的指令，结果已合并。` +
          (fitted.condensed || chunkTruncated ? '个别段的中间结果较长，合并时做了压缩。' : ''),
      }
    }

    /** 读全部：优先单次；放不下就按顺序分段提取事实要点，再合并、按模板生成。 */
    const generateAll = async (conf, facts, template, signal) => {
      if (template.freeform) return generateAllTask(conf, facts, template, signal)
      const full = fullFactsText(facts)
      const single = assemblePrompt(template, full)
      if (single.length <= userBudget()) {
        const out = await callExact(ctx, conf, facts, SYSTEM, single, signal)
        return { markdown: out.text, truncated: out.truncated, chunks: 1, notice: '' }
      }

      const plan = splitFactsForAll(facts, ALL_CHUNK_CHARS)
      const parts = []
      let extractionTruncated = false
      for (let i = 0; i < plan.chunks.length; i++) {
        const prompt = extractPrompt(plan.chunks[i], i + 1, plan.count)
        const out = await callExact(ctx, conf, facts, EXTRACT_SYSTEM, prompt, signal)
        parts.push(out.text)
        if (out.truncated) extractionTruncated = true
      }

      const merged = mergeExtractions(parts)
      const heading = '本次会话的事实（全部对话分段提取的要点）'
      const fixed = assemblePrompt(template, '', heading).length
      const room = Math.max(600, userBudget() - fixed)
      const fitted = fitMerged(merged, room)
      const prompt = assemblePrompt(template, fitted.text, heading)
      const out = await callExact(ctx, conf, facts, SYSTEM, prompt, signal)
      const honest = plan.count > 1 || fitted.condensed || extractionTruncated
      return {
        markdown: out.text,
        truncated: out.truncated,
        chunks: plan.count,
        notice: honest ? '读全部时按时间分段概括，个别细节可能被压缩。' : '',
      }
    }

    /** 续写同一稿：previewId 必须对得上；追加后换新 previewId，保存写全文。 */
    const continueDraft = async (sessionId, options, signal) => {
      const item = pending.peek(sessionId)
      if (!item) throw previewError('NO_PREVIEW', T.noPreview)
      if (options.continueFrom !== true && String(options.continueFrom) !== String(item.previewId)) {
        throw previewError('PREVIEW_STALE', T.previewStale)
      }
      const conf = cfg()
      const template = item.template || { body: '', rules: '', freeform: true }
      const modelFacts = { model: item.model || '' }
      const system = systemFor(template)
      const out = await callExact(
        ctx,
        conf,
        modelFacts,
        system,
        continuationPrompt(item.markdown, template, system),
        signal,
      )
      const markdown = joinContinuation(item.markdown, out.text)
      const previewId = crypto.randomUUID()
      const meta = {
        ...(item.meta || {}),
        sessionId: String(sessionId),
        truncated: Boolean(out.truncated),
        continued: true,
      }
      pending.put(sessionId, {
        previewId,
        markdown,
        file: item.file,
        template,
        scope: item.scope || '',
        chunks: item.chunks || 0,
        model: item.model || '',
        meta,
      })
      return {
        previewId,
        markdown,
        file: conf.vaultPath ? path.join(conf.vaultPath, item.file) : '',
        trimNotice: '',
        truncated: Boolean(out.truncated),
        scope: item.scope || '',
        chunks: item.chunks || 0,
        continued: true,
        meta,
      }
    }

    const summarize = async (sessionId, signal, options = {}) => {
      if (options.continueFrom) return continueDraft(sessionId, options, signal)

      const conf = cfg()
      const scope =
        options.scope === 'all' || options.scope === 'recent' ? options.scope : ''
      if (options.scope && !scope) {
        const error = new Error(T.badRequest)
        error.status = 400
        throw error
      }

      // 模板正文决定用哪套提示词。显式空模板不再回退内置模板：
      // 空字符串、纯空白都按未填写处理，直接拒绝，不读会话、不调模型、不生成 previewId。
      // 只有「从未保存过模板」的初次默认「项目总结」仍使用内置骨架（含执行规则），
      // 与旧行为一致；一旦用户保存过模板，就严格按正文判断。
      const list = conf.templates
      const idx = Math.min(conf.activeTemplate, Math.max(0, list.length - 1))
      const picked = list[idx]
      const initialDefault = !Array.isArray(saved.templates) && idx === 0
      let template
      let templateName = ''
      if (initialDefault) {
        template = loadTemplateFile(builtinTemplate)
        templateName = '项目总结'
      } else {
        const body = String(picked?.body ?? '')
        if (!body.trim()) {
          const error = new Error(T.templateEmpty)
          error.code = 'TEMPLATE_EMPTY'
          error.status = 409
          throw error
        }
        template = { body, rules: '', freeform: !body.includes('【') }
        templateName = String(picked?.name ?? '').trim()
      }

      const snap = await ctx.sessionQuery.readSession(sessionId)
      const facts = factsFromEvents(Array.isArray(snap.events) ? snap.events : [])
      if (snap.session) {
        facts.cwd ||= snap.session.cwd ?? ''
        facts.startedAt ||= snap.session.createdAt ?? 0
        facts.id ||= snap.session.id ?? ''
      }
      if (!facts.asks.length && !facts.turns) throw new Error(T.noContent)

      // 首轮就给「直接输出」重试前缀留出预算，保证第二次不越界。
      const built = buildPrompt(template, facts, {}, promptBudget(template, RETRY_PREFIX.length))
      // 会被压缩时必须先让用户选读取范围；这一步不调用模型、不生成 previewId。
      if (built.notice && !scope) throw needScope(facts)

      let result
      if (scope === 'all') {
        result = await generateAll(conf, facts, template, signal)
        result.scope = 'all'
      } else {
        const out = await callModel(ctx, conf, facts, built, signal)
        result = {
          markdown: out.text,
          truncated: out.truncated,
          chunks: 0,
          notice: built.notice,
          scope: scope || 'direct',
        }
      }

      const { rel, file } = targetPaths(conf, facts, templateName)
      const previewId = crypto.randomUUID()
      const meta = {
        sessionId: String(sessionId),
        title: facts.title || '(无标题)',
        turns: facts.turns,
        firstAsk: String(facts.asks[0]?.text ?? '').slice(0, 40),
        startedAt: facts.startedAt,
        trimNotice: result.notice,
        scope: result.scope,
        chunks: result.chunks,
      }
      pending.put(sessionId, {
        previewId,
        markdown: result.markdown,
        file: rel,
        template,
        scope: result.scope,
        chunks: result.chunks,
        model: facts.model,
        meta,
      })
      return {
        previewId,
        markdown: result.markdown,
        file,
        trimNotice: result.notice,
        truncated: Boolean(result.truncated),
        scope: result.scope,
        chunks: result.chunks,
        meta,
      }
    }

    const persist = makePersist({
      pending,
      vaultPath: () => cfg().vaultPath,
      // 保持注入点：测试可直接替换 write，生产仍走 safe.js
      write: writeNote,
    })

    const disposeSummary = ctx.commands.register({
      name: 'summary',
      description: '按当前模板生成结果（先预览，不写盘）',
      handler: async ({ agent, signal }) => {
        try {
          // 聊天命令没有选择界面：沿用「只读重点」，并把压缩说明说成人话。
          const { markdown, file, trimNotice } = await summarize(agent.id, signal, { scope: 'recent' })
          const lines = ['**预览（还没写入）**', '']
          if (trimNotice) lines.push(`> ${trimNotice}`, '')
          lines.push(markdown, '', '---')
          if (file) lines.push(`将写入：\`${file}\``)
          else lines.push('还没选库：保存前先在面板设置里选一个库。')
          return { kind: 'success', text: lines.join('\n') }
        } catch (error) {
          return { kind: 'error', text: `生成失败：${error?.message ?? error}` }
        }
      },
    })

    const disposeSave = ctx.commands.register({
      name: 'save',
      description: '把上一条 /summary 的预览写进 Obsidian',
      handler: async ({ agent }) => {
        try {
          const file = await persist(agent.id)
          return { kind: 'success', text: `已写入：\`${file}\`` }
        } catch (error) {
          return { kind: 'error', text: `写入失败：${error?.message ?? error}` }
        }
      },
    })

    ctx.inject(['webServer'], (wctx) => {
      const routes = []
      const route = (p, handler) => {
        try {
          routes.push(wctx.webServer.register({ path: p, handler }))
        } catch (error) {
          log(`route ${p} failed: ${error?.message ?? error}`)
        }
      }

      const sameOrigin = (req) => {
        if (req.headers['sec-fetch-site'] === 'cross-site') return false
        const origin = req.headers.origin
        if (!origin) return true
        try {
          return new URL(origin).host === req.headers.host
        } catch {
          return false
        }
      }

      const guardPost = (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return false
        }
        if (!sameOrigin(req) || req.headers['x-recap-token'] !== TOKEN) {
          sendJson(res, 403, { ok: false, error: T.forbidden })
          return false
        }
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
          sendJson(res, 415, { ok: false, error: 'need application/json' })
          return false
        }
        return true
      }

      const handle = (fn) => async (req, res) => {
        try {
          await fn(req, res)
        } catch (error) {
          log(`route error: ${error?.stack ?? error}`)
          if (!res.headersSent) {
            // EISDIR 这类技术错误要翻成人话再给用户
            const human = humanError(error)
            sendJson(res, human.status, {
              ok: false,
              ...(human.code ? { code: human.code } : {}),
              ...(human.stats ? { stats: human.stats } : {}),
              error: human.message,
            })
          }
        }
      }

      route('/dsh-recap/ui.js', (_req, res) => sendFile(res, uiFile, 'text/javascript; charset=utf-8'))
      route('/dsh-recap/strings.js', (_req, res) => sendFile(res, path.join(here, 'strings.js'), 'text/javascript; charset=utf-8'))
      route('/dsh-recap/flow.js', (_req, res) => sendFile(res, path.join(here, 'flow.js'), 'text/javascript; charset=utf-8'))
      route('/dsh-recap/markdown.js', (_req, res) => sendFile(res, path.join(here, 'markdown.js'), 'text/javascript; charset=utf-8'))
      route('/dsh-recap/cat.png', (_req, res) => sendFile(res, catFile, 'image/png'))
      route('/dsh-recap/cat.mp3', (_req, res) => sendFile(res, catSound, 'audio/mpeg'))
      for (const s of catStates) {
        route(`/dsh-recap/${s}.webp`, (_req, res) =>
          sendFile(res, path.join(here, '..', 'assets', `${s}.webp`), 'image/webp'),
        )
      }
      route(
        '/dsh-recap/ping',
        handle(async (_req, res) => {
          if (!alive) return sendJson(res, 410, { ok: false })
          await new Promise((r) => setTimeout(r, 8000))
          if (!alive) return sendJson(res, 410, { ok: false })
          sendJson(res, 200, { ok: true, build: BUILD })
        }),
      )

      route(
        '/dsh-recap/config',
        handle(async (req, res) => {
          // 读也要口令：这个端口能回来的东西不该包含库路径
          if (!sameOrigin(req) || req.headers['x-recap-token'] !== TOKEN) {
            return sendJson(res, 403, { ok: false, error: T.forbidden })
          }
          if (req.method === 'POST') {
            if (!guardPost(req, res)) return
            await saveConfig((await readBody(req)).config ?? {})
          }
          const conf = cfg()
          sendJson(res, 200, {
            ok: true,
            build: BUILD,
            config: {
              vaultPath: conf.vaultPath,
              projectRoot: conf.projectRoot,
              provider: conf.provider,
              model: conf.model,
              templates: conf.templates,
              activeTemplate: conf.activeTemplate,
            },
          })
        }),
      )

      route(
        '/dsh-recap/vaults',
        handle(async (req, res) => {
          if (!sameOrigin(req) || req.headers['x-recap-token'] !== TOKEN) {
            return sendJson(res, 403, { ok: false, error: T.forbidden })
          }
          sendJson(res, 200, { ok: true, candidates: candidateVaults(), lastOpened: lastOpenedVault() })
        }),
      )

      route(
        '/dsh-recap/vault/check',
        handle(async (req, res) => {
          if (!guardPost(req, res)) return
          const result = await checkDir(String((await readBody(req)).path ?? ''), { needObsidian: true })
          sendJson(res, 200, { ok: result.ok, reason: result.reason ?? '' })
        }),
      )

      route(
        '/dsh-recap/sessions',
        handle(async (req, res) => {
          if (!sameOrigin(req) || req.headers['x-recap-token'] !== TOKEN) {
            return sendJson(res, 403, { ok: false, error: T.forbidden })
          }
          const live = ctx.get('sessions')?.list?.() ?? []
          const items = []
          for (const session of live) {
            const id = String(session.id)
            let title = ''
            try {
              title = (await ctx.sessionQuery.readTitle(id))?.title ?? ''
            } catch {
              title = ''
            }
            let turns = null
            try {
              const snap = await ctx.sessionQuery.readSession(id)
              turns = (snap.events ?? []).filter((e) => e.type === 'turn/start').length
            } catch {
              turns = null
            }
            items.push({ sessionId: id, title: title || '(无标题)', turns, startedAt: session.header?.createdAt ?? 0 })
          }
          items.sort((a, b) => b.startedAt - a.startedAt)
          sendJson(res, 200, { ok: true, items, current: freshSessionId() })
        }),
      )

      route(
        '/dsh-recap/summary',
        handle(async (req, res) => {
          if (!guardPost(req, res)) return
          const body = await readBody(req)
          // 选读取范围/续写是对同一次生成的直接跟进，不受 5 秒限流影响。
          if (!body.scope && !body.continueFrom && limiter.shouldReject(Date.now())) {
            return sendJson(res, 429, { ok: false, error: T.rateLimited })
          }
          // 没有明确选择就不猜：不按「最近活跃」或「只剩一条」自动换会话。
          const sessionId = explicitSessionId(body.sessionId)
          if (!sessionId) return sendJson(res, 409, { ok: false, error: T.noSession })
          sendJson(res, 200, {
            ok: true,
            sessionId,
            ...(await summarize(sessionId, undefined, {
              scope: body.scope,
              continueFrom: body.continueFrom,
            })),
          })
        }),
      )

      route(
        '/dsh-recap/save',
        handle(async (req, res) => {
          if (!guardPost(req, res)) return
          const body = await readBody(req)
          // 判断全在 decideSave：会话与 previewId 都要对得上，旧稿一律拒绝。
          const decision = decideSave(body.sessionId, pending, body.previewId)
          if (decision.status !== 200) {
            return sendJson(res, decision.status, decision.body)
          }
          // 无库只挡保存，不清 pending：用户选完库后同一稿直接重试。
          if (!cfg().vaultPath) {
            return sendJson(res, 409, { ok: false, code: 'NO_VAULT', error: T.noVaultSave })
          }
          sendJson(res, 200, {
            ok: true,
            previewId: decision.body.previewId,
            file: await persist(decision.body.id, decision.body.previewId),
          })
        }),
      )

      const bootstrap =
        `(function(){try{window.__dshRecapToken=${JSON.stringify(TOKEN)};` +
        `window.__dshRecapBuild=${JSON.stringify(BUILD)};` +
        `if(window.__dshRecapMounted)return;var d=document.body||document.head;if(!d)return;` +
        `var s=document.createElement("script");s.type="module";` +
        `s.src="/dsh-recap/ui.js?v=" + encodeURIComponent(${JSON.stringify(BUILD)});` +
        `s.onerror=function(){};d.appendChild(s)}catch(e){}})()`

      try {
        ctx.on('webserver/index-inject', (table) => {
          try {
            if (!Array.isArray(table)) return
            if (table.some((r) => r && typeof r.text === 'string' && r.text.includes('/dsh-recap/ui.js'))) return
            table.push({ kind: 'script', placement: 'body', text: bootstrap })
          } catch {
            /* ignore */
          }
        })
      } catch (error) {
        log(`index-inject failed: ${error?.message ?? error}`)
      }
      try {
        wctx.webServer.tapIndex((html) => `${html}<script>${bootstrap}</script>`)
      } catch {
        /* web 形态可能没有 tapIndex */
      }

      ctx.effect(() => () => {
        for (const d of routes) {
          try {
            d()
          } catch {
            /* ignore */
          }
        }
      })
    })

    ctx.effect(() => () => {
      alive = false
      disposeSummary()
      disposeSave()
    })
  } catch (error) {
    log(`apply crashed: ${error?.stack ?? error}`)
    throw error
  }
}

export default apply
apply.inject = inject
