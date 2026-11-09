/**
 * 从会话事件数组里提取「事实」：诉求、改动的文件、跑过的命令、踩的错、交付物。
 * 纯函数，不依赖 DSH 运行时，方便单测。
 */

const textOf = (blocks) =>
  (blocks ?? [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

const esc = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()

export function clip(s, n) {
  s = esc(s)
  return s.length > n ? s.slice(0, n) + '…' : s
}

function errorLine(text) {
  const first = String(text ?? '').split('\n').find((l) => l.trim()) ?? ''
  return clip(first.replace(/^Error: code run failed \([^)]*\):\s*/, ''), 120)
}

const WRITE_OPS = new Set(['write', 'edit'])

export function factsFromEvents(events) {
  const facts = {
    id: '',
    cwd: '',
    title: '',
    startedAt: 0,
    endedAt: 0,
    model: '',
    turns: 0,
    steps: 0,
    asks: [],
    files: new Map(),
    shells: [],
    // 指令模式要按原文计数/查命令：shells 仍存 90 字摘要给笔记模式，
    // shellsRaw 保留完整命令，不改旧字段的含义。
    shellsRaw: [],
    searches: [],
    presents: [],
    errors: [],
    turnWords: [],
  }

  const seen = new Set()
  let turnNo = 0
  const note = (name, args, id) => {
    const key = id ? `${name}:${id}` : ''
    if (key && seen.has(key)) return
    if (key) seen.add(key)

    if (WRITE_OPS.has(name)) {
      const p = args.file_path ?? args.path
      if (p) {
        const prev = facts.files.get(p) ?? { ops: new Set(), hits: 0 }
        prev.ops.add(name)
        prev.hits++
        facts.files.set(p, prev)
      }
      return
    }
    if (name === 'pwsh' || name === 'bash' || name === 'terminal_open') {
      const label = args.description ?? args.command ?? ''
      if (label) {
        facts.shells.push(clip(label, 90))
        facts.shellsRaw.push(String(label))
      }
      return
    }
    if (name === 'web_search' || name === 'web_fetch') {
      const q = Array.isArray(args.queries) ? args.queries.join(' / ') : args.url ?? ''
      if (q) facts.searches.push(clip(q, 90))
      return
    }
    if (name === 'present') {
      const files = Array.isArray(args.files) ? args.files.map((f) => f.path).join(', ') : ''
      facts.presents.push(clip(args.description ?? files, 100))
    }
  }

  for (const ev of events) {
    const d = ev.data ?? {}
    switch (ev.type) {
      case 'session':
        facts.id = ev.id ?? facts.id
        facts.cwd = ev.cwd ?? facts.cwd
        facts.startedAt = ev.createdAt ?? facts.startedAt
        break
      case 'session/title':
        facts.title = d.title ?? facts.title
        break
      case 'request/header': {
        const c = d.header?.config
        if (c) facts.model = `${c.provider} / ${c.model}`
        break
      }
      case 'turn/start':
        facts.turns++
        turnNo += 1
        break
      case 'step/start':
        facts.steps++
        break
      case 'turn/end':
        facts.endedAt = ev.time
        break
      case 'user/message': {
        const text = textOf(d.content)
        if (text && d.source?.kind === 'user') facts.asks.push({ seq: ev.seq, turn: turnNo, text })
        break
      }
      case 'assistant/message': {
        const text = textOf(d.message?.content)
        if (text) facts.turnWords.push({ turn: d.turn, text })
        break
      }
      case 'tool/ptc-dispatch':
        note(d.name, d.arguments ?? {}, d.subCallId)
        if (d.isError) facts.errors.push({ name: d.name, text: errorLine(textOf(d.content)) })
        break
      case 'tool/call': {
        if (d.name === 'run_code') break
        let args = {}
        try {
          args = JSON.parse(d.arguments ?? '{}')
        } catch {
          args = {}
        }
        note(d.name, args, d.callId)
        break
      }
      default:
        break
    }
  }
  return facts
}

/**
 * 提示词材料的长度策略。数字是「事实材料」的上限，不包含模板正文。
 * 长对话不能只留最早几条：最初目标、关键更正、最终决定都要保住。
 */
export const PROMPT_LIMITS = {
  maxAsks: 20,
  recentAsks: 6,
  maxCorrections: 5,
  firstAskChars: 500,
  askChars: 320,
  files: 20,
  shells: 12,
  searches: 6,
  errors: 8,
  presents: 6,
  tail: 3,
  totalChars: 12000,
}

/** 材料超长时逐级压缩明细，最后才动诉求条目 */
const CAP_STEPS = [
  { files: 14, shells: 8, searches: 0, errors: 6, presents: 4, tail: 3 },
  { files: 10, shells: 5, searches: 0, errors: 4, presents: 2, tail: 2 },
  { files: 6, shells: 3, searches: 0, errors: 2, presents: 1, tail: 1 },
  { files: 0, shells: 0, searches: 0, errors: 0, presents: 0, tail: 0 },
]

const STRONG_CORRECTION =
  /(改成|改为|换成|换为|不要|不对|不是这|错了|漏了|漏掉|必须|重新|修正|更正|决定|定稿|删掉|删除|去掉|加上|优先|别把|不能|只用|保留|最后)/g
const WEAK_CORRECTION = /(改|注意|其实|应该|要求|记得|补充|需要|还是|换|别)/g

/** 一条诉求像不像「更正 / 最终决定」；只用来在中间段落里挑重点 */
export function correctionScore(text) {
  const s = esc(text)
  const strong = (s.match(STRONG_CORRECTION) || []).length
  const weak = (s.match(WEAK_CORRECTION) || []).length
  return strong * 3 + weak
}

const CLIP_MARKER = '…（中间省略）…'

/**
 * 长消息不能只留开头：最初目标和末尾的最终更正往往都在同一条消息里。
 * 预算够时保留开头 + 结尾，中间用标记代替；实在放不下才退回只留开头。
 */
function clipCounted(text, cap) {
  const s = esc(text)
  if (s.length <= cap) return { text: s, clipped: false, tailKept: false }
  if (cap <= CLIP_MARKER.length + 2) {
    return { text: s.slice(0, Math.max(0, cap - 1)) + '…', clipped: true, tailKept: false }
  }
  const room = cap - CLIP_MARKER.length
  const tail = Math.max(1, Math.floor(room * 0.45))
  const head = room - tail
  return {
    text: s.slice(0, head) + CLIP_MARKER + s.slice(s.length - tail),
    clipped: true,
    tailKept: true,
  }
}

/**
 * 挑选要发送的诉求：第一条（最初目标）必留，最近若干条必留，
 * 中间按「更正信号」挑重点，再从近往远补满名额。返回的下标保持时间顺序。
 */
export function selectAsks(asks, limits = {}) {
  const L = { ...PROMPT_LIMITS, ...(limits || {}) }
  const n = Array.isArray(asks) ? asks.length : 0
  const keep = new Map()
  const add = (i, reason, priority) => {
    if (i < 0 || i >= n) return
    const prev = keep.get(i)
    if (!prev || priority < prev.priority) keep.set(i, { reason, priority })
  }

  if (!n) return { indexes: [], keep }

  add(0, 'first', 0)
  const recentStart = Math.max(1, n - L.recentAsks)
  for (let i = recentStart; i < n; i++) add(i, 'recent', 1)

  const corrections = []
  for (let i = 1; i < recentStart; i++) {
    const score = correctionScore(asks[i]?.text)
    if (score > 0) corrections.push({ i, score })
  }
  corrections.sort((a, b) => b.score - a.score || b.i - a.i)
  for (const c of corrections.slice(0, L.maxCorrections)) add(c.i, 'correction', 1)

  for (let i = n - 1; i >= 0 && keep.size < L.maxAsks; i--) add(i, 'recent', 2)

  return { indexes: [...keep.keys()].sort((a, b) => a - b), keep }
}

function importanceOf(i, n, keep) {
  if (i === 0) return 1000
  if (i === n - 1) return 900
  const reason = keep.get(i)?.reason
  const base = reason === 'correction' ? 500 : reason === 'recent' ? 400 : 100
  return base + i / Math.max(1, n)
}

function renderFacts(facts, indexes, caps, L) {
  const lines = []
  lines.push(`工作区：${facts.cwd || '未知'}`)
  if (facts.title) lines.push(`会话标题：${facts.title}`)
  if (facts.startedAt)
    lines.push(`开始时间：${new Date(facts.startedAt).toLocaleString('zh-CN', { hour12: false })}`)
  lines.push(`规模：${facts.turns} 轮 / ${facts.steps} 步，模型 ${facts.model || '未知'}`)
  lines.push('')

  const asks = Array.isArray(facts.asks) ? facts.asks : []
  lines.push('用户诉求（按原对话顺序，编号即先后；中间可能有省略）：')
  let clippedAsks = 0
  let headTailAsks = 0
  for (const i of indexes) {
    const cap = i === 0 ? L.firstAskChars : L.askChars
    const c = clipCounted(asks[i]?.text, cap)
    if (c.clipped) {
      clippedAsks++
      if (c.tailKept) headTailAsks++
    }
    lines.push(`${i + 1}. ${c.text}`)
  }
  lines.push('')

  const files = facts.files instanceof Map ? [...facts.files.entries()] : []
  const sortedFiles = files.sort((a, b) => b[1].hits - a[1].hits)
  lines.push('写过的文件（按次数）：')
  sortedFiles.slice(0, caps.files).forEach(([p, v]) => lines.push(`- ${p}（${[...v.ops].join('+')} ×${v.hits}）`))
  lines.push('')

  const shells = Array.isArray(facts.shells) ? facts.shells : []
  if (shells.length && caps.shells) {
    lines.push('跑过的命令：')
    shells.slice(0, caps.shells).forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }
  const searches = Array.isArray(facts.searches) ? facts.searches : []
  if (searches.length && caps.searches) {
    lines.push('查过的资料：')
    searches.slice(0, caps.searches).forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }
  const errors = Array.isArray(facts.errors) ? facts.errors : []
  if (errors.length && caps.errors) {
    lines.push('工具报错（现象，供你判断根因）：')
    errors.slice(0, caps.errors).forEach((e) => lines.push(`- [${e.name}] ${e.text}`))
    lines.push('')
  }
  const presents = Array.isArray(facts.presents) ? facts.presents : []
  if (presents.length && caps.presents) {
    lines.push('交付物：')
    presents.slice(0, caps.presents).forEach((p) => lines.push(`- ${p}`))
    lines.push('')
  }
  const turnWords = Array.isArray(facts.turnWords) ? facts.turnWords : []
  if (turnWords.length && caps.tail) {
    lines.push('最后几段回复（供提炼结论）：')
    turnWords.slice(-caps.tail).forEach((t) => lines.push(`- ${clip(t.text, 400)}`))
  }

  return {
    text: lines.join('\n'),
    clippedAsks,
    headTailAsks,
    omitted: {
      files: Math.max(0, sortedFiles.length - caps.files),
      shells: Math.max(0, shells.length - caps.shells),
      searches: Math.max(0, searches.length - caps.searches),
      errors: Math.max(0, errors.length - caps.errors),
      presents: Math.max(0, presents.length - caps.presents),
      tail: Math.max(0, turnWords.length - caps.tail),
    },
  }
}

/** 用户可见的读取范围说明：只说人话，不出现「材料 / 裁剪 / 未发送 / 上限」这类词。 */
function trimNotice(asks, indexes, rendered, extra) {
  const kept = indexes.length
  const omittedAsks = Math.max(0, asks.length - kept)
  const detailOmitted = Object.values(rendered.omitted).some((n) => n > 0)
  const clipped = rendered.clippedAsks > 0
  let sentence = ''
  if (omittedAsks > 0) {
    sentence =
      `对话比较长，这次只读了重点：最初的诉求、关键更正和最近 20 条，` +
      `还有 ${omittedAsks} 条较早的诉求没读到，可能漏掉中间一些细节。`
  } else if (detailOmitted || clipped || extra.forced || extra.hardClipped) {
    sentence = '对话比较长，这次只读了重点，部分命令和报错明细没有带进来，可能漏掉中间一些细节。'
  }
  if (!sentence) return ''
  return sentence + '\n想要更完整，可以点下面的「改用完整读取」。'
}

/**
 * 读全部时的完整材料：不按 maxAsks / 明细名额压缩，所有诉求和明细都进来。
 * 只做换行折叠，不截断条目。
 */
export function fullFactsText(facts) {
  const lines = []
  lines.push(`工作区：${facts.cwd || '未知'}`)
  if (facts.title) lines.push(`会话标题：${facts.title}`)
  if (facts.startedAt)
    lines.push(`开始时间：${new Date(facts.startedAt).toLocaleString('zh-CN', { hour12: false })}`)
  lines.push(`规模：${facts.turns} 轮 / ${facts.steps} 步，模型 ${facts.model || '未知'}`)
  lines.push('')

  const asks = Array.isArray(facts.asks) ? facts.asks : []
  lines.push(`用户诉求（全部 ${asks.length} 条，按原对话顺序）：`)
  asks.forEach((a, i) => lines.push(`${i + 1}. ${esc(a.text)}`))
  lines.push('')

  const files = facts.files instanceof Map ? [...facts.files.entries()] : []
  const sortedFiles = files.sort((a, b) => b[1].hits - a[1].hits)
  if (sortedFiles.length) {
    lines.push(`写过的文件（全部 ${sortedFiles.length} 个，按次数）：`)
    sortedFiles.forEach(([p, v]) => lines.push(`- ${p}（${[...v.ops].join('+')} ×${v.hits}）`))
    lines.push('')
  }
  const shells = Array.isArray(facts.shells) ? facts.shells : []
  if (shells.length) {
    lines.push(`跑过的命令（全部 ${shells.length} 条）：`)
    shells.forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }
  const searches = Array.isArray(facts.searches) ? facts.searches : []
  if (searches.length) {
    lines.push(`查过的资料（全部 ${searches.length} 条）：`)
    searches.forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }
  const errors = Array.isArray(facts.errors) ? facts.errors : []
  if (errors.length) {
    lines.push(`工具报错（全部 ${errors.length} 条）：`)
    errors.forEach((e) => lines.push(`- [${e.name}] ${e.text}`))
    lines.push('')
  }
  const presents = Array.isArray(facts.presents) ? facts.presents : []
  if (presents.length) {
    lines.push(`交付物（全部 ${presents.length} 条）：`)
    presents.forEach((p) => lines.push(`- ${p}`))
    lines.push('')
  }
  const turnWords = Array.isArray(facts.turnWords) ? facts.turnWords : []
  if (turnWords.length) {
    lines.push(`助手回复（全部 ${turnWords.length} 段）：`)
    turnWords.forEach((t) => lines.push(`- ${clip(t.text, 1200)}`))
  }
  return lines.join('\n')
}

export const ALL_CHUNK_CHARS = 16000

/** 把一段文本切成不超过 max 的片；超长单条用「（续）」标记，不整条丢掉。 */
function pushSlices(items, text, max) {
  const s = String(text ?? '')
  if (!s) return
  if (s.length <= max) {
    items.push(s)
    return
  }
  let start = 0
  while (start < s.length) {
    const end = Math.min(s.length, start + max)
    items.push((start > 0 ? '（续）' : '') + s.slice(start, end))
    start = end
  }
}

/**
 * 读全部用的分段材料：所有诉求先按时间顺序进来，再按文件/命令/资料/报错/
 * 交付物/回复的顺序把明细全部放进后续段。每段都控制在 maxChars 内，
 * 超长单条切片而不是丢弃；返回的 chunks 数与 estChunks 一致。
 */
export function splitFactsForAll(facts, maxChars = ALL_CHUNK_CHARS) {
  const max = Math.max(2000, Number(maxChars) || ALL_CHUNK_CHARS)
  const items = []
  const asks = Array.isArray(facts.asks) ? facts.asks : []
  asks.forEach((a, i) => pushSlices(items, `${i + 1}. ${esc(a.text)}`, max - 80))

  const files = facts.files instanceof Map ? [...facts.files.entries()] : []
  const sortedFiles = files.sort((a, b) => b[1].hits - a[1].hits)
  if (sortedFiles.length) {
    items.push(`写过的文件（全部 ${sortedFiles.length} 个，按次数）：`)
    sortedFiles.forEach(([p, v]) => items.push(`- ${p}（${[...v.ops].join('+')} ×${v.hits}）`))
  }
  const shells = Array.isArray(facts.shells) ? facts.shells : []
  if (shells.length) {
    items.push(`跑过的命令（全部 ${shells.length} 条）：`)
    shells.forEach((s) => pushSlices(items, `- ${s}`, max - 80))
  }
  const searches = Array.isArray(facts.searches) ? facts.searches : []
  if (searches.length) {
    items.push(`查过的资料（全部 ${searches.length} 条）：`)
    searches.forEach((s) => pushSlices(items, `- ${s}`, max - 80))
  }
  const errors = Array.isArray(facts.errors) ? facts.errors : []
  if (errors.length) {
    items.push(`工具报错（全部 ${errors.length} 条）：`)
    errors.forEach((e) => pushSlices(items, `- [${e.name}] ${e.text}`, max - 80))
  }
  const presents = Array.isArray(facts.presents) ? facts.presents : []
  if (presents.length) {
    items.push(`交付物（全部 ${presents.length} 条）：`)
    presents.forEach((p) => pushSlices(items, `- ${p}`, max - 80))
  }
  const turnWords = Array.isArray(facts.turnWords) ? facts.turnWords : []
  if (turnWords.length) {
    items.push(`助手回复（全部 ${turnWords.length} 段）：`)
    turnWords.forEach((t) => pushSlices(items, `- ${clip(t.text, 1200)}`, max - 80))
  }

  const chunks = []
  let current = ''
  for (const item of items) {
    if (current && current.length + item.length + 1 > max) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n${item}` : item
  }
  if (current) chunks.push(current)
  if (!chunks.length) chunks.push('（这次对话没有可读内容）')
  const count = chunks.length
  return {
    chunks: chunks.map((text, i) => `第 ${i + 1}/${count} 段\n${text}`),
    count,
    maxChars: max,
  }
}

/**
 * 生产路径：生成发给模型的事实材料，并带回一份用户可见的裁剪说明。
 * factsToPrompt 保持原样返回字符串，供老调用方使用。
 */
export function buildFactsPrompt(facts, limits = {}) {
  const L = { ...PROMPT_LIMITS, ...(limits || {}) }
  const asks = Array.isArray(facts.asks) ? facts.asks : []
  const { indexes: selected, keep } = selectAsks(asks, L)

  let indexes = selected.slice()
  const baseCaps = {
    files: L.files,
    shells: L.shells,
    searches: L.searches,
    errors: L.errors,
    presents: L.presents,
    tail: L.tail,
  }
  let caps = { ...baseCaps }
  let rendered = renderFacts(facts, indexes, caps, L)
  let forced = false

  // 先压缩明细（命令、资料、报错、交付物、末尾回复），诉求条目最后才动
  let step = 0
  while (rendered.text.length > L.totalChars && step < CAP_STEPS.length) {
    const s = CAP_STEPS[step++]
    const nextCaps = {
      files: Math.min(baseCaps.files, s.files),
      shells: Math.min(baseCaps.shells, s.shells),
      searches: Math.min(baseCaps.searches, s.searches),
      errors: Math.min(baseCaps.errors, s.errors),
      presents: Math.min(baseCaps.presents, s.presents),
      tail: Math.min(baseCaps.tail, s.tail),
    }
    const next = renderFacts(facts, indexes, nextCaps, L)
    if (next.text.length < rendered.text.length || nextCaps.files !== caps.files) forced = true
    caps = nextCaps
    rendered = next
  }

  // 仍然超长：从最不重要的中间诉求开始丢，第一条和最后一条永远保留
  while (rendered.text.length > L.totalChars && indexes.length > 1) {
    const n = asks.length
    const candidates = indexes.filter((i) => i !== 0 && i !== n - 1)
    if (!candidates.length) break
    let victim = candidates[0]
    for (const i of candidates) {
      if (importanceOf(i, n, keep) < importanceOf(victim, n, keep)) victim = i
    }
    indexes = indexes.filter((i) => i !== victim)
    forced = true
    rendered = renderFacts(facts, indexes, caps, L)
  }

  // 极端情况（单条消息本身就比上限长）：只保留上限内的开头，并明确告知截断
  let hardClipped = false
  if (rendered.text.length > L.totalChars) {
    const suffix = '\n…（材料超长，已截断）'
    const room = Math.max(0, L.totalChars)
    rendered = {
      ...rendered,
      text:
        room > suffix.length
          ? rendered.text.slice(0, room - suffix.length) + suffix
          : rendered.text.slice(0, room),
    }
    hardClipped = true
    forced = true
  }

  const notice = trimNotice(asks, indexes, rendered, { forced, hardClipped })
  return {
    text: rendered.text,
    notice,
    trim: {
      totalAsks: asks.length,
      sentAsks: indexes.length,
      clippedAsks: rendered.clippedAsks,
      headTailAsks: rendered.headTailAsks,
      omitted: rendered.omitted,
      forced,
      hardClipped,
    },
  }
}

export function factsToPrompt(facts, limits = {}) {
  return buildFactsPrompt(facts, limits).text
}

// ——— 指令模式：给对话原文，不做「只写结论和取舍」的压缩 ———

const fullCaps = { files: Infinity, shells: Infinity, searches: Infinity, errors: Infinity, presents: Infinity, tail: Infinity }

/** 按时间把用户原话与助手回复交错排好；缺少 turn 的旧材料按 0 处理。 */
function taskTimeline(facts, indexes, caps) {
  const asks = Array.isArray(facts.asks) ? facts.asks : []
  const keep = new Set(indexes)
  const items = []
  asks.forEach((a, i) => {
    if (keep.has(i)) items.push({ turn: Number(a.turn) || 0, role: 'user', text: esc(a.text) })
  })
  const words = Array.isArray(facts.turnWords) ? facts.turnWords : []
  const selected = caps.tail === Infinity ? words : words.slice(-Math.max(0, caps.tail || 0))
  selected.forEach((t) => items.push({ turn: Number(t.turn) || 0, role: 'assistant', text: esc(t.text) }))
  items.sort((a, b) => a.turn - b.turn || (a.role === 'user' ? -1 : 1))
  return items
}

/**
 * 指令模式的材料：保留说话人、先后、完整命令与文件名。
 * 预算不够时仍按 selectAsks 的范围规则取舍，并回传 notice（上层据此要求先选读取范围）。
 */
function renderTaskFacts(facts, indexes, caps, L) {
  const lines = []
  lines.push(`工作区：${facts.cwd || '未知'}`)
  if (facts.title) lines.push(`会话标题：${facts.title}`)
  if (facts.startedAt)
    lines.push(`开始时间：${new Date(facts.startedAt).toLocaleString('zh-CN', { hour12: false })}`)
  lines.push(`规模：${facts.turns} 轮 / ${facts.steps} 步，模型 ${facts.model || '未知'}`)
  lines.push('')

  lines.push('## 对话原文（按顺序）')
  for (const item of taskTimeline(facts, indexes, caps)) {
    lines.push(`${item.role === 'user' ? '用户' : '助手'}：${item.text}`)
  }
  lines.push('')

  const files = facts.files instanceof Map ? [...facts.files.entries()] : []
  const sortedFiles = files.sort((a, b) => b[1].hits - a[1].hits)
  if (sortedFiles.length && caps.files) {
    lines.push('写过的文件：')
    sortedFiles.slice(0, caps.files).forEach(([p, v]) => lines.push(`- ${p}（${[...v.ops].join('+')} ×${v.hits}）`))
    lines.push('')
  }
  // shellsRaw 是完整命令；旧测试构造的 facts 没有它时退回 shells 摘要。
  const shells = Array.isArray(facts.shellsRaw) && facts.shellsRaw.length
    ? facts.shellsRaw
    : Array.isArray(facts.shells) ? facts.shells : []
  if (shells.length && caps.shells) {
    lines.push('跑过的命令（原文）：')
    shells.slice(0, caps.shells).forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }
  const searches = Array.isArray(facts.searches) ? facts.searches : []
  if (searches.length && caps.searches) {
    lines.push('查过的资料（原文）：')
    searches.slice(0, caps.searches).forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }
  const errors = Array.isArray(facts.errors) ? facts.errors : []
  if (errors.length && caps.errors) {
    lines.push('工具报错（原文）：')
    errors.slice(0, caps.errors).forEach((e) => lines.push(`- [${e.name}] ${e.text}`))
    lines.push('')
  }
  const presents = Array.isArray(facts.presents) ? facts.presents : []
  if (presents.length && caps.presents) {
    lines.push('交付物：')
    presents.slice(0, caps.presents).forEach((p) => lines.push(`- ${p}`))
  }

  return {
    text: lines.join('\n'),
    clippedAsks: 0,
    headTailAsks: 0,
    omitted: {
      files: Math.max(0, sortedFiles.length - (caps.files === Infinity ? sortedFiles.length : caps.files)),
      shells: Math.max(0, shells.length - (caps.shells === Infinity ? shells.length : caps.shells)),
      searches: Math.max(0, searches.length - (caps.searches === Infinity ? searches.length : caps.searches)),
      errors: Math.max(0, errors.length - (caps.errors === Infinity ? errors.length : caps.errors)),
      presents: Math.max(0, presents.length - (caps.presents === Infinity ? presents.length : caps.presents)),
      tail: Math.max(
        0,
        (facts.turnWords?.length ?? 0) -
          (caps.tail === Infinity ? facts.turnWords?.length ?? 0 : caps.tail || 0),
      ),
    },
  }
}

/** 指令模式在单次预算内的材料：复用 buildFactsPrompt 的「先压明细、最后才减诉求」策略。 */
export function buildTaskMaterial(facts, limits = {}) {
  const L = { ...PROMPT_LIMITS, ...(limits || {}) }
  const asks = Array.isArray(facts.asks) ? facts.asks : []
  const { indexes: selected, keep } = selectAsks(asks, L)
  let indexes = selected.slice()
  const baseCaps = {
    files: L.files,
    shells: L.shells,
    searches: L.searches,
    errors: L.errors,
    presents: L.presents,
    // 指令模式要能数清整段对话：默认带上全部助手回复，
    // 只有确实超出预算时才按 CAP_STEPS 依次减少。
    tail: Infinity,
  }
  let caps = { ...baseCaps }
  let rendered = renderTaskFacts(facts, indexes, caps, L)
  let forced = false

  let step = 0
  while (rendered.text.length > L.totalChars && step < CAP_STEPS.length) {
    const s = CAP_STEPS[step++]
    const nextCaps = {
      files: Math.min(baseCaps.files, s.files),
      shells: Math.min(baseCaps.shells, s.shells),
      searches: Math.min(baseCaps.searches, s.searches),
      errors: Math.min(baseCaps.errors, s.errors),
      presents: Math.min(baseCaps.presents, s.presents),
      tail: Math.min(baseCaps.tail, s.tail),
    }
    const next = renderTaskFacts(facts, indexes, nextCaps, L)
    if (next.text.length < rendered.text.length || nextCaps.files !== caps.files) forced = true
    caps = nextCaps
    rendered = next
  }

  while (rendered.text.length > L.totalChars && indexes.length > 1) {
    const n = asks.length
    const candidates = indexes.filter((i) => i !== 0 && i !== n - 1)
    if (!candidates.length) break
    let victim = candidates[0]
    for (const i of candidates) {
      if (importanceOf(i, n, keep) < importanceOf(victim, n, keep)) victim = i
    }
    indexes = indexes.filter((i) => i !== victim)
    forced = true
    rendered = renderTaskFacts(facts, indexes, caps, L)
  }

  let hardClipped = false
  if (rendered.text.length > L.totalChars) {
    const suffix = '\n…（后面还有内容没放下）'
    const room = Math.max(0, L.totalChars)
    rendered = {
      ...rendered,
      text:
        room > suffix.length
          ? rendered.text.slice(0, room - suffix.length) + suffix
          : rendered.text.slice(0, room),
    }
    hardClipped = true
    forced = true
  }

  const notice = trimNotice(asks, indexes, rendered, { forced, hardClipped })
  return {
    text: rendered.text,
    notice,
    trim: {
      totalAsks: asks.length,
      sentAsks: indexes.length,
      clippedAsks: 0,
      headTailAsks: 0,
      omitted: rendered.omitted,
      forced,
      hardClipped,
    },
  }
}

/** 读全部的完整原文：不按 maxAsks / 明细名额压缩，只做换行折叠。 */
export function fullTaskMaterial(facts) {
  const asks = Array.isArray(facts.asks) ? facts.asks : []
  const indexes = asks.map((_, i) => i)
  return renderTaskFacts(facts, indexes, fullCaps, PROMPT_LIMITS).text
}

/** 把完整原文按行切成不超过 max 的片；超长单行切片，不整段丢弃。 */
export function splitTextForAll(text, maxChars = ALL_CHUNK_CHARS) {
  const max = Math.max(2000, Number(maxChars) || ALL_CHUNK_CHARS)
  const room = Math.max(500, max - 80)
  const chunks = []
  let current = ''
  const flush = () => {
    if (current) {
      chunks.push(current)
      current = ''
    }
  }
  for (const line of String(text ?? '').split('\n')) {
    if (line.length > room) {
      flush()
      for (let start = 0; start < line.length; start += room) {
        chunks.push((start > 0 ? '（续）' : '') + line.slice(start, start + room))
      }
      continue
    }
    if (current && current.length + line.length + 1 > max) flush()
    current = current ? `${current}\n${line}` : line
  }
  flush()
  if (!chunks.length) chunks.push('（这次对话没有可读内容）')
  return { chunks, count: chunks.length, maxChars: max }
}
