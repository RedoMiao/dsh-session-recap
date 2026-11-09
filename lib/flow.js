import { UI_TEXT as T } from './strings.js'

/**
 * 确认条与预览归属的状态机，以及保存按钮的无 DOM 分支。
 * ui.js 只负责把返回值渲染出来。
 */
export function createFlow() {
  let state = { phase: 'idle', picked: null, preview: null, degraded: false }

  return {
    state: () => ({ ...state }),

    pick(id) {
      state = { ...state, picked: id, phase: 'confirming' }
    },

    degrade() {
      state = { ...state, degraded: true, phase: 'confirming' }
    },

    confirm() {
      state = { ...state, phase: 'summarizing' }
    },

    summaryDone(previewId) {
      // 降级路径下没有选中项，模型返回的会话就是这次预览的归属
      state = { ...state, preview: previewId, picked: state.picked ?? previewId, phase: 'preview-ready' }
    },

    saved() {
      state = { ...state, preview: null, phase: 'idle' }
    },

    canSave() {
      return state.preview !== null && state.picked === state.preview
    },

    hint() {
      if (state.preview === null) return ''
      if (state.picked === state.preview) return ''
      return `这条预览属于「${state.preview}」，要保存请先切回`
    },
  }
}

/**
 * 会话选择的生产决策：列表失败→重试，空列表→说明+重试，
 * 没有活跃会话→必须手动选，绝不按「只有一条」或「最近活跃」自动定。
 * 返回的 selected 只有在列表确有这条会话时才是字符串。
 */
export function sessionChoice(list, selectedId) {
  if (!list || list.ok === false) {
    return { mode: 'retry', selected: null, item: null, items: [], reason: String(list?.error ?? '') }
  }
  const items = Array.isArray(list.items)
    ? list.items.filter((it) => it && typeof it.sessionId === 'string' && it.sessionId)
    : []
  if (!items.length) return { mode: 'empty', selected: null, item: null, items }

  const wanted = typeof selectedId === 'string' && selectedId ? selectedId : String(list.current ?? '')
  const item = wanted ? items.find((it) => it.sessionId === wanted) ?? null : null
  if (!item) {
    return {
      mode: 'pick',
      selected: null,
      item: null,
      items,
      staleSelection: selectedId ? String(selectedId) : '',
    }
  }
  return { mode: 'confirm', selected: item.sessionId, item, items }
}

/**
 * 拉会话列表的生产读取：网络/解析失败只返回 ok:false，不抛到界面。
 * 界面上的「重试」就是再调用一次这个函数；测试用同一个入口模拟失败后恢复。
 */
export async function readSessions(get, onError) {
  try {
    return await get('/dsh-recap/sessions')
  } catch (error) {
    try {
      onError?.(error)
    } catch {
      /* 日志失败不影响主流程 */
    }
    return { ok: false, error: String(error?.message ?? error).slice(0, 200) }
  }
}

/** 页面注入的构建标识与服务端是否一致；任一缺失时不报警（宁可不动） */
export function needsReload(injected, served) {
  if (!injected || !served) return false
  return String(injected) !== String(served)
}

/** 该不该显示"插件已更新"提示；返回 '' 或 { text }。渲染交给 UI，逻辑留在这里测。 */
export function bannerFor(injected, served) {
  if (!injected || !served) return ''
  if (String(injected) === String(served)) return ''
  return { text: `插件已更新，请刷新页面（页面 ${injected} → 服务端 ${served}）` }
}

/**
 * 气泡几何：给定面板尺寸、猫的位置和视口，算出面板放哪、限高多少、尖角朝哪。
 * dir='down' 表示面板在猫上方、尖角朝下；'up' 表示面板在猫下方、尖角朝上。
 */
export function anchorFor(panelSize, btnRect, viewport, opts = {}) {
  const gap = opts.gap ?? 20
  const margin = opts.margin ?? 12
  const minHeight = opts.minHeight ?? 220
  const maxRatio = opts.maxRatio ?? 0.7

  const pw = Math.max(0, panelSize.width)
  const vw = Math.max(0, viewport.width)
  const vh = Math.max(0, viewport.height)

  const spaceAbove = btnRect.top - gap - margin
  const spaceBelow = vh - (btnRect.top + btnRect.height) - gap - margin
  // 上方够用优先放上方；下方太窄就强制放上方
  const preferDown = spaceAbove >= spaceBelow || spaceBelow < 280
  const room = preferDown ? spaceAbove : spaceBelow
  const maxHeight = Math.max(minHeight, Math.min(room, Math.round(vh * maxRatio)))
  const height = Math.min(panelSize.height || 0, maxHeight)

  let left = btnRect.left + btnRect.width / 2 - pw + 46
  left = Math.max(margin, Math.min(vw - pw - margin, left))

  let top = preferDown ? btnRect.top - height - gap : btnRect.top + btnRect.height + gap
  top = Math.max(margin, Math.min(vh - height - margin, top))

  // 夹回后按"面板中心在猫上方还是下方"决定尖角朝向，贴最近的那条边
  const catCenter = btnRect.top + btnRect.height / 2
  const dir = top + height / 2 <= catCenter ? 'down' : 'up'

  return { left, top, dir, maxHeight, width: pw, height }
}

/**
 * 选库状态：候选与手填互斥，永远只有一个"当前选择"。
 * 点候选 → 选中并清掉手填；在输入框打字 → 清掉候选选中。
 */
export function createVaultPick() {
  let state = { selected: null, manual: '', receipt: '', error: '' }

  return {
    state: () => ({ ...state }),

    /** 选定某个候选库 */
    select(candidate) {
      state = { selected: candidate, manual: '', receipt: '', error: '' }
    },

    /** 手填路径：清掉候选选中，避免"选了 A 却校验 c" */
    typed(value) {
      const v = String(value ?? '').trim()
      state = { selected: null, manual: v, receipt: '', error: '' }
    },

    /** 当前真正会被确认的对象（候选优先，其次手填） */
    current() {
      if (state.selected) return state.selected
      if (!state.manual) return null
      return { path: state.manual, name: state.manual.split(/[\\/]/).filter(Boolean).pop() || state.manual }
    },

    canConfirm() {
      return this.current() !== null
    },

    /** 成功后保留选中（让用户看到"现在用的是这个"），只写回执 */
    confirm(name) {
      state = { ...state, receipt: `已设置为：${name}`, error: '' }
    },

    /** 显式"默认选中第一条"，只在拉完列表时调；无选中且无手填才动，不抹回执 */
    ensureSelected(list) {
      if (state.selected || state.manual) return
      if (!Array.isArray(list) || !list.length) return
      state = { ...state, selected: list[0], error: '' }
    },

    fail(reason) {
      state = { ...state, receipt: '', error: String(reason || '校验失败') }
    },
  }
}

/** 小猫状态机：idle / click / drag / sleep。纯函数，时间由调用方传 now。 */
export const CLICK_MS = 1300
export const SLEEP_MS = 60000

export function catState(prev, event, now = 0) {
  const base = { state: prev?.state ?? 'idle', until: prev?.until ?? 0, lastActivity: prev?.lastActivity ?? now, paused: prev?.paused ?? false }
  const type = event?.type

  if (type === 'press') return { ...base, lastActivity: now } // 只记起点，不换状态
  if (type === 'click') return { ...base, state: 'click', until: now + CLICK_MS, lastActivity: now }
  if (type === 'dragstart') return { ...base, state: 'drag', until: 0, lastActivity: now }
  if (type === 'dragend') return { ...base, state: 'idle', until: 0, lastActivity: now }
  if (type === 'activity') {
    const next = base.state === 'sleep' || base.state === 'click' ? 'idle' : base.state
    return { ...base, state: next, until: 0, lastActivity: now }
  }
  // 页面隐藏只暂停，不换状态
  if (type === 'hidden') return { ...base, paused: true }
  if (type === 'visible') return { ...base, paused: false }

  if (type === 'tick') {
    if (base.state === 'drag') return base
    if (base.state === 'click' && now >= base.until) return { ...base, state: 'idle', until: 0 }
    if (base.state === 'idle' && !event?.panelOpen && now - base.lastActivity >= SLEEP_MS) {
      return { ...base, state: 'sleep' }
    }
    return base
  }

  return base
}

function previewBlock(markdown, toText) {
  const text = markdown ? String(toText(markdown) ?? '').trim() : ''
  return text ? '\n\n---\n\n' + text : ''
}

/**
 * 保存按钮的完整生产分支（无 DOM）：把这一稿 POST 给宿主，返回界面该显示什么、
 * 按钮还能不能再点。POST 在断网或响应不是 JSON 时会 reject，这里必须接住，
 * 否则按钮会永久禁用；原稿只在明确成功时才清空。
 *
 * uncertain 表示「上一次请求可能已经写盘，但客户端没收到回执」。带着它重试时，
 * 服务端若回 NO_PREVIEW，只能提示去库里确认，不能谎报成功，也不能再写一份。
 */
export async function runSave({
  post,
  sessionId,
  previewId,
  previewMarkdown = '',
  uncertain = false,
  toText = (s) => String(s),
}) {
  let res
  try {
    res = await post('/dsh-recap/save', { sessionId, previewId })
  } catch {
    return {
      action: 'retry',
      uncertain: true,
      canRetry: true,
      message:
        '没收到服务器的确认：可能没保存成功，也可能已经写入但回执丢了。\n\n' +
        '原预览还在，可以直接再点一次「保存进 Obsidian」。如果之后提示这稿已不在待保存队列，请先到 Obsidian 里确认，不要重复新建。' +
        previewBlock(previewMarkdown, toText),
    }
  }

  if (res?.ok) {
    return { action: 'saved', uncertain: false, canRetry: false, file: res.file, message: '' }
  }

  if (res?.code === 'PREVIEW_STALE') {
    const base = res.error || T.previewStale
    return {
      action: 'stale',
      uncertain: false,
      canRetry: false,
      message: base.includes('刷新') ? base : base + '\n\n请刷新页面后重新生成。',
    }
  }

  if (res?.code === 'PREVIEW_SAVING') {
    return {
      action: 'retry',
      uncertain,
      canRetry: true,
      message: '这稿正在写入，请等一两秒再点一次保存。' + previewBlock(previewMarkdown, toText),
    }
  }

  if (res?.code === 'NO_PREVIEW') {
    if (uncertain) {
      return {
        action: 'already',
        uncertain: true,
        canRetry: false,
        message:
          '这次重试没有写入新文件：这稿已经不在待保存队列里，很可能上一次其实已经写进去了。\n\n' +
          '请先到 Obsidian 里确认：找到就是成功了；没找到再点「重新生成」。' +
          previewBlock(previewMarkdown, toText),
      }
    }
    return {
      action: 'no-preview',
      uncertain: false,
      canRetry: false,
      message:
        '没有可保存的预览：这稿可能已经保存过，或者页面太久没刷新。\n\n' +
        '请先到 Obsidian 里确认；没找到就点「重新生成」。' +
        previewBlock(previewMarkdown, toText),
    }
  }

  return {
    action: 'retry',
    uncertain,
    canRetry: true,
    message:
      '保存失败：' +
      (res?.error || '未知错误') +
      '\n\n原预览还在，可以直接再点一次「保存进 Obsidian」。' +
      previewBlock(previewMarkdown, toText),
  }
}
