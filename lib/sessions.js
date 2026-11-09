/**
 * 会话新鲜度：只有最近 SESSION_FRESH_MS 内产生过事件的会话才算「当前」。
 * 纯函数，时间由调用方传入，测试不需要改系统时钟。
 */
export const SESSION_FRESH_MS = 120000

export function pickFreshSession(entries, now = Date.now(), ttl = SESSION_FRESH_MS) {
  let best = null
  for (const [id, at] of entries ?? []) {
    if (!id) continue
    const time = Number(at)
    if (!Number.isFinite(time)) continue
    if (now - time > ttl) continue
    if (!best || time > best.at) best = { id: String(id), at: time }
  }
  return best?.id ?? null
}
