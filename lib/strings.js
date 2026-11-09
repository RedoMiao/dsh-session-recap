const PREVIEW_MISSING =
  '页面没有带上这稿的编号，无法确认要保存哪一稿。为避免存错，请刷新页面后重新生成再保存。'
const PREVIEW_STALE =
  '你看的这稿已经被同一对话的新一稿替换，为避免存错，请刷新页面后重新生成再保存。'

/** 用户可见文案：宿主侧。为将来英文预留位置：T[key] 换成 map 即可。 */
export const HOST_TEXT = {
  noVault: '还没有设置 Obsidian 库路径。打开面板里的「设置」，选择或填写你的库目录。',
  noVaultSave: '还没有选 Obsidian 库。选一个库就能保存；这稿还在，不会丢。',
  noSession: '没有确定要生成的对话。请先打开那次对话，或在面板里手动选一条。',
  noContent: '这次对话还没有内容可以生成。',
  noPreview: '还没有预览可保存，先点「生成」。',
  needScope: '这次对话比较长，先选怎么读。',
  previewMissing: PREVIEW_MISSING,
  previewStale: PREVIEW_STALE,
  badRequest: '请求格式不对。',
  forbidden: '请求被拒绝（来源或口令不对）。',
  tooLarge: '请求太大。',
  rateLimited: '刚生成过，请等几秒再试。',
  modelMissing: '拿不到模型信息，请在设置里选择模型。',
  modelEmpty: '模型没有返回内容，请重试或换模型。',
  templateEmpty: '该模板还没有提示词，请先编辑并保存。',
  writeFailed: '写入失败',
  vaultInvalid: '这个目录不是可写的 Obsidian 库',
}

export const ERR = {
  EACCES: '没有写入权限',
  ENOENT: '目录不存在',
  ENOSPC: '磁盘空间不足',
}

/** 浏览器侧文案：只放纯数据，ui.js 通过 /dsh-recap/strings.js 引入。 */
export const UI_TEXT = {
  confirm: '将生成：',
  confirmIt: '就是它',
  changeOne: '换一个',
  noListTitle: '暂时拉不到对话列表',
  noListHint: '可以点「重试」重新加载；不会自动换一条来生成。',
  emptyListTitle: '没有可生成的对话',
  emptyListHint: '先打开要生成的那次对话，再回来点猫；也可以点「重试」。',
  pickTitle: '没有正在进行的对话，请选择要生成的一次：',
  pickHint: '不会自动挑最近活跃的那条。',
  needPick: '还没有选择要生成的对话。',
  listTitle: '选一个对话：',
  turns: '轮',
  noVault: '还没有设置 Obsidian 库路径。请在下面「设置」里选一个库目录。',
  noPreviewHint: '这条预览不属于当前对话',
  templateEmpty: '该模板还没有提示词，请先编辑并保存。',
  goEdit: '去编辑',
  previewMissing: PREVIEW_MISSING,
  previewStale: PREVIEW_STALE,
  saved: '已写入：',
  failed: '失败：',
  saving: '正在读这次对话并生成…（约 20-60 秒）',
  readingRecent: '正在读这次对话并生成…（约 20-60 秒）',
  readingRecentDefault: '按设置：只读重点。正在读这次对话并生成…（约 20-60 秒）',
  readingAll: '正在把全部对话分段读完…（可能 1–3 分钟，别关面板）',
  readingAllDefault: '按设置：读全部。正在把全部对话分段读完…（可能 1–3 分钟，别关面板）',
  readingContinue: '正在从中断处接着写…（别关面板）',
  previewUnsaved: '这稿还没保存：刷新页面或关掉 DSH 就没了。先复制，或点「保存进 Obsidian」选个库。',
  saveNeedVault: '先选一个库，这稿还在；选好后关掉设置再点保存。',
  copied: '已复制',
  copyFailed: '复制不了，请手动选中上面的正文复制。',
  useFull: '改用完整读取',
  continueWrite: '继续写',
  truncated: '这稿写到了单次输出上限，后面可能还没写完。',
  needScopeTitle: '这次对话比较长，先选怎么读：',
  scopeRecent: '只读重点（最初的诉求、关键更正、最近 20 条）',
  scopeRecentHint: '约 20–40 秒，可能漏掉中间一些细节。',
  scopeAll: '读全部对话（分段读，再汇总）',
  scopeAllHint: '可能多花 1–3 分钟，尽量不漏。',
  scopeFootnote: '你的模板要求优先；两种方式都按模板生成。',
  readDefaultLabel: '长对话默认怎么读',
  readDefaultAsk: '每次问我',
  readDefaultRecent: '只读重点',
  readDefaultAll: '读全部',
  mountFailed: '[dsh-recap] mount failed: 按钮没进 DOM',
}
