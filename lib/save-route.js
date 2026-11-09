/**
 * /save 的决策体（纯函数）：路由只做转发，便于单测。
 * 返回 { status, body }。
 *
 * previewId 是「用户眼前这一稿」的标识，网页入口必须原样带上：
 * 缺失、空白、非字符串或对不上都返回 409 PREVIEW_STALE，绝不放行成
 * 「保存这个会话最新的一稿」。命令 /save 不经过这里，仍按原有方式保存。
 */
import { HOST_TEXT as T } from './strings.js'

const SAVING_TEXT = '这稿正在写入，请稍等一秒再试。'

export function decideSave(sessionId, pending, previewId) {
  const id = String(sessionId ?? '')
  if (!id) {
    return { status: 409, body: { ok: false, code: 'NO_PREVIEW', error: T.noPreview } }
  }
  const entry = pending.inspect?.(id) ?? (pending.peek(id) ? { previewId: '', state: 'ready' } : null)
  if (!entry) {
    return { status: 409, body: { ok: false, code: 'NO_PREVIEW', error: T.noPreview } }
  }
  // 严格：只接受非空字符串编号；老页面不传编号时不能退化成“存最新稿”
  if (typeof previewId !== 'string' || previewId.trim() === '') {
    return { status: 409, body: { ok: false, code: 'PREVIEW_STALE', error: T.previewMissing } }
  }
  if (entry.state === 'saving') {
    return { status: 409, body: { ok: false, code: 'PREVIEW_SAVING', error: SAVING_TEXT } }
  }
  if (previewId !== String(entry.previewId)) {
    return {
      status: 409,
      body: { ok: false, code: 'PREVIEW_STALE', error: T.previewStale, latestPreviewId: entry.previewId },
    }
  }
  return { status: 200, body: { ok: true, id, previewId: entry.previewId } }
}

/** 技术错误翻译成人话；typed code 优先，EISDIR 单独给一条。 */
export function humanError(error) {
  if (error?.code === 'EISDIR') {
    return { status: 409, message: '目标位置有个同名文件夹，换个名字或先把它挪走' }
  }
  if (error?.code === 'NO_PREVIEW') {
    return { status: 409, code: 'NO_PREVIEW', message: T.noPreview }
  }
  if (error?.code === 'PREVIEW_STALE') {
    return { status: 409, code: 'PREVIEW_STALE', message: T.previewStale }
  }
  if (error?.code === 'PREVIEW_SAVING') {
    return { status: 409, code: 'PREVIEW_SAVING', message: SAVING_TEXT }
  }
  if (error?.code === 'TEMPLATE_EMPTY') {
    return { status: 409, code: 'TEMPLATE_EMPTY', message: T.templateEmpty }
  }
  if (error?.code === 'NEED_SCOPE') {
    return { status: 409, code: 'NEED_SCOPE', message: T.needScope, stats: error.stats }
  }
  if (error?.code === 'NO_VAULT') {
    return { status: 409, code: 'NO_VAULT', message: T.noVaultSave }
  }
  return { status: error?.status ?? 500, message: String(error?.message ?? error) }
}
