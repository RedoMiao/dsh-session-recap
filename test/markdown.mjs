// 0.2.7 预览渲染器单测：纯函数、无 DOM、无外部依赖。
import assert from 'node:assert'
import { renderMarkdown, safeHref } from '../lib/markdown.js'

const count = (html, re) => (html.match(re) || []).length

// 1. 标准 GFM 表格：表头 + 分隔行 + 6 行数据；对齐属性
{
  const header = '| 事情 | 谁在做 | 现在卡在哪 | 原话依据（一句） |'
  const delim = '| :--- | :---: | ---: | --- |'
  const rows = Array.from(
    { length: 6 },
    (_, i) => `| 事项${i + 1} | 小指挥 | 等复核${i + 1} | 「原话${i + 1}」 |`,
  )
  const html = renderMarkdown([header, delim, ...rows].join('\n'))
  assert.equal(count(html, /<table\b/g), 1, '应生成 1 个 table')
  assert.equal(count(html, /<thead>/g), 1, '应有 thead')
  assert.equal(count(html, /<tbody>/g), 1, '应有 tbody')
  assert.equal(count(html, /<tr>/g), 7, '表头 1 行 + 6 行数据')
  assert.equal(count(html, /<th\b/g), 4, '4 个表头单元格')
  assert.equal(count(html, /<td\b/g), 24, '6 行 × 4 列')
  assert.ok(html.includes('<th align="left">事情</th>'), '第一列左对齐')
  assert.ok(html.includes('<th align="center">谁在做</th>'), '第二列居中')
  assert.ok(html.includes('<th align="right">现在卡在哪</th>'), '第三列右对齐')
  assert.ok(html.includes('<th>原话依据（一句）</th>'), '未指定对齐的列不留 align')
  assert.ok(html.includes('class="dsh-recap-tablewrap"'), '表格有自身横向滚动容器')
  assert.ok(html.includes('原话6'), '最后一行内容完整')
  console.log('· 表格：1 table / thead / 6×4 td / 对齐 left-center-right')
}

// 2. 没有分隔行的伪表格：不生成 table，内容按文字保留
{
  const html = renderMarkdown('| 事情 | 谁在做 |\n| A | B |')
  assert.equal(count(html, /<table\b/g), 0, '伪表格不应变成 table')
  assert.ok(html.includes('| 事情 | 谁在做 |'), '原竖线与文字保留')
  assert.ok(html.includes('| A | B |'), '第二行也保留')
  console.log('· 伪表格：不生成 table，竖线原样保留')
}

// 3. 标题 / 列表 / 引用 / 代码块 / 行内代码 / 粗体 / 链接 / 分隔线
{
  const html = renderMarkdown(
    [
      '# 一级',
      '## 二级',
      '### 三级',
      '',
      '- 一',
      '- 二',
      '',
      '1. 甲',
      '2. 乙',
      '',
      '> 引用一行',
      '',
      '```js',
      'const a = 1 < 2',
      '```',
      '',
      '正文 `code` 和 **粗体** 与 *斜体*、~~删除~~。',
      '',
      '[链接](https://example.com/a?b=1&c=2)',
      '',
      '---',
    ].join('\n'),
  )
  assert.ok(html.includes('<h1>一级</h1>'), 'h1')
  assert.ok(html.includes('<h2>二级</h2>'), 'h2')
  assert.ok(html.includes('<h3>三级</h3>'), 'h3')
  assert.ok(html.includes('<ul><li>一</li><li>二</li></ul>'), '无序列表')
  assert.ok(html.includes('<ol><li>甲</li><li>乙</li></ol>'), '有序列表')
  assert.ok(html.includes('<blockquote><p>引用一行</p></blockquote>'), '引用')
  assert.ok(html.includes('<pre class="dsh-recap-pre"><code class="language-js">'), '围栏代码块')
  assert.ok(html.includes('const a = 1 &lt; 2'), '代码块内容已转义')
  assert.ok(html.includes('<code>code</code>'), '行内代码')
  assert.ok(html.includes('<strong>粗体</strong>'), '粗体')
  assert.ok(html.includes('<em>斜体</em>'), '斜体')
  assert.ok(html.includes('<del>删除</del>'), '删除线')
  assert.ok(
    html.includes(
      '<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">链接</a>',
    ),
    '链接 href 转义且带 target/rel',
  )
  assert.ok(html.includes('<hr>'), '分隔线')
  console.log('· 标题/列表/引用/代码块/行内样式/链接/分隔线')
}

// 4. 原始 HTML 与事件属性：全部当文字，不能出现可执行标签
{
  const html = renderMarkdown(
    '<script>window.__xss=1</script>\n\n<img src=x onerror="window.__xss=2">\n\n<div onclick="x()">块</div>',
  )
  assert.ok(!/<script\b/i.test(html), '不得输出 script 标签')
  assert.ok(!/<img\b/i.test(html), '不得输出 img 标签')
  assert.ok(!/<div\b/i.test(html), '不得输出原始 div 标签')
  assert.ok(html.includes('&lt;script&gt;window.__xss=1&lt;/script&gt;'), 'script 原文以文字显示')
  assert.ok(html.includes('&lt;img src=x onerror=&quot;window.__xss=2&quot;&gt;'), 'img 原文以文字显示')
  assert.ok(!/onerror\s*=\s*"/i.test(html), '不得出现事件属性')
  console.log('· XSS：script/img/div 全部转义为文字')
}

// 5. 链接协议：只放行 http(s)/mailto
{
  const bad = renderMarkdown('[危险](javascript:alert(1))')
  assert.ok(!bad.includes('href='), 'javascript: 不得进入 href')
  assert.ok(!/<a\b/i.test(bad), '危险链接不生成 a 标签')
  assert.ok(bad.includes('危险（javascript:alert(1)）'), '地址仍以文字保留')
  assert.equal(safeHref('JavaScript:alert(1)'), '', '大小写混写也拒绝')
  assert.equal(safeHref('java\nscript:alert(1)'), '', '控制字符拒绝')
  assert.equal(safeHref('/relative/path'), '', '相对地址拒绝')
  assert.equal(safeHref('mailto:a@b.com'), 'mailto:a@b.com', 'mailto 放行')
  assert.equal(safeHref('https://example.com/x'), 'https://example.com/x', 'https 放行')

  const inject = renderMarkdown('[x](https://a.com/" onmouseover="alert(1))')
  assert.ok(!/ onmouseover="/.test(inject), '地址里的引号必须转义')
  console.log('· 链接：javascript/换行/相对地址拒绝，mailto/https 放行，引号转义')
}

// 6. 图片：不加载远程图片，只显示文字
{
  const html = renderMarkdown('![alt](https://example.com/a.png)')
  assert.ok(!/<img\b/i.test(html), '图片不得生成 img')
  assert.ok(html.includes('图片：alt（https://example.com/a.png）'), '保留 alt 与地址')
  const noAlt = renderMarkdown('![](https://example.com/b.png)')
  assert.ok(noAlt.includes('图片：无描述（https://example.com/b.png）'), '空 alt 有占位')
  console.log('· 图片：无 img 请求，显示 alt + 地址')
}

// 7. 空串、纯空白、超长单行
{
  assert.equal(renderMarkdown(''), '', '空串返回空串')
  assert.equal(renderMarkdown('   \n\t\n  '), '', '纯空白返回空串')
  const long = 'x'.repeat(10000)
  const html = renderMarkdown(long)
  assert.ok(html.startsWith('<p>'), '长行包在段落里')
  assert.ok(html.includes(long), '10k 长行内容不丢')
  console.log('· 空串/空白/10k 长行：不抛错、不丢内容')
}

// 8. 两级以上嵌套列表与任务列表
{
  const html = renderMarkdown('- 一级\n  - 二级\n    - 三级\n\n- [ ] 未做\n- [x] 已做')
  // 三级嵌套 3 个 ul，另起一段的任务列表再加 1 个
  assert.equal(count(html, /<ul>/g), 4, '三级嵌套 3 个 ul + 任务列表 1 个')
  assert.ok(html.includes('<li>一级<ul><li>二级<ul><li>三级</li></ul></li></ul></li>'), '嵌套结构正确')
  assert.ok(html.includes('☐'), '未完成任务有区分显示')
  assert.ok(html.includes('☑'), '已完成任务有区分显示')
  assert.ok(html.includes('aria-hidden="true"'), '任务框对读屏隐藏')
  console.log('· 列表：三级嵌套 + ☐/☑ 任务框')
}

// 9. 表格单元格里的 XSS 与行内 Markdown
{
  const html = renderMarkdown(
    '| 名称 | 说明 |\n| --- | --- |\n| **粗** | <script>alert(1)</script> |',
  )
  assert.ok(html.includes('<strong>粗</strong>'), '单元格内行内 Markdown 生效')
  assert.ok(!/<script\b/i.test(html), '单元格里的 script 也被转义')
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), '单元格转义文本保留')
  console.log('· 表格单元格：行内样式生效，脚本被转义')
}

// 10. 有序列表起始号与未知语法保留
{
  const ordered = renderMarkdown('3. 三\n4. 四')
  assert.ok(ordered.includes('<ol start="3">'), '有序列表保留起始号')
  const unknown = renderMarkdown('::: 未知块 :::\n[Cmd]+[K]')
  assert.ok(unknown.includes('::: 未知块 :::'), '未知块原文保留')
  assert.ok(unknown.includes('[Cmd]+[K]'), '方括号文字保留')
  console.log('· 有序起始号 / 未知语法原样保留')
}

console.log('markdown ok')
