// 保存编排：失败保留原稿可重试、成功只写一次、并发与旧稿被拒
import assert from 'node:assert'
import path from 'node:path'
import { makePending } from '../lib/limit.js'
import { makePersist } from '../lib/persist.js'

// —— 1) 写盘失败 → 预览还在 → 恢复后不重新生成即可成功 ——
{
  const pending = makePending()
  pending.put('S', { previewId: 'p1', file: 'x.md', markdown: '正文-1' })
  let fail = true
  let writes = 0
  const persist = makePersist({
    pending,
    vaultPath: () => 'V:/vault',
    write: async (_vault, file, content) => {
      writes++
      if (fail) throw Object.assign(new Error('没有写入权限'), { code: 'EACCES' })
      return file
    },
  })

  await assert.rejects(() => persist('S', 'p1'), (error) => error.code === 'EACCES')
  assert.ok(pending.peek('S'), '写盘失败后原稿必须还在')
  assert.equal(pending.inspect('S').state, 'ready', '失败后应可再次保存')
  assert.equal(writes, 1)

  fail = false
  const file = await persist('S', 'p1')
  assert.equal(file, path.join('V:/vault', 'x.md'))
  assert.equal(writes, 2, '重试应只再写一次')
  assert.equal(pending.peek('S'), undefined, '成功后预览应清空')

  await assert.rejects(() => persist('S', 'p1'), (error) => error.code === 'NO_PREVIEW')
  console.log('· 失败保留原稿 → 重试成功 → 不能重复写')
}

// —— 2) 同一稿并发保存：第二笔明确拒绝，不会写两份 ——
{
  const pending = makePending()
  pending.put('S', { previewId: 'p1', file: 'x.md', markdown: '正文' })
  let release
  const gate = new Promise((r) => (release = r))
  const persist = makePersist({
    pending,
    vaultPath: () => 'V:/vault',
    write: async (_vault, file) => {
      await gate
      return file
    },
  })

  const first = persist('S', 'p1')
  await assert.rejects(() => persist('S', 'p1'), (error) => error.code === 'PREVIEW_SAVING')
  release()
  assert.equal(await first, path.join('V:/vault', 'x.md'))
  await assert.rejects(() => persist('S', 'p1'), (error) => error.code === 'NO_PREVIEW')
  console.log('· 并发保存 → 第二笔 PREVIEW_SAVING，成功一次后就没了')
}

// —— 无库：不取保存权、不清原稿；选库后同一稿仍能保存 ——
{
  const pending = makePending()
  pending.put('S', { previewId: 'p1', file: '项目/笔记.md', markdown: '正文' })
  const persist = makePersist({
    pending,
    vaultPath: () => '',
    write: async () => {
      throw new Error('无库不应写盘')
    },
  })
  await assert.rejects(() => persist('S', 'p1'), (error) => error.code === 'NO_VAULT')
  assert.equal(pending.peek('S')?.previewId, 'p1', '无库失败后原稿必须还在')
  assert.equal(pending.inspect('S').state, 'ready', '无库失败后仍应是可保存状态')
  console.log('· 无库保存 → NO_VAULT，原稿与保存权都保留')
}

// —— 3) 旧页面拿被替换的稿 → PREVIEW_STALE，新稿不受影响 ——
{
  const pending = makePending()
  pending.put('S', { previewId: 'new', file: 'new.md', markdown: '新稿' })
  let wrote = false
  const persist = makePersist({
    pending,
    vaultPath: () => 'V:/vault',
    write: async () => {
      wrote = true
      return 'x.md'
    },
  })
  await assert.rejects(() => persist('S', 'old'), (error) => error.code === 'PREVIEW_STALE')
  assert.equal(wrote, false, '旧稿不该写盘')
  assert.equal(pending.peek('S').previewId, 'new', '新稿不能被旧页面影响')
  console.log('· 旧 previewId → PREVIEW_STALE，不写盘、不动新稿')
}

console.log('persist ok')
