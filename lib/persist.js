/**
 * 保存编排：取保存权 → 写盘 → 成功才清预览；失败把保存权还回去。
 * 单独成模块是为了让测试调用生产实现，而不是在测试里复制一份逻辑。
 *
 * pending 里存的是「库内相对路径」：生成时还没有库也能预览，
 * 保存时才用当次生效的库路径拼绝对路径，避免提前写死空库路径。
 */
import path from 'node:path'
import { writeNote } from './safe.js'
import { HOST_TEXT as T } from './strings.js'

export function makePersist({ pending, vaultPath, write = writeNote }) {
  const pathOf = typeof vaultPath === 'function' ? vaultPath : () => vaultPath

  return async function persist(sessionId, previewId) {
    const vault = pathOf()
    if (!vault) {
      // 不 claim：无库时原稿必须留在槽位里，选库后可原样重试。
      throw Object.assign(new Error(T.noVaultSave), { code: 'NO_VAULT', status: 409 })
    }
    const item = pending.claim(sessionId, previewId)
    const token = item?.previewId ?? previewId
    try {
      const target = path.isAbsolute(item.file) ? item.file : path.join(vault, item.file)
      const file = await write(vault, target, item.markdown)
      // 只有仍是同一稿才清空：后来替换的新稿不能被这次收尾误删
      pending.commit(sessionId, token)
      return file
    } catch (error) {
      // 写盘失败：原稿留在槽位里，前端可以直接重试，不需要重新调模型
      pending.release(sessionId, token)
      throw error
    }
  }
}
