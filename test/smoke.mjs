// 冒烟测试：装之前跑一遍，任何一条挂了就不装。
// 断言必须打在生产导出函数上，不是测试里复制的一份逻辑。
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { factsFromEvents, factsToPrompt } from '../lib/facts.js'
import { safeName, assertInside, uniquePath, writeNote, checkDir } from '../lib/safe.js'
import plugin, { inject, name } from '../lib/index.js'

// ——— 事实提取 ———
const events = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'user/message', data: { content: [{ type: 'text', text: '做个插件' }], source: { kind: 'user' } } },
  { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '好' }] } } },
  {
    type: 'tool/ptc-dispatch',
    data: { name: 'write', arguments: { file_path: 'D:/a/b.js' }, subCallId: 'x1', isError: false, content: [] },
  },
  { type: 'turn/end', data: { turn: 1 } },
]
const facts = factsFromEvents(events)
assert.equal(facts.asks.length, 1, '用户诉求没抓到')
assert.equal(facts.turns, 1, '轮次没抓到')
assert.ok(facts.files.has('D:/a/b.js'), '写过的文件没抓到')
assert.ok(factsToPrompt(facts).includes('做个插件'), '提示词没带诉求')

// ——— 路径安全 ———
assert.equal(safeName('a/b\\c:d'), 'a b c d', '非法字符没清掉')
assert.equal(safeName('..'), '未命名', '.. 没挡住')
assert.equal(safeName('CON'), 'CON_', 'Windows 保留名没挡住')
assert.equal(safeName('   '), '未命名', '空名没兜底')
assert.ok(safeName('长'.repeat(200)).length <= 60, '名字没限长')

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-'))
assert.throws(() => assertInside(vault, path.join(vault, '..', 'evil.md')), '越过库目录没被拒绝')
assert.doesNotThrow(() => assertInside(vault, path.join(vault, 'a', 'b.md')))

// ——— 不覆盖已有文件 ———
const first = path.join(vault, 'note.md')
fs.writeFileSync(first, 'old')
const second = uniquePath(first)
assert.notEqual(second, first, '同名文件没有让位')
assert.ok(second.includes('(2)'), '同名编号不对')

// ——— 原子写 + 唯一名 ———
const target = path.join(vault, 'x', 'y.md')
await writeNote(vault, target, 'hello')
assert.equal(fs.readFileSync(target, 'utf8'), 'hello')
await writeNote(vault, target, 'second')
const files = fs.readdirSync(path.join(vault, 'x'))
assert.equal(files.length, 2, '第二次写入应该另存一份')
assert.ok(!files.some((f) => f.endsWith('.tmp')), '留下了临时文件')

// ——— 目录校验 ———
assert.equal((await checkDir(vault)).ok, true)
assert.equal((await checkDir(path.join(vault, 'nope'))).ok, false)

// ——— 插件导出 ———
assert.equal(typeof plugin, 'function', 'apply 不是函数')
assert.ok(inject.includes('llm') && inject.includes('sessionQuery'), 'inject 缺依赖')
assert.equal(name, 'session-recap', '插件名不对')

fs.rmSync(vault, { recursive: true, force: true })
console.log('smoke ok')
