/** 路径安全与写入安全：所有落盘都必须经过这里。 */
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

/** 把任意名字变成安全文件名（不含扩展名）。 */
export function safeName(input, fallback = '未命名') {
  let s = String(input ?? '')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  if (!s || s === '.' || s === '..') s = fallback
  if (RESERVED.has(s.toLowerCase())) s = `${s}_`
  // 单段长度上限，给目录和扩展名留余量
  if (s.length > 60) s = s.slice(0, 60).trim()
  return s || fallback
}

/** target 必须落在 root 之内；否则抛错。 */
export function assertInside(root, target) {
  const r = path.resolve(root)
  const t = path.resolve(target)
  const rel = path.relative(r, t)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('目标路径不在库目录内')
  }
  return t
}

/** 同名则递增 (2)(3)…，永不覆盖。仅用于只读探测；真正落盘靠 writeNote 的独占创建。 */
export function uniquePath(file) {
  if (!fs.existsSync(file)) return file
  if (fs.statSync(file).isDirectory()) {
    throw Object.assign(new Error('同名目录已存在，无法写入同名文件'), { code: 'EISDIR' })
  }
  const dir = path.dirname(file)
  const ext = path.extname(file)
  const base = path.basename(file, ext)
  for (let i = 2; i < 1000; i++) {
    const next = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(next)) return next
  }
  throw new Error('同名文件太多，无法生成新文件名')
}

/** 临时文件名带进程号 + 随机串：并发时不会互相覆盖。 */
function tempPathFor(file) {
  return path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`)
}

/** 把正文完整写进临时文件并落盘；返回临时文件路径。 */
async function writeTemp(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = tempPathFor(file)
  const handle = await fsp.open(tmp, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  await handle.close()
  return tmp
}

/**
 * 把已经写好的临时文件发布到目标名，绝不覆盖已有文件。
 * link 是同一目录内的原子操作，目标存在时返回 EEXIST；
 * 少数文件系统不支持硬链接时退到 COPYFILE_EXCL（同样不覆盖）。
 */
async function publish(tmp, file) {
  try {
    await fsp.link(tmp, file)
    return
  } catch (error) {
    const unsupported = ['EPERM', 'ENOSYS', 'EOPNOTSUPP', 'EXDEV', 'EINVAL']
    if (!unsupported.includes(error?.code)) throw error
  }
  await fsp.copyFile(tmp, file, fs.constants.COPYFILE_EXCL)
}

/** 独占写一个文件：成功返回路径；目标已存在则抛 EEXIST；失败不留半成品。 */
export async function atomicWrite(file, content) {
  const tmp = await writeTemp(file, content)
  try {
    await publish(tmp, file)
    return file
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {})
  }
}

/**
 * 安全落盘：唯一名字 + 独占创建 + 原子发布。返回最终路径。
 * 先写临时文件，再在目标目录里原子占位；已有文件（含并发刚创建的同名文件）绝不覆盖。
 */
export async function writeNote(vaultPath, file, content) {
  const inside = assertInside(vaultPath, file)
  if (!inside) throw new Error('目标路径不在库目录内')
  const dir = path.dirname(inside)
  const ext = path.extname(inside)
  const base = path.basename(inside, ext)

  await fsp.mkdir(dir, { recursive: true })
  const tmp = await writeTemp(inside, content)
  try {
    for (let i = 1; i < 1000; i++) {
      const candidate = i === 1 ? inside : path.join(dir, `${base} (${i})${ext}`)
      let st = null
      try {
        st = await fsp.lstat(candidate)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (st?.isDirectory()) {
        if (i === 1) {
          throw Object.assign(new Error('同名目录已存在，无法写入同名文件'), { code: 'EISDIR' })
        }
        continue
      }
      try {
        await publish(tmp, candidate)
        return candidate
      } catch (error) {
        if (error?.code === 'EEXIST') continue
        throw error
      }
    }
    throw new Error('同名文件太多，无法生成新文件名')
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {})
  }
}

/** 目录可用性检查：返回 { ok, reason }。 */
export async function checkDir(dir, { needObsidian = false } = {}) {
  try {
    const st = await fsp.stat(dir)
    if (!st.isDirectory()) return { ok: false, reason: '不是文件夹' }
    await fsp.access(dir, fs.constants.W_OK)
    if (needObsidian && !fs.existsSync(path.join(dir, '.obsidian'))) {
      return { ok: false, reason: '目录里没有 .obsidian，不像是 Obsidian 库' }
    }
    return { ok: true }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, reason: '目录不存在' }
    if (error?.code === 'EACCES') return { ok: false, reason: '没有写入权限' }
    return { ok: false, reason: String(error?.message ?? error) }
  }
}
