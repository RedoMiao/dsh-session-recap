// 预览用的 Markdown 渲染器：纯函数、不依赖 DOM、不加载任何外部资源。
// 所有模型输出先按文本转义，再拼装我们自己生成的标签；原始 HTML 不会进入 DOM。
// 支持：标题、段落、换行、粗体/斜体/删除线、行内代码、围栏代码块、列表（两级以上）、
// 任务列表、引用、分隔线、GFM 管道表格、http(s)/mailto 链接；图片只显示文字，不加载。

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c])
}

const isWord = (ch) => Boolean(ch) && /[\p{L}\p{N}_]/u.test(ch)

/** 只放行绝对 http(s)/mailto；其余协议、相对地址、控制字符一律当纯文本。 */
export function safeHref(value) {
  const raw = String(value ?? '').trim().replace(/^<|>$/g, '').trim()
  if (!raw) return ''
  if (/[\u0000-\u001f\u007f]/.test(raw)) return ''
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(raw)
  if (!m) return ''
  const scheme = m[1].toLowerCase()
  if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') return ''
  return raw
}

/** 解析从 '[' 开始的 [文字](地址)，返回标签、地址和结束位置；不合法返回 null。 */
function parseLinkAt(src, start) {
  if (src[start] !== '[') return null
  let i = start + 1
  let depth = 1
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) break
    }
    i += 1
  }
  if (i >= src.length || src[i] !== ']') return null
  if (src[i + 1] !== '(') return null
  const label = src.slice(start + 1, i)
  let j = i + 2
  let parens = 1
  while (j < src.length) {
    const ch = src[j]
    if (ch === '\\') {
      j += 2
      continue
    }
    if (ch === '(') parens += 1
    else if (ch === ')') {
      parens -= 1
      if (parens === 0) break
    }
    j += 1
  }
  if (j >= src.length || src[j] !== ')') return null
  return { label, url: src.slice(i + 2, j), end: j + 1 }
}

const MAX_INLINE_DEPTH = 16

function renderInline(src, depth = 0) {
  const text = String(src ?? '')
  if (!text) return ''
  if (depth > MAX_INLINE_DEPTH) return escapeHtml(text)

  let out = ''
  let plain = ''
  let i = 0
  const flush = () => {
    if (plain) {
      out += escapeHtml(plain)
      plain = ''
    }
  }

  while (i < text.length) {
    const ch = text[i]

    // 反斜杠转义：\* \| \` 等按字面显示
    if (ch === '\\' && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!>~|]/.test(text[i + 1])) {
      plain += text[i + 1]
      i += 2
      continue
    }

    // 行内代码：先吃掉，内部不再解析
    if (ch === '`') {
      let n = 1
      while (text[i + n] === '`') n += 1
      const delim = '`'.repeat(n)
      const end = text.indexOf(delim, i + n)
      if (end >= 0) {
        let code = text.slice(i + n, end)
        if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) {
          code = code.slice(1, -1)
        }
        flush()
        out += `<code>${escapeHtml(code)}</code>`
        i = end + n
        continue
      }
      plain += delim
      i += n
      continue
    }

    // 图片：只显示文字，绝不发请求
    if (ch === '!' && text[i + 1] === '[') {
      const link = parseLinkAt(text, i + 1)
      if (link) {
        flush()
        const alt = link.label.trim()
        out += escapeHtml(`图片：${alt || '无描述'}（${link.url.trim()}）`)
        i = link.end
        continue
      }
    }

    // 链接：只允许 http(s)/mailto
    if (ch === '[') {
      const link = parseLinkAt(text, i)
      if (link) {
        flush()
        const href = safeHref(link.url)
        if (href) {
          out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${renderInline(link.label, depth + 1)}</a>`
        } else {
          out += renderInline(link.label, depth + 1) + escapeHtml(`（${link.url.trim()}）`)
        }
        i = link.end
        continue
      }
    }

    // 删除线
    if (ch === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2)
      if (end > i + 2) {
        flush()
        out += `<del>${renderInline(text.slice(i + 2, end), depth + 1)}</del>`
        i = end + 2
        continue
      }
    }

    // 粗体
    if ((ch === '*' || ch === '_') && text[i + 1] === ch) {
      const end = text.indexOf(ch + ch, i + 2)
      if (end > i + 2) {
        if (ch === '_' && isWord(text[i - 1]) && isWord(text[end + 2])) {
          plain += ch + ch
          i += 2
          continue
        }
        flush()
        out += `<strong>${renderInline(text.slice(i + 2, end), depth + 1)}</strong>`
        i = end + 2
        continue
      }
    }

    // 斜体
    if (ch === '*' || ch === '_') {
      const end = text.indexOf(ch, i + 1)
      if (end > i + 1 && !/\s/.test(text[i + 1]) && !/\s/.test(text[end - 1])) {
        if (!(ch === '_' && isWord(text[i - 1]) && isWord(text[end + 1]))) {
          flush()
          out += `<em>${renderInline(text.slice(i + 1, end), depth + 1)}</em>`
          i = end + 1
          continue
        }
      }
    }

    if (ch === '\n') {
      flush()
      out += '<br>'
      i += 1
      continue
    }

    plain += ch
    i += 1
  }

  flush()
  return out
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const QUOTE = /^ {0,3}>[ \t]?(.*)$/
const LIST = /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+(.*))?$/

function indentWidth(line) {
  let n = 0
  for (const ch of String(line)) {
    if (ch === ' ') n += 1
    else if (ch === '\t') n += 4
    else break
  }
  return n
}

function listMatch(line) {
  const m = LIST.exec(String(line))
  if (!m) return null
  return {
    indent: indentWidth(m[1]),
    marker: m[2],
    ordered: /^\d/.test(m[2]),
    start: /^\d/.test(m[2]) ? Number.parseInt(m[2], 10) : 0,
    text: m[3] ?? '',
  }
}

function splitCells(line) {
  let s = String(line).trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i += 1
      continue
    }
    if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
      continue
    }
    cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

/** 分隔行 -> 每列对齐；不合法返回 null。 */
function tableAlign(line) {
  const cells = splitCells(line)
  if (!cells.length) return null
  const out = []
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    out.push(left && right ? 'center' : left ? 'left' : right ? 'right' : '')
  }
  return out
}

function tableStart(lines, i) {
  const head = lines[i]
  const delim = lines[i + 1]
  if (head === undefined || delim === undefined) return null
  if (!head.includes('|') || !delim.includes('|')) return null
  const header = splitCells(head)
  const align = tableAlign(delim)
  if (!align || align.length !== header.length) return null
  return { header, align }
}

const alignAttr = (align) => (align ? ` align="${align}"` : '')

function renderTable(info, rows) {
  const th = info.header
    .map((cell, i) => `<th${alignAttr(info.align[i])}>${renderInline(cell)}</th>`)
    .join('')
  const body = rows
    .map((row) => {
      const tds = info.header
        .map((_, i) => `<td${alignAttr(info.align[i])}>${renderInline(row[i] ?? '')}</td>`)
        .join('')
      return `<tr>${tds}</tr>`
    })
    .join('')
  return `<div class="dsh-recap-tablewrap"><table class="dsh-recap-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`
}

function renderList(lines, start, baseIndent) {
  const first = listMatch(lines[start])
  if (!first) return null
  const ordered = first.ordered
  const tag = ordered ? 'ol' : 'ul'
  const items = []
  let i = start

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) break
    const m = listMatch(line)
    if (m) {
      if (m.indent < baseIndent) break
      if (m.indent > baseIndent) {
        if (!items.length) break
        const sub = renderList(lines, i, m.indent)
        if (!sub) break
        items[items.length - 1].children.push(sub.html)
        i = sub.next
        continue
      }
      if (m.ordered !== ordered) break
      items.push({ text: m.text, extra: [], children: [] })
      i += 1
      continue
    }
    if (items.length && indentWidth(line) > baseIndent) {
      items[items.length - 1].extra.push(line.trim())
      i += 1
      continue
    }
    break
  }

  if (!items.length) return null

  const startAttr = ordered && first.start !== 1 ? ` start="${first.start}"` : ''
  const html =
    `<${tag}${startAttr}>` +
    items
      .map((item) => {
        const task = /^\[([ xX])\][ \t]+(.*)$/.exec(item.text)
        const box = task
          ? `<span class="dsh-recap-task" aria-hidden="true">${task[1].toLowerCase() === 'x' ? '☑' : '☐'}</span> `
          : ''
        const main = renderInline(task ? task[2] : item.text)
        const extra = item.extra.length ? '<br>' + item.extra.map((l) => renderInline(l)).join('<br>') : ''
        return `<li>${box}${main}${extra}${item.children.join('')}</li>`
      })
      .join('') +
    `</${tag}>`

  return { html, next: i }
}

function isBlockStart(lines, i) {
  const line = lines[i]
  if (!line.trim()) return true
  if (FENCE.test(line)) return true
  if (HEADING.test(line)) return true
  if (HR.test(line)) return true
  if (QUOTE.test(line)) return true
  if (LIST.test(line)) return true
  if (tableStart(lines, i)) return true
  return false
}

function renderBlocks(lines) {
  let out = ''
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }

    // 围栏代码块
    const fence = FENCE.exec(line)
    if (fence) {
      const mark = fence[1][0]
      const size = fence[1].length
      const info = fence[2].trim().split(/\s+/)[0] || ''
      const lang = /^[A-Za-z0-9_+.-]+$/.test(info) ? info : ''
      const body = []
      i += 1
      while (i < lines.length) {
        const close = new RegExp(`^ {0,3}${mark === '`' ? '`' : '~'}{${size},}[ \\t]*$`)
        if (close.test(lines[i])) {
          i += 1
          break
        }
        body.push(lines[i])
        i += 1
      }
      out += `<pre class="dsh-recap-pre"><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`
      continue
    }

    // 表格（必须先于分隔线判断：|---| 可能像 ---）
    const table = tableStart(lines, i)
    if (table) {
      const rows = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitCells(lines[i]))
        i += 1
      }
      out += renderTable(table, rows)
      continue
    }

    // 标题
    const heading = HEADING.exec(line)
    if (heading) {
      const level = heading[1].length
      const text = heading[2].replace(/[ \t]+#+[ \t]*$/, '').trim()
      out += `<h${level}>${renderInline(text)}</h${level}>`
      i += 1
      continue
    }

    // 分隔线
    if (HR.test(line)) {
      out += '<hr>'
      i += 1
      continue
    }

    // 引用：整段递归渲染
    if (QUOTE.test(line)) {
      const inner = []
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i])
        if (!m) break
        inner.push(m[1])
        i += 1
      }
      const body = renderBlocks(inner)
      out += `<blockquote>${body}</blockquote>`
      continue
    }

    // 列表
    if (LIST.test(line)) {
      const list = renderList(lines, i, indentWidth(/^[ \t]*/.exec(line)[0]))
      if (list) {
        out += list.html
        i = list.next
        continue
      }
    }

    // 段落：单个换行保留为 <br>
    const para = [line]
    i += 1
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) {
      para.push(lines[i])
      i += 1
    }
    out += `<p>${para.map((l) => renderInline(l)).join('<br>')}</p>`
  }

  return out
}

/**
 * 把 Markdown 渲染成安全 HTML。
 * 空串 / 纯空白返回空串；无法识别的语法按原文字显示，绝不丢内容。
 */
export function renderMarkdown(markdown) {
  const src = String(markdown ?? '').replace(/\r\n?/g, '\n')
  if (!src.trim()) return ''
  return renderBlocks(src.split('\n'))
}
