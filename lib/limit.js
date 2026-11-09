/** 限流器：纯函数，便于单测。返回 true 表示这次请求应当被拒绝。 */
export function makeRateLimiter(windowMs) {
  let last = -Infinity
  return {
    shouldReject(now) {
      if (now - last < windowMs) return true
      last = now
      return false
    },
    reset() {
      last = -Infinity
    },
  }
}

/** 带错误码的预览异常：路由按 code 翻成人话，不靠字符串猜。 */
export function previewError(code, message = '') {
  return Object.assign(new Error(message || code), { code })
}

/**
 * 预览暂存：每个会话一个槽位，槽位里带独立 previewId 和保存状态。
 *
 * - 同一会话重新总结会替换槽位，旧页面手里的 previewId 随之失效（不能悄悄换稿）。
 * - claim → 写盘 → commit：写盘失败调用 release，原稿留在槽位里可重试。
 * - commit 之后槽位清空，重复保存会得到「没有预览」，不会写第二份。
 */
export function makePending() {
  const map = new Map()
  const keyOf = (key) => String(key)

  const entryOf = (key) => map.get(keyOf(key))

  return {
    /** 放入一稿；返回这一稿的 previewId。 */
    put(key, value, previewId) {
      const id = String(previewId ?? value?.previewId ?? '')
      map.set(keyOf(key), { previewId: id, value, state: 'ready' })
      return id
    },

    /** 只读当前稿（不改变保存状态）。 */
    peek(key) {
      return entryOf(key)?.value
    },

    /** 只读元信息：previewId 与 ready / saving。 */
    inspect(key) {
      const entry = entryOf(key)
      return entry ? { previewId: entry.previewId, state: entry.state } : null
    },

    /**
     * 取走保存权：previewId 必须与槽位一致，且当前没有另一笔保存在进行。
     * 返回这一稿的 value；失败抛出带 code 的异常。
     */
    claim(key, previewId) {
      const entry = entryOf(key)
      if (!entry) throw previewError('NO_PREVIEW')
      if (previewId != null && String(previewId) !== entry.previewId) {
        throw previewError('PREVIEW_STALE')
      }
      if (entry.state === 'saving') throw previewError('PREVIEW_SAVING')
      entry.state = 'saving'
      return entry.value
    },

    /** 写盘失败：把保存权还回去，原稿保留，可直接重试。 */
    release(key, previewId) {
      const entry = entryOf(key)
      if (!entry || entry.state !== 'saving') return false
      if (previewId != null && String(previewId) !== entry.previewId) return false
      entry.state = 'ready'
      return true
    },

    /** 写盘成功：只有仍是同一稿时才清空，避免误删后来替换的新稿。 */
    commit(key, previewId) {
      const entry = entryOf(key)
      if (!entry) return false
      if (previewId != null && String(previewId) !== entry.previewId) return false
      return map.delete(keyOf(key))
    },

    /** 兼容旧调用：取出并清空。保存链路不再使用它（会丢稿）。 */
    take(key) {
      const entry = entryOf(key)
      if (entry) map.delete(keyOf(key))
      return entry?.value
    },

    size() {
      return map.size
    },
  }
}
