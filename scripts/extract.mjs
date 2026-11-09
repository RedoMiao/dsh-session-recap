#!/usr/bin/env node
/**
 * 会话事实提取器（第 1 步原型：只读、不花钱、不写盘）
 *
 * 输入：一个 session.v4.jsonl.zstd 路径
 * 输出：这次会话「干了什么」的事实清单
 *
 * 用法：node scripts/extract.mjs <session.v4.jsonl.zstd>
 */
import fs from 'node:fs'
import z from 'node:zlib'
import { pathToFileURL } from 'node:url'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 会话日志是「多帧 zstd 拼接」，node 的流式解压不认，按 magic 切帧逐个解。 */
export function readEvents(file) {
  const buf = fs.readFileSync(file)
  const starts = []
  let at = 0
  while ((at = buf.indexOf(MAGIC, at)) >= 0) {
    starts.push(at)
    at += 4
  }
  starts.push(buf.length)
  const parts = []
  for (let i = 0; i < starts.length - 1; i++) {
    try {
      parts.push(z.zstdDecompressSync(buf.subarray(starts[i], starts[i + 1])))
    } catch {
      // 最后一帧可能还在写，跳过
    }
  }
  return Buffer.concat(parts)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .filter(Boolean)
}

const textOf = (blocks) =>
  (blocks ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

const esc = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()

function clip(s, n) {
  s = esc(s)
  return s.length > n ? s.slice(0, n) + '…' : s
}

/** 工具失败的正文压成一行可读信息 */
function errorLine(text) {
  const first = String(text ?? '').split('\n').find((l) => l.trim()) ?? ''
  return clip(first.replace(/^Error: code run failed \([^)]*\):\s*/, ''), 120)
}

const WRITE_OPS = new Set(['write', 'edit'])

export function extract(file) {
  const events = readEvents(file)
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
    searches: [],
    presents: [],
    errors: [],
    turnWords: [],
  }

  /** 同一条事实可能既出现在 tool/call 又出现在 ptc-dispatch，用 id 去重 */
  const seen = new Set()
  const note = (name, args, id) => {
    const key = id ? `${name}:${id}` : ''
    if (key && seen.has(key)) return false
    if (key) seen.add(key)

    if (WRITE_OPS.has(name)) {
      const p = args.file_path ?? args.path
      if (p) {
        const prev = facts.files.get(p) ?? { ops: new Set(), hits: 0 }
        prev.ops.add(name)
        prev.hits++
        facts.files.set(p, prev)
      }
      return true
    }
    if (name === 'pwsh' || name === 'terminal_open') {
      const label = args.description ?? args.command ?? ''
      if (label) facts.shells.push(clip(label, 90))
      return true
    }
    if (name === 'web_search' || name === 'web_fetch') {
      const q = Array.isArray(args.queries) ? args.queries.join(' / ') : args.url ?? ''
      if (q) facts.searches.push(clip(q, 90))
      return true
    }
    if (name === 'present') {
      facts.presents.push(clip(args.description ?? (Array.isArray(args.files) ? args.files.map((f) => f.path).join(', ') : ''), 80))
      return true
    }
    return false
  }

  for (const ev of events) {
    const d = ev.data ?? {}
    switch (ev.type) {
      case 'session':
        facts.id = ev.id
        facts.cwd = ev.cwd
        facts.startedAt = ev.createdAt
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
        break
      case 'step/start':
        facts.steps++
        break
      case 'turn/end':
        facts.endedAt = ev.time
        break
      case 'user/message': {
        const text = textOf(d.content)
        if (text && d.source?.kind === 'user') facts.asks.push({ seq: ev.seq, text })
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
        // run_code 的子调用已由 ptc-dispatch 覆盖，这里只处理顶层工具
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
      case 'tool/result':
        break
      default:
        break
    }
  }
  return facts
}

const fmtTime = (ms) => new Date(ms).toLocaleString('zh-CN', { hour12: false })

export function render(facts) {
  const out = []
  const span =
    facts.startedAt && facts.endedAt
      ? `${fmtTime(facts.startedAt)} → ${fmtTime(facts.endedAt)}（跨 ${Math.round((facts.endedAt - facts.startedAt) / 60000)} 分钟）`
      : '未知'
  const files = [...facts.files.entries()]
  const totalFileHits = files.reduce((n, [, v]) => n + v.hits, 0)

  out.push(`会话：${facts.title || '(无标题)'}`)
  out.push(`工作区：${facts.cwd}`)
  out.push(`时间：${span}`)
  out.push(`规模：${facts.turns} 轮 / ${facts.steps} 步 · 模型 ${facts.model}`)
  out.push('')

  out.push(`① 用户诉求（${facts.asks.length} 条）：`)
  facts.asks.slice(0, 12).forEach((a, i) => out.push(`  ${i + 1}. ${clip(a.text, 110)}`))
  if (facts.asks.length > 12) out.push(`  …还有 ${facts.asks.length - 12} 条`)
  out.push('')

  out.push(`② 改动过的文件（${files.length} 个，共 ${totalFileHits} 次写入）：`)
  files
    .sort((a, b) => b[1].hits - a[1].hits)
    .slice(0, 18)
    .forEach(([p, v]) => out.push(`  - ${p}  [${[...v.ops].join('+')} ×${v.hits}]`))
  if (files.length > 18) out.push(`  …还有 ${files.length - 18} 个`)
  out.push('')

  out.push(`③ 跑过的命令（${facts.shells.length} 条，前 8 条）：`)
  facts.shells.slice(0, 8).forEach((s) => out.push(`  - ${s}`))
  out.push('')

  out.push(`④ 查过的东西（${facts.searches.length} 次）：`)
  facts.searches.slice(0, 5).forEach((s) => out.push(`  - ${s}`))
  out.push('')

  out.push(`⑤ 踩的错（${facts.errors.length} 次工具失败，前 6 条）：`)
  facts.errors.slice(0, 6).forEach((e) => out.push(`  - [${e.name}] ${e.text}`))
  out.push('')

  if (facts.presents.length) {
    out.push(`⑥ 交付物（${facts.presents.length} 个）：`)
    facts.presents.slice(0, 6).forEach((p) => out.push(`  - ${p}`))
    out.push('')
  }

  const last = facts.turnWords.at(-1)
  out.push(`⑦ 收尾说法：${last ? clip(last.text, 250) : '(无)'}`)
  return out.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2]
  if (!file) {
    console.error('用法: node scripts/extract.mjs <session.v4.jsonl.zstd>')
    process.exit(1)
  }
  console.log(render(extract(file)))
}
