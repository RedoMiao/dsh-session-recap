// 落盘并发安全：同名并发不覆盖、内容各自正确、原文件不变、失败不留半成品
import assert from 'node:assert'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeNote, atomicWrite } from '../lib/safe.js'

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'recap-safe-'))
const listFiles = (dir) => {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(path.join(entry.parentPath ?? dir, entry.name))
  }
  return out
}

// —— 1) 并发保存同名不同正文：10 次结果稳定，全部完整 ——
for (let round = 1; round <= 10; round++) {
  const dir = path.join(root, `round-${round}`)
  const file = path.join(dir, '项目 · 总结.md')
  await fsp.mkdir(dir, { recursive: true })
  fs.writeFileSync(file, 'ORIGINAL')

  const bodies = Array.from({ length: 3 }, (_, i) => `round-${round}-body-${i}`)
  const results = await Promise.all(bodies.map((body) => writeNote(root, file, body)))

  assert.equal(fs.readFileSync(file, 'utf8'), 'ORIGINAL', `第 ${round} 轮原文件被覆盖`)
  const paths = results.map((p) => path.resolve(p))
  assert.equal(new Set(paths).size, 3, `第 ${round} 轮出现重复文件名`)
  const contents = results.map((p) => fs.readFileSync(p, 'utf8')).sort()
  assert.deepEqual(contents, [...bodies].sort(), `第 ${round} 轮正文串了`)
  const leftovers = listFiles(dir).filter((p) => p.endsWith('.tmp'))
  assert.equal(leftovers.length, 0, `第 ${round} 轮留下临时文件`)
}
console.log('· 并发同名 10 轮：原文件不变、3 份各自正确、无临时残留')

// —— 2) 同名目录占位：明确报 EISDIR，且不留下半成品 ——
{
  const dir = path.join(root, 'eisdir')
  const file = path.join(dir, '同名.md')
  await fsp.mkdir(file, { recursive: true })
  await assert.rejects(() => writeNote(root, file, 'x'), (error) => error.code === 'EISDIR')
  const leftovers = listFiles(dir).filter((p) => p.endsWith('.tmp'))
  assert.equal(leftovers.length, 0, 'EISDIR 失败后留下了临时文件')
  await fsp.rm(file, { recursive: true, force: true })
  const written = await writeNote(root, file, '恢复后重试')
  assert.equal(fs.readFileSync(written, 'utf8'), '恢复后重试', '障碍移除后应能直接重试')
  console.log('· 同名目录 → EISDIR，无残留；移除后重试成功')
}

// —— 3) 原子写同一目标：第二个必须让位，不覆盖 ——
{
  const file = path.join(root, 'atomic', 'a.md')
  await atomicWrite(file, 'one')
  await assert.rejects(() => atomicWrite(file, 'two'), (error) => error.code === 'EEXIST')
  assert.equal(fs.readFileSync(file, 'utf8'), 'one')
  console.log('· atomicWrite 目标已存在 → EEXIST，不覆盖')
}

await fsp.rm(root, { recursive: true, force: true })
console.log('safe ok')
