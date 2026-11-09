// 右下角可拖动的猫按钮 + 总结面板。纯 DOM。
import {
  createFlow,
  needsReload,
  bannerFor,
  anchorFor,
  createVaultPick,
  catState,
  runSave,
  sessionChoice,
  readSessions,
} from './flow.js'
import { UI_TEXT as T } from './strings.js'
import { renderMarkdown } from './markdown.js'

const GET = (p) =>
  fetch(p, { cache: 'no-store', headers: { 'x-recap-token': window.__dshRecapToken || '' } }).then((r) => r.json())

;(() => {
  if (window.__dshRecapMounted) return
  window.__dshRecapMounted = true

  const TOKEN = window.__dshRecapToken || ''

  const POST = (path, body) =>
    fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-recap-token': TOKEN },
      body: JSON.stringify({ href: location.href, ...(body || {}) }),
    }).then((r) => r.json())



  const COLORS = ['#f3dfae', '#c9e4d2', '#c9dcf2', '#f2d0da', '#f6ddc4', '#ded3ec']

  const css = document.createElement('style')
  css.textContent = `
  #dsh-recap-btn{position:fixed;right:24px;bottom:24px;z-index:2147483000;width:72px;height:80px;border-radius:16px;overflow:visible;
    background:transparent;border:none;padding:0;cursor:grab;user-select:none;touch-action:none;
    filter:drop-shadow(0 6px 16px rgba(0,0,0,.25));transition:transform .12s ease}
  #dsh-recap-btn:hover{transform:translateY(-2px) scale(1.04)}
  #dsh-recap-btn.dragging{cursor:grabbing;transform:scale(1.06)}
  #dsh-recap-btn img{width:100%;height:100%;object-fit:contain;pointer-events:none;overflow:visible}
  #dsh-recap-panel{position:fixed;z-index:2147483000;width:430px;max-width:calc(100vw - 32px);max-height:70vh;
    background:#fffdfa;color:#1f2430;border:1px solid #ece6dc;border-radius:22px;
    box-shadow:0 22px 60px rgba(40,32,24,.26),0 2px 6px rgba(40,32,24,.08);
    display:none;flex-direction:column;overflow:hidden;
    font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  #dsh-recap-panel.open{display:flex}
  #dsh-recap-tail{position:fixed;z-index:2147483002;width:20px;height:11px;background:#ece6dc;
    display:none;clip-path:polygon(0 0,100% 0,50% 100%)}
  #dsh-recap-tail::after{content:"";position:absolute;left:1px;top:0;width:18px;height:10px;
    background:#fffdfa;clip-path:polygon(0 0,100% 0,50% 100%)}
  #dsh-recap-tail.open{display:block}
  #dsh-recap-tail[data-dir="up"]{transform:scaleY(-1)}
  #dsh-recap-tail[data-theme="dark"]{background:#333844}
  #dsh-recap-tail[data-theme="dark"]::after{background:#20232b}
  .dsh-recap-tabsbar{display:flex;align-items:stretch;gap:4px;padding:5px 6px 0;flex:none;min-width:0}
  .dsh-recap-tabs{display:flex;flex-wrap:nowrap;gap:6px;padding:0 2px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;flex:1 1 auto;min-width:0}
  .dsh-recap-tabs::-webkit-scrollbar{display:none;height:0;width:0}
  .dsh-recap-tabnav{display:none;flex:none;align-self:center;width:26px;height:28px;padding:0;border:1px solid #e2e6ee;border-radius:8px;
    background:#f7f8fb;color:#4b5162;cursor:pointer;line-height:1;font-size:18px}
  .dsh-recap-tabsbar.can-scroll .dsh-recap-tabnav{display:block}
  .dsh-recap-tabnav:disabled{opacity:.32;cursor:default}
  #dsh-recap-panel .dsh-recap-tabnav{font-size:18px !important}
  #dsh-recap-panel .dsh-recap-tabnav:focus-visible{outline:2px solid #3b6cf6;outline-offset:1px}
  .dsh-recap-tab{flex:0 0 auto;white-space:nowrap;box-sizing:border-box;max-width:11em;overflow:hidden;text-overflow:ellipsis;cursor:pointer;border:none;border-radius:11px 11px 0 0;padding:9px 14px;font-size:13px;
    color:#4b5162;opacity:.72;transform:translateY(3px);box-shadow:0 -1px 3px rgba(0,0,0,.05)}
  .dsh-recap-tab:focus-visible{outline:2px solid #3b6cf6;outline-offset:1px}
  .dsh-recap-tab.active{opacity:1;transform:translateY(0);font-weight:600;box-shadow:0 -2px 6px rgba(0,0,0,.09)}
  .dsh-recap-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #eef0f4;font-weight:600}
  .dsh-recap-head span{flex:1}
  .dsh-recap-x{cursor:pointer;border:none;background:none;font-size:18px;line-height:1;color:#8a90a0}
  .dsh-recap-actions{display:flex;gap:8px;padding:12px 14px;flex-wrap:wrap}
  .dsh-recap-actions button{cursor:pointer;border:1px solid #e2e6ee;background:#f7f8fb;border-radius:10px;padding:8px 12px;font-size:13px}
  .dsh-recap-actions button.primary{background:#3b6cf6;border-color:#3b6cf6;color:#fff}
  .dsh-recap-actions button:disabled{opacity:.5;cursor:default}
  /* 空模板提示：一行，不另开滚动区，不占会话列表的主内容区 */
  .dsh-recap-template-gate{display:none;align-items:center;gap:8px;margin:0 14px 10px;padding:8px 10px;
    border:1px solid #f0dcc0;background:#fff8ec;border-radius:10px;font-size:.86em;color:#8a5a00;flex:none}
  .dsh-recap-template-gate span{flex:1;min-width:0;overflow-wrap:anywhere}
  .dsh-recap-template-gate button{flex:none;padding:4px 10px;border-radius:7px;border:1px solid #d8b878;
    background:#fff;color:#8a5a00;cursor:pointer;font-size:.86em}
  .dsh-recap-settings-wrap{display:none;flex-direction:column;min-height:0;flex:0 1 auto;border-top:1px solid #f2eee6}
  .dsh-recap-settings-wrap.open{display:flex}
  .dsh-recap-settings{overflow:auto;flex:1 1 auto;min-height:0;max-height:52vh;padding:4px 14px 12px;overscroll-behavior:contain}
  .dsh-recap-settings-sound{flex:none;margin-top:14px;border-top:1px dashed #eee5d8;padding-top:10px}
  .dsh-recap-edit-title{font-size:12px;color:#3a4152;margin-bottom:6px;font-weight:600}
  .dsh-recap-settings-status,.dsh-recap-tplstatus{min-height:1.4em;font-size:12px;color:#3f7d4e;margin-top:6px}
  .dsh-recap-body{padding:0 14px 14px;overflow:auto;white-space:pre-wrap;font-size:13px;color:#3a4152;flex:1 1 auto;min-height:0}
  /* 编辑模板时把中间空间让给设置滚动区；预览只暂时隐藏，关闭编辑后原样回来 */
  #dsh-recap-panel.editing .dsh-recap-body{display:none}
  /* 设置打开时整块主内容区让位（不占高度、不可聚焦）；关闭后按原状态恢复 */
  #dsh-recap-panel.settings-open .dsh-recap-body{display:none}
  #dsh-recap-panel.settings-open .dsh-recap-noticebar,
  #dsh-recap-panel.editing .dsh-recap-noticebar{display:none}
  #dsh-recap-panel.settings-open .dsh-recap-viewbar,
  #dsh-recap-panel.editing .dsh-recap-viewbar{display:none}
  /* 预览上方的持续提醒 / 裁剪说明 / 后续操作，都在正文外，不挤正文滚动区 */
  .dsh-recap-noticebar{flex:none;padding:0 14px 8px}
  .dsh-recap-noticebar[hidden]{display:none}
  .dsh-recap-unsaved{padding:8px 10px;border:1px solid #f0dcc0;background:#fff8ec;border-radius:10px;
    font-size:.86em;line-height:1.5;color:#8a5a00;margin-top:2px}
  .dsh-recap-trim{padding:7px 0 2px;font-size:.86em;line-height:1.5;color:#8a6a3a;white-space:pre-wrap}
  .dsh-recap-preview-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px}
  .dsh-recap-preview-actions button{padding:5px 10px;border-radius:8px;border:1px solid #d9cbb0;
    background:#fff;color:#6b4d18;cursor:pointer;font-size:.86em}
  .dsh-recap-copy-status{font-size:.86em;color:#b4553f;min-width:0;overflow-wrap:anywhere}
  /* 预览 / 源码：独立一行，不依赖提醒条；没有提醒时也一直在 */
  .dsh-recap-viewbar{flex:none;display:flex;justify-content:flex-end;align-items:center;padding:0 14px 6px}
  .dsh-recap-viewbar[hidden]{display:none}
  .dsh-recap-viewbar button{padding:3px 9px;border-radius:7px;border:1px solid #e2e6ee;background:#f7f8fb;
    color:#5b6273;cursor:pointer;font-size:.86em;line-height:1.5}
  /* Markdown 预览：正文按块排版；源码态保留空白与换行 */
  .dsh-recap-md{white-space:normal;overflow-wrap:anywhere;line-height:1.6}
  .dsh-recap-md>*:first-child{margin-top:0}
  .dsh-recap-md>*:last-child{margin-bottom:0}
  .dsh-recap-md h1,.dsh-recap-md h2,.dsh-recap-md h3,
  .dsh-recap-md h4,.dsh-recap-md h5,.dsh-recap-md h6{
    margin:12px 0 6px;line-height:1.35;font-weight:700;color:inherit}
  .dsh-recap-md h1{font-size:1.34em}
  .dsh-recap-md h2{font-size:1.2em}
  .dsh-recap-md h3{font-size:1.1em}
  .dsh-recap-md h4,.dsh-recap-md h5,.dsh-recap-md h6{font-size:1em}
  .dsh-recap-md p{margin:0 0 8px}
  .dsh-recap-md ul,.dsh-recap-md ol{margin:4px 0 8px;padding-left:22px}
  .dsh-recap-md li{margin:2px 0}
  .dsh-recap-md li>ul,.dsh-recap-md li>ol{margin:2px 0}
  .dsh-recap-md blockquote{margin:8px 0;padding:3px 10px;border-left:3px solid #d9dee8;color:#5b6273}
  .dsh-recap-md hr{border:none;border-top:1px solid #e2e6ee;margin:10px 0}
  .dsh-recap-md a{color:#3b6cf6;text-decoration:underline}
  .dsh-recap-md del{opacity:.78}
  .dsh-recap-md code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;
    background:#f0f2f7;border-radius:4px;padding:1px 4px;font-size:.92em}
  .dsh-recap-md pre.dsh-recap-pre{margin:8px 0;padding:8px 10px;background:#f5f7fb;border:1px solid #e2e6ee;
    border-radius:8px;overflow-x:auto;max-width:100%;white-space:pre;line-height:1.5}
  .dsh-recap-md pre.dsh-recap-pre code{background:none;padding:0;font-size:.9em;white-space:pre}
  .dsh-recap-tablewrap{max-width:100%;overflow-x:auto;margin:8px 0;border:1px solid #e2e6ee;
    border-radius:8px;background:#fff}
  .dsh-recap-table{border-collapse:collapse;width:max-content;min-width:100%;font-size:.95em}
  .dsh-recap-table th,.dsh-recap-table td{border:1px solid #e2e6ee;padding:5px 8px;vertical-align:top;
    min-width:64px;max-width:280px;white-space:normal;overflow-wrap:anywhere}
  .dsh-recap-table th{text-align:left;background:#f5f7fb;font-weight:600}
  .dsh-recap-table th[align="center"],.dsh-recap-table td[align="center"]{text-align:center}
  .dsh-recap-table th[align="right"],.dsh-recap-table td[align="right"]{text-align:right}
  .dsh-recap-table tbody tr:nth-child(even){background:#fafbfd}
  .dsh-recap-task{display:inline-block;min-width:1.1em;color:#5b6273}
  .dsh-recap-src{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;
    font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;
    font-size:.9em;line-height:1.55;color:inherit}
  /* 长对话读取方式：两个整行按钮，文字不挤出 390px 面板 */
  .dsh-recap-scope-title{font-weight:600;margin-bottom:8px}
  .dsh-recap-scope{display:flex;flex-direction:column;gap:8px}
  .dsh-recap-scope button{display:block;width:100%;box-sizing:border-box;text-align:left;padding:10px 11px;
    border:1px solid #e2e6ee;border-radius:10px;background:#f7f8fb;cursor:pointer;white-space:normal;overflow-wrap:anywhere}
  .dsh-recap-scope .label{display:block;font-weight:600;font-size:.95em;line-height:1.4}
  .dsh-recap-scope .sub{display:block;margin-top:3px;color:#8a90a0;font-size:.86em;line-height:1.45}
  .dsh-recap-scope .foot{margin-top:8px;color:#8a90a0;font-size:.86em;line-height:1.45}
  .dsh-recap-vault-hint{font-size:12px;line-height:1.5;color:#b4553f;margin-top:6px}
  .dsh-recap-vault-hint:empty{display:none}
  .dsh-recap-err{color:#c0392b}
  /* 字号跟随宿主：面板基准来自 --dsh-content-font-size，缺省 14px */
  #dsh-recap-panel{font-size:var(--dsh-content-font-size,14px)}
  #dsh-recap-panel button{font-size:.93em !important}
  #dsh-recap-panel input,#dsh-recap-panel textarea,#dsh-recap-panel select{font-size:.86em !important}
  #dsh-recap-panel .dsh-recap-body{font-size:.93em}
  #dsh-recap-panel label,#dsh-recap-panel .dsh-recap-hint{font-size:.86em !important}
  #dsh-recap-panel .dsh-recap-tab{font-size:.93em}
  #dsh-recap-panel[data-theme="dark"]{background:#20232b;border-color:#333844;color:#e6e8ee;
    box-shadow:0 22px 60px rgba(0,0,0,.55)}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-head{border-bottom-color:#2c313c}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-x{color:#9aa2b1 !important}
  #dsh-recap-panel[data-theme="dark"] button{background:#2a2f39 !important;border-color:#3a404d !important;color:#e6e8ee !important}
  #dsh-recap-panel[data-theme="dark"] button.primary{background:#4a7dff !important;border-color:#4a7dff !important;color:#fff !important}
  #dsh-recap-panel[data-theme="dark"] button:disabled{opacity:.45}
  #dsh-recap-panel[data-theme="dark"] input,
  #dsh-recap-panel[data-theme="dark"] textarea{
    background:#171a21 !important;border-color:#3a404d !important;color:#e6e8ee !important}
  #dsh-recap-panel[data-theme="dark"] input::placeholder,
  #dsh-recap-panel[data-theme="dark"] textarea::placeholder{color:#6b7280}
  #dsh-recap-panel[data-theme="dark"] label,
  #dsh-recap-panel[data-theme="dark"] label span,
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-settings div{color:#9aa2b1 !important}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-body{color:#c8cdd7}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-viewbar button{background:#2a2f39 !important;
    border-color:#3a404d !important;color:#aab2c0 !important}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md h1,
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md h2,
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md h3,
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md h4,
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md h5,
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md h6{color:#e6e8ee}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md a{color:#8cb4ff}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md blockquote{border-left-color:#3a404d;color:#aab2c0}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md hr{border-top-color:#3a404d}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md code{background:#2a2f39;color:#e6e8ee}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-md pre.dsh-recap-pre{background:#171a21;
    border-color:#333844;color:#e6e8ee}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-tablewrap{background:#20232b;border-color:#3a404d}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-table th,
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-table td{border-color:#3a404d;color:#c8cdd7}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-table th{background:#2a2f39;color:#e6e8ee}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-table tbody tr:nth-child(even){background:#242831}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-task{color:#aab2c0}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-settings-sound{border-top-color:#2c313c}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-settings .dsh-recap-edit-title{color:#e6e8ee !important}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-template-gate{background:#2a261d;border-color:#5a4a2a;color:#e9c886}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-template-gate button{background:#332d22 !important;border-color:#6b5730 !important;color:#e9c886 !important}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-unsaved{background:#2a261d;border-color:#5a4a2a;color:#e9c886}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-trim{color:#c9b48a}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-preview-actions button{background:#332d22 !important;border-color:#6b5730 !important;color:#e9c886 !important}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-scope button{background:#2a2f39 !important;border-color:#3a404d !important;color:#e6e8ee !important}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-tpllist div{border-bottom-color:#2c313c !important}
  #dsh-recap-panel[data-theme="dark"] .dsh-recap-tpllist span{color:#e6e8ee !important}

  `
  document.head.appendChild(css)

  const btn = document.createElement('button')
  btn.id = 'dsh-recap-btn'
  btn.title = '生成'
  const img = document.createElement('img')
  img.alt = '生成'

  // —— 多状态小猫 ——
  const CAT_SRC = {
    idle: '/dsh-recap/cat-idle.webp',
    click: '/dsh-recap/cat-click.webp',
    drag: '/dsh-recap/cat-drag.webp',
    sleep: '/dsh-recap/cat-sleep.webp',
  }
  const STATIC_CAT = '/dsh-recap/cat.png'
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
  // 启动时预加载，切换只改 src，不重建 DOM
  if (!reduceMotion) for (const src of Object.values(CAT_SRC)) new Image().src = src
  let cat = { state: 'idle', until: 0, lastActivity: Date.now(), paused: false }
  function paintCat() {
    if (reduceMotion) {
      if (img.src !== STATIC_CAT) img.src = STATIC_CAT
      return
    }
    const next = cat.state
    const want = CAT_SRC[next] || STATIC_CAT
    if (img.getAttribute('src') !== want) img.setAttribute('src', want)
  }
  function dispatchCat(type, extra = {}) {
    cat = catState(cat, { type, ...extra }, Date.now())
    paintCat()
  }
  img.src = reduceMotion ? STATIC_CAT : CAT_SRC.idle
  btn.appendChild(img)

  const panel = document.createElement('div')
  panel.id = 'dsh-recap-panel'
  panel.innerHTML = `
    <div class="dsh-recap-tabsbar">
      <button class="dsh-recap-tabnav" data-tabnav="left" title="往前翻模板" aria-label="往前翻模板">‹</button>
      <div class="dsh-recap-tabs" role="tablist"></div>
      <button class="dsh-recap-tabnav" data-tabnav="right" title="往后翻模板" aria-label="往后翻模板">›</button>
    </div>
    <div class="dsh-recap-head"><span>主人有什么吩咐？</span><button class="dsh-recap-x" title="关闭">×</button></div>
    <div class="dsh-recap-actions">
      <button data-act="summary" class="primary">生成</button>
      <button data-act="save" disabled>保存进 Obsidian</button>
      <button data-act="copy" disabled>复制</button>
      <button data-act="regen" disabled>重新生成</button>
      <button data-act="clear" disabled>清空</button>
      <button data-act="settings">设置</button>
    </div>
    <div class="dsh-recap-template-gate" role="status" aria-live="polite">
      <span data-gate="text"></span>
      <button data-act="goedit">去编辑</button>
    </div>
    <div class="dsh-recap-settings-wrap">
    <div class="dsh-recap-settings">
      <label style="display:block;font-size:12px;color:#8a90a0;margin:10px 0 4px">Obsidian 库路径</label>
      <input data-k="vaultPath" style="width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #e6e1d8;border-radius:9px;font-size:12px" />
      <div class="dsh-recap-current" style="font-size:12px;color:#8a90a0;margin-top:6px">当前生效：尚未设置</div>
      <div class="dsh-recap-vault-hint" data-vault-hint role="status" aria-live="polite"></div>
      <button data-act="detect" style="margin-top:10px;padding:6px 10px;border-radius:8px;border:1px solid #ddd6c9;background:#fff;cursor:pointer;font-size:12px">自动找我的 Obsidian 库</button>
      <div class="dsh-recap-vaults" style="margin-top:6px"></div>
      <div style="margin-top:14px;border-top:1px dashed #eee5d8;padding-top:10px">
        <label style="display:block;font-size:12px;color:#8a90a0;margin:0 0 4px">保存到库里的哪个文件夹</label>
        <input data-k="projectRoot" placeholder="项目经历" style="width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #e6e1d8;border-radius:9px;font-size:12px" />
      </div>
      <div style="margin-top:14px;border-top:1px dashed #eee5d8;padding-top:10px">
        <label for="dsh-recap-read-default" style="display:block;font-size:12px;color:#8a90a0;margin:0 0 4px">长对话默认怎么读</label>
        <select id="dsh-recap-read-default" data-read="default" style="width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #e6e1d8;border-radius:9px;font-size:12px">
          <option value="ask">每次问我</option>
          <option value="recent">只读重点</option>
          <option value="all">读全部</option>
        </select>
      </div>
      <div style="margin-top:14px;border-top:1px dashed #eee5d8;padding-top:10px">
        <div style="font-size:12px;color:#8a90a0;margin-bottom:8px">提示词模板（点「编辑」修改；名称太长会省略，用标签两侧的 ‹ › 翻动）</div>
        <div class="dsh-recap-tpllist"></div>
        <button data-act="tplnew" style="margin-top:8px;padding:6px 10px;border-radius:8px;border:1px dashed #cfc7b8;background:#fff;cursor:pointer;font-size:12px">＋ 新建模板（最多 6 个）</button>
        <div class="dsh-recap-tpledit" style="display:none;margin-top:10px;border-top:1px dashed #eee5d8;padding-top:10px">
          <div class="dsh-recap-edit-title" data-tpl="editing-label">正在编辑：模板</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <input type="color" data-tpl="color" style="width:46px;height:30px;border:1px solid #e6e1d8;border-radius:7px;padding:2px;background:#fff" />
            <input data-tpl="name" placeholder="模板标题" style="flex:1;box-sizing:border-box;padding:7px 9px;border:1px solid #e6e1d8;border-radius:9px;font-size:12px" />
          </div>
          <textarea data-tpl="body" rows="7" placeholder="贴模板骨架，或直接写一段要求（例：用 200 字，只讲踩坑和结论）" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #e6e1d8;border-radius:9px;font-size:12px;line-height:1.5;resize:vertical"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button data-act="tplsave" style="padding:6px 10px;border-radius:8px;border:1px solid #ddd6c9;background:#fff;cursor:pointer;font-size:12px">保存模板</button>
            <button data-act="tpldel" style="padding:6px 10px;border-radius:8px;border:1px solid #f0d7d2;background:#fff;color:#b4553f;cursor:pointer;font-size:12px">删除</button>
          </div>
        </div>
        <div class="dsh-recap-tplstatus" role="status" aria-live="polite"></div>
      </div>
      <div class="dsh-recap-settings-sound">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#5b6273">
          <input type="checkbox" data-sound="on" /> 点击猫时播放叫声
        </label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:#5b6273">
          音量 <input type="range" data-sound="vol" min="0" max="100" step="5" style="flex:1" />
        </label>
        <button data-act="savecfg" style="margin-top:10px;padding:7px 12px;border-radius:9px;border:1px solid #3b6cf6;background:#3b6cf6;color:#fff;cursor:pointer;font-size:12px">保存其他设置</button>
        <div class="dsh-recap-settings-status" role="status" aria-live="polite"></div>
        <div style="font-size:11px;color:#8a90a0;margin-top:2px">库路径只由上方「用这个库」写入，这里不会改库。</div>
      </div>
    </div>
    </div>
    <div class="dsh-recap-hint" style="font-size:12px;color:#b4553f;padding:0 14px"></div>
    <div class="dsh-recap-noticebar" hidden>
      <div class="dsh-recap-unsaved" data-note="unsaved" hidden></div>
      <div class="dsh-recap-trim" data-note="trim" hidden></div>
      <div class="dsh-recap-trim" data-note="truncated" hidden></div>
      <div class="dsh-recap-preview-actions">
        <button data-act="usefull" hidden>改用完整读取</button>
        <button data-act="continue" hidden>继续写</button>
        <span class="dsh-recap-copy-status" data-note="noticeerror"></span>
      </div>
    </div>
    <div class="dsh-recap-viewbar" hidden>
      <button type="button" data-act="toggle-view" aria-pressed="false">源码</button>
    </div>
    <div class="dsh-recap-body"></div>
  `

  document.body.appendChild(btn)
  document.body.appendChild(panel)
  const tail = document.createElement('div')
  tail.id = 'dsh-recap-tail'
  document.body.appendChild(tail)

  const bodyEl = panel.querySelector('.dsh-recap-body')
  const saveBtn = panel.querySelector('[data-act=save]')
  const copyBtn = panel.querySelector('[data-act=copy]')
  const noticeBar = panel.querySelector('.dsh-recap-noticebar')
  const viewBar = panel.querySelector('.dsh-recap-viewbar')
  const viewBtn = panel.querySelector('[data-act=toggle-view]')
  const unsavedEl = panel.querySelector('[data-note=unsaved]')
  const trimEl = panel.querySelector('[data-note=trim]')
  const truncatedEl = panel.querySelector('[data-note=truncated]')
  const noticeErrorEl = panel.querySelector('[data-note=noticeerror]')
  const fullBtn = panel.querySelector('[data-act=usefull]')
  const continueBtn = panel.querySelector('[data-act=continue]')
  // 包装层负责显隐；内层 .dsh-recap-settings 是唯一滚动区，音效与保存按钮都在其中
  const settingsBox = panel.querySelector('.dsh-recap-settings-wrap')
  const settingsScroll = panel.querySelector('.dsh-recap-settings')
  // 主区让位时记住它的滚动位置，关闭设置后还原（display:none 会把它归零）
  let bodyScrollTop = 0
  const settingsOpen = () => settingsBox.classList.contains('open')
  // 保存按钮唯一的开关汇总：设置打开、会话选择中、生成中、构建不一致时都不能保存
  const syncSave = () => {
    saveBtn.disabled =
      buildBlocked ||
      settingsOpen() ||
      inviteShowing ||
      summarizing ||
      choosingScope ||
      !previewId ||
      !flow.canSave()
    if (copyBtn)
      copyBtn.disabled =
        !previewMarkdown || buildBlocked || settingsOpen() || inviteShowing || summarizing || choosingScope
    const hint = flow.hint()
    const box = panel.querySelector('.dsh-recap-hint')
    if (box) box.textContent = hint
  }
  const regenBtn = panel.querySelector('[data-act=regen]')
  const clearBtn = panel.querySelector('[data-act=clear]')
  const summaryBtn = panel.querySelector('[data-act=summary]')
  const gateEl = panel.querySelector('.dsh-recap-template-gate')
  const gateText = gateEl.querySelector('[data-gate=text]')
  const tabsBar = panel.querySelector('.dsh-recap-tabsbar')
  const tabsEl = panel.querySelector('.dsh-recap-tabs')
  const tabPrev = panel.querySelector('[data-tabnav=left]')
  const tabNext = panel.querySelector('[data-tabnav=right]')
  const listEl = panel.querySelector('.dsh-recap-tpllist')
  const editorEl = panel.querySelector('.dsh-recap-tpledit')

  // 跟着宿主的深浅色走：采样页面背景的亮度，不依赖任何内部变量名
  function themeOf() {
    try {
      const bg = getComputedStyle(document.body).backgroundColor
      const m = bg.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
      if (!m) return 'light'
      const lum = 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]
      return lum < 120 ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  }
  function applyTheme() {
    const theme = themeOf()
    panel.dataset.theme = theme
    tail.dataset.theme = theme
  }
  applyTheme()
  // 主路径：观察宿主的主题开关；5 秒轮询只在页面可见时兜底
  const obs = new MutationObserver(() => applyTheme())
  const watch = { attributes: true, attributeFilter: ['class', 'data-ds-dark-theme', 'style'] }
  try { obs.observe(document.documentElement, watch) } catch {}
  try { obs.observe(document.body, watch) } catch {}
  const themeTimer = setInterval(() => {
    if (document.hidden) return
    applyTheme()
  }, 5000)

  // 小猫状态：每秒 tick 一次（暂停时不跑），另有活动/可见性事件
  const catTimer = reduceMotion
    ? null
    : setInterval(() => {
        if (document.hidden) return
        cat = catState(cat, { type: 'tick', panelOpen: panel.classList.contains('open') }, Date.now())
        paintCat()
      }, 1000)

  const onActivity = () => {
    if (reduceMotion) return
    dispatchCat('activity')
  }
  const onVisibility = () => dispatchCat(document.hidden ? 'hidden' : 'visible')
  window.addEventListener('pointerdown', onActivity, { passive: true })
  window.addEventListener('keydown', onActivity)
  document.addEventListener('visibilitychange', onVisibility)

  let tpls = []
  let hasVault = false
  let active = 0
  let editing = -1
  let buildBlocked = false
  // 会话选择/确认邀请的代号：切空模板或重新发起时递增，旧请求回来不再补画
  let inviteGen = 0
  let inviteShowing = false
  // 模型请求返回前一直算「生成中」：设置开关不能把保存按钮误解禁
  let summarizing = false
  // 长对话选择读取范围期间：总结/保存都保持禁用，避免重复请求
  let choosingScope = false
  // 长对话默认读取方式：ask / recent / all，只存 localStorage，不改配置 schema
  let readScopeDefault = localStorage.getItem('dsh-recap-read-scope') || 'ask'
  if (!['ask', 'recent', 'all'].includes(readScopeDefault)) readScopeDefault = 'ask'
  // 同一会话本次页面生命周期内选过的读取方式，避免反复问
  const scopeBySession = new Map()
  // 主内容区当前显示的空模板提示节点；模板重新有正文时随提示条一起撤掉
  let emptyBodyNode = null

  /** 当前模板正文的真实内容：缺失、空串、纯空格/换行都算未填写 */
  function activeTemplateBody() {
    return String(tpls[active]?.body ?? '')
  }
  function templateIsEmpty() {
    return tpls.length === 0 || activeTemplateBody().trim() === ''
  }
  /** 空模板时的主内容提示：一行文字 +「去编辑」，不拉起会话列表 */
  function renderEmptyTemplateBody() {
    bodyEl.className = 'dsh-recap-body'
    bodyEl.textContent = ''
    hideNoticeBar()
    const box = document.createElement('div')
    const msg = document.createElement('div')
    msg.textContent = T.templateEmpty
    const go = document.createElement('button')
    go.textContent = T.goEdit
    go.dataset.act = 'goedit'
    go.style.marginTop = '6px'
    box.append(msg, go)
    bodyEl.appendChild(box)
    emptyBodyNode = box
  }
  // 切到空模板立即撤掉眼前的会话选择/确认邀请；在途列表返回后也不再画回来。
  // 只动选择/确认视图，不碰已有有效预览、previewId、pending 和未保存的编辑。
  function withdrawInvite() {
    inviteGen++
    if (!inviteShowing && !choosingScope) return
    inviteShowing = false
    choosingScope = false
    // 有待保存稿时必须把正文放回眼前，不能只剩提示却让保存按钮可用
    if (previewId) renderPreviewBody()
    else renderEmptyTemplateBody()
    syncSave()
  }
  // 空模板只显示一条眼前提示并禁用总结；不另开滚动区，不拉会话列表
  function syncTemplateGate() {
    const empty = templateIsEmpty()
    gateEl.style.display = empty ? 'flex' : 'none'
    if (empty) {
      const name = tpls[active]?.name || `模板${active + 1}`
      gateText.textContent = `${T.templateEmpty}（当前：${name}）`
    }
    summaryBtn.disabled = empty || buildBlocked || summarizing || choosingScope
    regenBtn.disabled = empty || buildBlocked || summarizing || choosingScope || !previewId
    if (empty) withdrawInvite()
    else if (emptyBodyNode && bodyEl.contains(emptyBodyNode)) {
      // 模板已重新有正文：过期的「请先填写提示词」不能留在主内容区
      bodyEl.textContent = ''
      emptyBodyNode = null
    }
  }
  const soundPrefs = {
    on: localStorage.getItem('dsh-recap-sound') !== '0',
    volume: Number(localStorage.getItem('dsh-recap-vol') ?? 0.25),
  }

  const KEY = 'dsh-recap-pos'
  const place = (x, y) => {
    btn.style.left = Math.max(6, Math.min(innerWidth - 74, x)) + 'px'
    btn.style.top = Math.max(6, Math.min(innerHeight - 74, y)) + 'px'
    btn.style.right = 'auto'
    btn.style.bottom = 'auto'
  }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (saved) place(saved.x, saved.y)
  } catch {}

  function openPanel() {
    panel.classList.add('open')
    const r = btn.getBoundingClientRect()
    const vp = { width: innerWidth, height: innerHeight }
    // 先按当前尺寸算一次拿到 maxHeight，再按受限后的真实高度重算位置
    const first = anchorFor(
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { left: r.left, top: r.top, width: r.width, height: r.height },
      vp,
    )
    panel.style.maxHeight = first.maxHeight + 'px'
    const a = anchorFor(
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { left: r.left, top: r.top, width: r.width, height: r.height },
      vp,
    )
    panel.style.left = a.left + 'px'
    panel.style.top = a.top + 'px'
    tail.style.left = Math.max(14, Math.min(innerWidth - 44, r.left + r.width / 2 - 10)) + 'px'
    tail.style.top = (a.dir === 'down' ? a.top + a.height - 1 : a.top - 10) + 'px'
    tail.dataset.dir = a.dir
    tail.classList.add('open')
    updateTabNav()
  }

  // 面板内容变化（确认条出现、结果变长变短）或窗口尺寸变化时，尖角要跟着走
  let rafPending = false
  const reposition = () => {
    if (!panel.classList.contains('open') || rafPending) return
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      openPanel()
    })
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(reposition) : null
  try {
    if (ro) ro.observe(panel)
  } catch {}
  window.addEventListener('resize', reposition)

  /**
   * 设置与主内容互斥：打开时整块 .dsh-recap-body 让位（不占高度、不可聚焦），
   * 关闭时原样恢复同一份 DOM 内容与滚动位置；不重拉列表、不重选、不生成。
   */
  function setSettingsOpen(open) {
    const was = settingsBox.classList.contains('open')
    if (open && !was) bodyScrollTop = bodyEl.scrollTop
    settingsBox.classList.toggle('open', open)
    panel.classList.toggle('settings-open', open)
    // 主区让位时开关也一起让位，关闭后按原视图恢复
    syncViewBar()
    if (!open && was) {
      // display:none 期间浏览器会把滚动位置归零，这里还原用户离开时的位置
      requestAnimationFrame(() => {
        bodyEl.scrollTop = bodyScrollTop
      })
      renderNoticeBar()
    }
    syncSave()
  }

  function closePanel() {
    panel.classList.remove('open')
    tail.classList.remove('open')
    setSettingsOpen(false)
    hideEditor()
  }
  function togglePanel() {
    if (panel.classList.contains('open')) closePanel()
    else openPanel()
  }

  let dragging = false
  let moved = false
  let dragAnnounced = false
  let startX = 0
  let startY = 0
  let dx = 0
  let dy = 0
  const DRAG_THRESHOLD = 4

  function endDrag(commit) {
    if (dragAnnounced) dispatchCat('dragend')
    dragging = false
    dragAnnounced = false
    moved = false
    btn.classList.remove('dragging')
    if (commit) {
      try {
        const r = btn.getBoundingClientRect()
        localStorage.setItem(KEY, JSON.stringify({ x: r.left, y: r.top }))
      } catch {}
    }
  }

  btn.addEventListener('pointerdown', (e) => {
    dragging = true
    moved = false
    dragAnnounced = false
    startX = e.clientX
    startY = e.clientY
    dispatchCat('press') // 只记起点，不换状态
    const r = btn.getBoundingClientRect()
    dx = e.clientX - r.left
    dy = e.clientY - r.top
    btn.setPointerCapture(e.pointerId)
  })
  btn.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY)
    if (!moved && dist > DRAG_THRESHOLD) {
      moved = true
      dragAnnounced = true
      btn.classList.add('dragging')
      dispatchCat('dragstart')
    }
    if (!moved) return
    place(e.clientX - dx, e.clientY - dy)
    if (panel.classList.contains('open')) openPanel()
  })
  btn.addEventListener('pointerup', () => {
    if (!dragging) return
    const wasMoved = moved
    endDrag(true)
    if (!wasMoved) {
      if (soundPrefs.on && soundPrefs.volume > 0) {
        try {
          const a = new Audio('/dsh-recap/cat.mp3')
          a.volume = soundPrefs.volume
          a.play().catch(() => {})
        } catch {}
      }
      dispatchCat('click')
      togglePanel()
    }
  })
  btn.addEventListener('pointercancel', () => endDrag(false))
  window.addEventListener('blur', () => {
    if (dragging) endDrag(false)
  })

  const mdToText = (s) =>
    String(s)
      .replace(/^```.*$/gm, '')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '· ')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\|?[\s:-]*-{2,}[\s:|-]*$/gm, '')
      .replace(/^\|(.*)\|$/gm, (_, inner) =>
        inner
          .split('|')
          .map((c) => c.trim())
          .join('　'),
      )
      .replace(/\n{3,}/g, '\n\n')
      .trim()

  /** 复制原始 markdown；剪贴板不可用时退到 execCommand，并让正文可手动选中。 */
  async function copyRaw(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(text))
        return true
      }
    } catch {}
    try {
      const ta = document.createElement('textarea')
      ta.value = String(text)
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      ta.setSelectionRange(0, ta.value.length)
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }

  function selectBodyText() {
    try {
      const range = document.createRange()
      range.selectNodeContents(bodyEl)
      const sel = getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    } catch {}
  }
  function updateTabNav() {
    if (!tabsEl.clientWidth) return
    const max = tabsEl.scrollWidth - tabsEl.clientWidth
    const can = max > 1
    tabsBar.classList.toggle('can-scroll', can)
    tabPrev.disabled = !can || tabsEl.scrollLeft <= 1
    tabNext.disabled = !can || tabsEl.scrollLeft >= max - 1
  }

  /** 一次翻一屏多一点，普通鼠标点几下就能从第 1 个到第 6 个 */
  function scrollTabs(dir) {
    const step = Math.max(96, Math.round(tabsEl.clientWidth * 0.75))
    tabsEl.scrollBy({ left: dir === 'left' ? -step : step, behavior: 'smooth' })
  }

  tabsEl.addEventListener('scroll', updateTabNav, { passive: true })
  tabPrev.addEventListener('click', () => scrollTabs('left'))
  tabNext.addEventListener('click', () => scrollTabs('right'))

  function renderTabs() {
    tabsEl.innerHTML = ''
    tpls.forEach((t, i) => {
      const b = document.createElement('button')
      const full = t.name || `模板${i + 1}`
      b.className = 'dsh-recap-tab' + (i === active ? ' active' : '')
      b.textContent = full
      // 视觉上省略，但完整名字留给悬停/读屏，不改用户保存的名称
      b.title = full
      b.setAttribute('aria-label', full)
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', i === active ? 'true' : 'false')
      b.style.background = t.color || COLORS[i % COLORS.length]
      b.onclick = async () => {
        active = i
        renderTabs()
        await saveTpls()
      }
      tabsEl.appendChild(b)
    })
    // 单行横滑：当前标签必须在可视范围内，只动标签条自己的横向滚动
    if (tabsEl.clientWidth) {
      const on = tabsEl.querySelector('.dsh-recap-tab.active')
      if (on) {
        // offsetLeft 是相对面板的，减掉标签条自身位置才是内容坐标
        const pos = on.offsetLeft - tabsEl.offsetLeft
        const left = pos - 10
        const right = pos + on.offsetWidth + 10
        if (left < tabsEl.scrollLeft) tabsEl.scrollLeft = Math.max(0, left)
        else if (right > tabsEl.scrollLeft + tabsEl.clientWidth)
          tabsEl.scrollLeft = right - tabsEl.clientWidth
      }
    }
    updateTabNav()
    syncTemplateGate()
  }

  function renderTplList() {
    listEl.innerHTML = ''
    tpls.forEach((t, i) => {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f7f2e9'
      const dot = document.createElement('span')
      dot.style.cssText = `width:9px;height:9px;border-radius:50%;flex:none;background:${t.color || COLORS[i % COLORS.length]}`
      const name = document.createElement('span')
      name.textContent = t.name || `模板${i + 1}`
      name.style.cssText = 'flex:1;min-width:0;font-size:12px;color:#3a4152;overflow-wrap:anywhere'
      const edit = document.createElement('button')
      edit.textContent = '编辑'
      edit.title = '编辑「' + (t.name || `模板${i + 1}`) + '」的标题和正文'
      edit.dataset.tpledit = String(i)
      edit.style.cssText = 'flex:none;padding:4px 10px;border-radius:7px;border:1px solid #ddd6c9;background:#fff;cursor:pointer;font-size:11px'
      const del = document.createElement('button')
      del.textContent = '删'
      del.dataset.tpldel = String(i)
      del.style.cssText = 'flex:none;padding:4px 8px;border-radius:7px;border:1px solid #f0d7d2;background:#fff;color:#b4553f;cursor:pointer;font-size:11px'
      row.append(dot, name, edit, del)
      listEl.appendChild(row)
    })
  }

  function setStatus(el, msg, isError) {
    if (!el) return
    el.textContent = msg || ''
    el.style.color = isError ? '#b4553f' : '#3f7d4e'
  }
  const tplStatusEl = () => panel.querySelector('.dsh-recap-tplstatus')
  const soundStatusEl = () => panel.querySelector('.dsh-recap-settings-status')
  const setSettingsStatus = (msg, isError) => setStatus(tplStatusEl(), msg, isError)
  const setSoundStatus = (msg, isError) => setStatus(soundStatusEl(), msg, isError)

  // 只滚设置容器，不把宿主页面滚走
  function revealSettingsNode(node) {
    if (!node) return
    requestAnimationFrame(() => {
      const box = settingsScroll.getBoundingClientRect()
      const r = node.getBoundingClientRect()
      if (r.bottom > box.bottom - 6) settingsScroll.scrollTop += r.bottom - (box.bottom - 6)
      else if (r.top < box.top + 6) settingsScroll.scrollTop -= box.top + 6 - r.top
    })
  }

  // 编辑区在设置滚动区里：点编辑后直接把标题和正文输入框带进视野并聚焦
  function revealEditor(target) {
    const run = () => {
      if (!editorEl || editorEl.style.display === 'none') return
      const box = settingsScroll.getBoundingClientRect()
      const ed = editorEl.getBoundingClientRect()
      settingsScroll.scrollTop += ed.top - box.top - 8
      const box2 = settingsScroll.getBoundingClientRect()
      const ta = editorEl.querySelector('[data-tpl=body]')
      const tr = ta.getBoundingClientRect()
      // 正文没露全时再补一点；不把「正在编辑」标题挤出可视区
      if (tr.bottom > box2.bottom - 6 && tr.top < box2.bottom - 6) {
        const need = Math.min(tr.bottom - (box2.bottom - 6), tr.top - box2.top)
        if (need > 0) settingsScroll.scrollTop += need
      }
      try { target.focus({ preventScroll: true }) } catch { target.focus() }
    }
    requestAnimationFrame(() => requestAnimationFrame(run))
  }

  function showEditor(i, focus = 'body') {
    editing = i
    panel.classList.add('editing')
    setSettingsOpen(true)
    const t = tpls[i] || {}
    const name = t.name || `模板${i + 1}`
    editorEl.querySelector('[data-tpl=name]').value = t.name || ''
    editorEl.querySelector('[data-tpl=body]').value = t.body || ''
    editorEl.querySelector('[data-tpl=color]').value = t.color || COLORS[i % COLORS.length]
    const label = editorEl.querySelector('[data-tpl=editing-label]')
    if (label) label.textContent = '正在编辑：' + name
    editorEl.style.display = 'block'
    setSettingsStatus('')
    openPanel()
    const target = editorEl.querySelector(focus === 'name' ? '[data-tpl=name]' : '[data-tpl=body]')
    if (target) revealEditor(target)
  }
  function hideEditor() {
    editorEl.style.display = 'none'
    editing = -1
    panel.classList.remove('editing')
  }

  // 选会话/确认/加载/重试/预览都走同一个主内容区：设置暂时收起，
  // 编辑状态与未保存输入留在原处，回设置时继续编辑。
  function enterFlowView() {
    setSettingsOpen(false)
    panel.classList.remove('editing')
    openPanel()
  }

  // 空模板：眼前提示 + 去编辑，不拉起会话列表，也不调用模型
  function blockEmptyTemplate() {
    if (!templateIsEmpty()) return false
    enterFlowView()
    inviteGen++
    inviteShowing = false
    renderEmptyTemplateBody()
    syncTemplateGate()
    openPanel()
    return true
  }

  const saveTpls = (templates = tpls, activeIdx = active) =>
    POST('/dsh-recap/config', { config: { templates, activeTemplate: activeIdx } })

  async function loadConfig() {
    try {
      const res = await GET('/dsh-recap/config')
      const cfg = res.config || {}
      tpls = Array.isArray(cfg.templates) ? cfg.templates : []
      active = Math.min(Number(cfg.activeTemplate) || 0, Math.max(0, tpls.length - 1))
      const vp = settingsBox.querySelector('[data-k=vaultPath]')
      if (vp) vp.value = cfg.vaultPath || ''
      setCurrentVault(cfg.vaultPath || '')
      const pr = settingsBox.querySelector('[data-k=projectRoot]')
      if (pr) pr.value = cfg.projectRoot || '项目经历'
      const readSel = settingsBox.querySelector('[data-read=default]')
      if (readSel) readSel.value = readScopeDefault
      hasVault = Boolean(cfg.vaultPath)
      setVaultHint('')
      syncSave()
      renderTabs()
      renderTplList()
    } catch {}
  }
  loadConfig()

  // build 比对：页面注入的标识 vs 服务端当前构建，不一致就提示刷新
  async function checkBuild() {
    try {
      const res = await GET('/dsh-recap/config')
      const served = res?.build
      const injected = window.__dshRecapBuild
      if (!needsReload(injected, served)) return
      const head = panel.querySelector('.dsh-recap-head')
      if (!head || panel.querySelector('.dsh-recap-reload')) return
      const bar = document.createElement('div')
      bar.className = 'dsh-recap-reload'
      const banner = bannerFor(injected, served)
      if (!banner) return
      bar.textContent = banner.text
      bar.style.cssText = 'font-size:12px;line-height:1.5;padding:8px 14px;background:#fff4e5;color:#8a5a00;border-bottom:1px solid #f0dcc0'
      head.insertAdjacentElement('afterend', bar)
      buildBlocked = true
      for (const sel of ['[data-act=summary]', '[data-act=save]', '[data-act=confirmYes]']) {
        const el = panel.querySelector(sel)
        if (el) el.disabled = true
      }
    } catch {}
  }
  checkBuild()
  { const cb = settingsBox.querySelector('[data-sound=on]')
    const vol = settingsBox.querySelector('[data-sound=vol]')
    if (cb) cb.checked = soundPrefs.on
    if (vol) vol.value = String(Math.round(soundPrefs.volume * 100)) }

  // 插件被禁用时立刻消失：服务端挂起 8 秒，禁用后立刻回 410
  let stopped = false
  const inflight = new AbortController()
  async function watchLifecycle() {
    while (!stopped) {
      try {
        const res = await fetch('/dsh-recap/ping', { cache: 'no-store', signal: inflight.signal })
        if (res.status === 410) return destroy()
      } catch {
        if (stopped) return
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  watchLifecycle()

  setTimeout(() => {
    if (!document.getElementById('dsh-recap-btn')) console.error('[dsh-recap] mount failed: 按钮没进 DOM')
  }, 2000)

  function destroy() {
    stopped = true
    try { obs.disconnect() } catch {}
    clearInterval(themeTimer)
    if (catTimer) clearInterval(catTimer)
    window.removeEventListener('pointerdown', onActivity)
    window.removeEventListener('keydown', onActivity)
    document.removeEventListener('visibilitychange', onVisibility)
    try { ro?.disconnect() } catch {}
    window.removeEventListener('resize', reposition)
    try {
      inflight.abort()
    } catch {}
    for (const node of [btn, panel, tail]) node?.remove()
    for (const el of document.querySelectorAll('style')) {
      if (el.textContent?.includes('#dsh-recap-panel')) el.remove()
    }
    window.__dshRecapMounted = false
    window.__dshRecapToken = undefined
  }

  settingsBox.addEventListener('input', (e) => {
    const k = e.target?.dataset?.sound
    if (k === 'on') soundPrefs.on = e.target.checked
    if (k === 'vol') soundPrefs.volume = Number(e.target.value) / 100
    localStorage.setItem('dsh-recap-sound', soundPrefs.on ? '1' : '0')
    localStorage.setItem('dsh-recap-vol', String(soundPrefs.volume))

    // 打字 → 清掉候选选中（互斥），但不在这里校验，避免边打边报"目录不存在"
    if (e.target?.dataset?.k === 'vaultPath') {
      vaultPick.typed(e.target.value)
      renderVaults(currentCandidates)
    }
    if (e.target?.dataset?.tpl === 'name') {
      const label = editorEl.querySelector('[data-tpl=editing-label]')
      if (label) label.textContent = '正在编辑：' + (e.target.value.trim() || `模板${editing + 1}`)
    }
  })

  settingsBox.addEventListener('change', (e) => {
    if (e.target?.dataset?.read === 'default') {
      readScopeDefault = ['ask', 'recent', 'all'].includes(e.target.value) ? e.target.value : 'ask'
      localStorage.setItem('dsh-recap-read-scope', readScopeDefault)
    }
  })

  panel.querySelector('.dsh-recap-x').onclick = () => closePanel()

  function flash(msg) {
    bodyEl.className = 'dsh-recap-body'
    bodyEl.textContent = msg
    openPanel()
    setTimeout(() => {
      if (bodyEl.textContent === msg) bodyEl.textContent = ''
    }, 2000)
  }

  const flow = createFlow()
  const vaultPick = createVaultPick()
  let currentCandidates = []
  let pickedSession = null
  // 用户眼前这一稿的标识：保存时必须原样送回，旧稿不能被悄悄换成新稿
  let previewId = ''
  let previewMarkdown = ''
  // 预览显示方式：preview = 按 Markdown 排版，source = 原始 Markdown
  let previewView = 'preview'
  // 长对话被压缩时，服务端会把说明带回来，在预览上方原样告诉用户
  let previewNotice = ''
  // 这稿是怎么读出来的：recent / all / direct；决定要不要给「改用完整读取」
  let previewScope = ''
  // 模型单次输出触顶：保留「继续写」入口，不假称完成
  let previewTruncated = false
  let previewChunks = 0
  // 非阻塞错误（继续写失败、复制失败），与正文分开显示
  let previewError = ''
  // 上一次保存可能已落盘但没收到回执：重试时不能把 NO_PREVIEW 当成普通失败
  let saveUncertain = false

  /** 「当前生效」只反映磁盘上的值，不随输入框变化 */
  function setCurrentVault(path) {
    const el = panel.querySelector('.dsh-recap-current')
    if (el) el.textContent = '当前生效：' + (path || '尚未设置')
  }

  /** 无库点保存时的引导：只在设置里显示，不覆盖主区原稿 */
  function setVaultHint(msg) {
    const el = panel.querySelector('[data-vault-hint]')
    if (el) el.textContent = msg || ''
  }

  /** 源码/预览开关：单独一行，没提醒条时也可见；设置让位时跟着隐藏。 */
  function syncViewBar() {
    if (!viewBar) return
    const show =
      Boolean(previewMarkdown) &&
      !summarizing &&
      !choosingScope &&
      !inviteShowing &&
      !settingsOpen()
    viewBar.hidden = !show
    if (!show || !viewBtn) return
    const source = previewView === 'source'
    viewBtn.textContent = source ? '预览' : '源码'
    viewBtn.title = source ? '按 Markdown 预览' : '查看原始 Markdown'
    viewBtn.setAttribute('aria-pressed', source ? 'true' : 'false')
    viewBtn.setAttribute('aria-label', source ? '切换到预览' : '切换到源码')
  }

  function hideNoticeBar() {
    if (noticeBar) noticeBar.hidden = true
    syncViewBar()
  }

  /** 预览上方的持续提醒、读取说明、继续写/完整读取入口；设置打开时由 CSS 整体隐藏 */
  function renderNoticeBar() {
    if (!previewMarkdown || summarizing || choosingScope || !noticeBar) {
      hideNoticeBar()
      return
    }
    unsavedEl.hidden = hasVault
    unsavedEl.textContent = hasVault ? '' : T.previewUnsaved
    trimEl.hidden = !previewNotice
    trimEl.textContent = previewNotice || ''
    truncatedEl.hidden = !previewTruncated
    truncatedEl.textContent = previewTruncated ? T.truncated : ''
    fullBtn.hidden = !(previewScope === 'recent' && previewNotice)
    continueBtn.hidden = !previewTruncated
    noticeErrorEl.textContent = previewError || ''
    const any =
      !unsavedEl.hidden ||
      !trimEl.hidden ||
      !truncatedEl.hidden ||
      !fullBtn.hidden ||
      !continueBtn.hidden ||
      Boolean(previewError)
    noticeBar.hidden = !any
    syncViewBar()
  }

  // 候选库 = 单选组：点=只选中并填进路径框；「用这个库」才校验写配置
  function renderVaults(list) {
    currentCandidates = list || []
    const box = panel.querySelector('.dsh-recap-vaults')
    if (!box) return
    box.innerHTML = ''

    // 渲染不产生副作用：默认选中由调用方（detect）通过 ensureSelected 显式完成
    const selected = vaultPick.state().selected

    if (!currentCandidates.length) {
      const p = document.createElement('div')
      p.textContent = '没找到 Obsidian 库'
      p.style.cssText = 'font-size:12px;color:#8a90a0;margin:4px 0'
      const manual = document.createElement('button')
      manual.textContent = '手动填写路径'
      manual.dataset.act = 'manual'
      manual.style.cssText = 'padding:4px 10px;border-radius:7px;border:1px solid #ddd6c9;background:#fff;cursor:pointer;font-size:11px'
      box.append(p, manual)
    } else {
      const group = document.createElement('div')
      group.setAttribute('role', 'radiogroup')
      for (const v of currentCandidates) {
        const on = selected && selected.path === v.path
        const row = document.createElement('div')
        row.setAttribute('role', 'radio')
        row.setAttribute('aria-checked', String(Boolean(on)))
        row.style.cssText =
          'display:flex;align-items:center;gap:8px;margin:3px 0;padding:6px 9px;border-radius:8px;cursor:pointer;font-size:12px;' +
          (on ? 'border:1px solid #3b6cf6;background:#eaf0ff;' : 'border:1px solid #e6e1d8;background:#fff;')
        row.onmouseenter = () => {
          if (!on) row.style.background = '#f5f7fb'
        }
        row.onmouseleave = () => {
          if (!on) row.style.background = '#fff'
        }
        const dot = document.createElement('span')
        dot.style.cssText =
          'flex:none;width:14px;height:14px;border-radius:50%;box-sizing:border-box;' +
          (on ? 'border:4px solid #3b6cf6;background:#fff;' : 'border:1.5px solid #b9bfcc;background:#fff;')
        const label = document.createElement('span')
        label.textContent = v.name + (v.open ? '（最近打开）' : '')
        label.style.flex = '1'
        row.append(dot, label)
        row.onclick = () => {
          vaultPick.select(v)
          const vpEl = settingsBox.querySelector('[data-k=vaultPath]')
          if (vpEl) vpEl.value = v.path
          renderVaults(currentCandidates)
          openPanel()
        }
        group.appendChild(row)
      }
      box.appendChild(group)
    }

    const use = document.createElement('button')
    use.textContent = '用这个库'
    use.dataset.act = 'usevault'
    use.disabled = !vaultPick.canConfirm()
    use.style.cssText =
      'margin-top:6px;padding:6px 12px;border-radius:8px;font-size:12px;' +
      (vaultPick.canConfirm()
        ? 'border:1px solid #3b6cf6;background:#3b6cf6;color:#fff;cursor:pointer;'
        : 'border:1px solid #d8d3c8;background:#efece5;color:#9a958a;cursor:not-allowed;')
    box.appendChild(use)

    const st = vaultPick.state()
    if (st.receipt || st.error) {
      const line = document.createElement('div')
      line.textContent = st.receipt || st.error
      line.style.cssText = `font-size:12px;margin-top:6px;color:${st.error ? '#b4553f' : '#3f7d4e'}`
      box.appendChild(line)
    }
  }

  async function fetchSessions() {
    return readSessions(GET, (error) =>
      console.warn('[dsh-recap] sessions', error?.status || 'network', String(error?.message ?? error).slice(0, 200)),
    )
  }

  function renderListProblem(title, hint, retry) {
    inviteShowing = true
    bodyEl.className = 'dsh-recap-body'
    bodyEl.textContent = ''
    hideNoticeBar()
    const t1 = document.createElement('div')
    t1.textContent = title
    const t2 = document.createElement('div')
    t2.textContent = hint
    t2.style.cssText = 'color:#8a90a0;margin-top:2px'
    const again = document.createElement('button')
    again.textContent = '重试'
    again.style.marginTop = '6px'
    again.onclick = retry
    bodyEl.append(t1, t2, again)
    openPanel()
  }

  function renderSessionConfirm(item) {
    inviteShowing = true
    bodyEl.className = 'dsh-recap-body'
    bodyEl.textContent = ''
    hideNoticeBar()
    const line = document.createElement('div')
    line.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center'
    const text = document.createElement('span')
    text.textContent = T.confirm + item.title + ' · ' + (item.turns ?? '?') + ' ' + T.turns
    text.style.cssText = 'flex:1;min-width:170px'
    const yes = document.createElement('button')
    yes.textContent = T.confirmIt
    yes.dataset.act = 'confirmYes'
    yes.className = 'primary'
    const other = document.createElement('button')
    other.textContent = T.changeOne
    other.dataset.act = 'confirmPick'
    line.append(text, yes, other)
    bodyEl.appendChild(line)
    openPanel()
  }

  function renderSessionList(items, title, hint) {
    inviteShowing = true
    bodyEl.className = 'dsh-recap-body'
    bodyEl.textContent = ''
    hideNoticeBar()
    // 选择列表打开时不允许保存旧预览
    saveBtn.disabled = true
    const tl = document.createElement('div')
    tl.textContent = title || T.listTitle
    tl.style.cssText = 'margin-bottom:4px'
    bodyEl.appendChild(tl)
    if (hint) {
      const sub = document.createElement('div')
      sub.textContent = hint
      sub.style.cssText = 'color:#8a90a0;margin-bottom:4px'
      bodyEl.appendChild(sub)
    }
    for (const it of items) {
      const b = document.createElement('button')
      b.textContent = it.title + ' · ' + (it.turns ?? '?') + ' ' + T.turns
      b.style.cssText = 'display:block;width:100%;box-sizing:border-box;text-align:left;margin:4px 0;padding:6px 9px;border:1px solid #e6e1d8;border-radius:8px;background:#fff;cursor:pointer;font-size:12px;white-space:normal;overflow-wrap:anywhere'
      b.onclick = () => {
        // 列表可能是切到空模板之前留下的：点击也不能进入确认
        if (blockEmptyTemplate()) return
        pickedSession = it.sessionId
        flow.pick(it.sessionId)
        renderSessionConfirm(it)
      }
      bodyEl.appendChild(b)
    }
    openPanel()
  }

  async function showConfirm() {
    if (blockEmptyTemplate()) return
    const gen = ++inviteGen
    inviteShowing = true
    enterFlowView()
    bodyEl.className = 'dsh-recap-body'
    bodyEl.textContent = ''
    hideNoticeBar()
    saveBtn.disabled = true
    openPanel()
    const list = await fetchSessions()
    // 等待期间切到空模板：本次邀请已作废，旧响应不能把列表/确认画回来
    if (gen !== inviteGen) return
    if (templateIsEmpty()) return withdrawInvite()
    const choice = sessionChoice(list)
    if (choice.mode === 'retry') {
      return renderListProblem(T.noListTitle, T.noListHint, () => showConfirm())
    }
    if (choice.mode === 'empty') {
      return renderListProblem(T.emptyListTitle, T.emptyListHint, () => showConfirm())
    }
    if (choice.mode === 'pick') {
      // 没有活跃会话：必须由用户点一条，不默认取最近的那条，也不因为只剩一条就自动用
      return renderSessionList(choice.items, T.pickTitle, T.pickHint)
    }
    pickedSession = choice.selected
    flow.pick(pickedSession)
    renderSessionConfirm(choice.item)
  }

  async function showPicker() {
    if (blockEmptyTemplate()) return
    const gen = ++inviteGen
    inviteShowing = true
    enterFlowView()
    bodyEl.className = 'dsh-recap-body'
    bodyEl.textContent = ''
    hideNoticeBar()
    const list = await fetchSessions()
    // 同 showConfirm：切空模板后，在途列表不能再恢复选择流程
    if (gen !== inviteGen) return
    if (templateIsEmpty()) return withdrawInvite()
    const choice = sessionChoice(list)
    if (choice.mode === 'retry') {
      return renderListProblem(T.noListTitle, T.noListHint, () => showPicker())
    }
    if (choice.mode === 'empty') {
      return renderListProblem(T.emptyListTitle, T.emptyListHint, () => showPicker())
    }
    renderSessionList(choice.items, T.listTitle)
  }

  /** 主内容区恢复当前待保存稿：正文在 body，提醒/说明/后续入口在正文上方 */
  function renderPreviewBody() {
    bodyEl.className = 'dsh-recap-body'
    bodyEl.textContent = ''
    emptyBodyNode = null
    if (previewView === 'source') {
      // 源码态：原文只读，保留空白与换行，不经过任何 Markdown 转换
      const pre = document.createElement('pre')
      pre.className = 'dsh-recap-src'
      pre.textContent = previewMarkdown
      bodyEl.appendChild(pre)
    } else if (previewMarkdown) {
      // 渲染器先转义再加标签，返回的是安全 HTML，模型原文不会直接进 innerHTML
      const md = document.createElement('div')
      md.className = 'dsh-recap-md'
      md.innerHTML = renderMarkdown(previewMarkdown)
      bodyEl.appendChild(md)
    }
    if (copyBtn) copyBtn.textContent = '复制'
    renderNoticeBar()
  }

  /** 长对话选择读取范围：画在现有主内容区，不新开窗口；选中即开始生成 */
  function renderScopeChoice(sessionId, stats) {
    inviteShowing = false
    choosingScope = true
    bodyEl.className = 'dsh-recap-body'
    bodyEl.textContent = ''
    hideNoticeBar()
    const title = document.createElement('div')
    title.className = 'dsh-recap-scope-title'
    title.textContent = T.needScopeTitle
    const list = document.createElement('div')
    list.className = 'dsh-recap-scope'
    const make = (label, hint, scope) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.scope = scope
      const l = document.createElement('span')
      l.className = 'label'
      l.textContent = label
      const s = document.createElement('span')
      s.className = 'sub'
      s.textContent = hint
      b.append(l, s)
      b.onclick = () => {
        scopeBySession.set(sessionId, scope)
        choosingScope = false
        doSummary(sessionId, { scope })
      }
      return b
    }
    list.append(
      make(T.scopeRecent, T.scopeRecentHint, 'recent'),
      make(T.scopeAll, T.scopeAllHint, 'all'),
    )
    const foot = document.createElement('div')
    foot.className = 'foot'
    foot.textContent = T.scopeFootnote
    if (stats && Number.isFinite(stats.turns)) {
      foot.textContent += `（这次约 ${stats.turns} 轮 / ${stats.asks ?? '?'} 条诉求）`
    }
    list.appendChild(foot)
    bodyEl.append(title, list)
    syncSave()
    syncTemplateGate()
    openPanel()
  }

  async function doSummary(sessionId, opts = {}) {
    if (blockEmptyTemplate()) return
    inviteGen++
    inviteShowing = false
    // 没有明确选择就不调用模型：先把选择入口亮出来
    if (!sessionId) return showPicker()
    const remembered = scopeBySession.get(sessionId) || ''
    let scope = opts.scope || remembered
    let byDefault = false
    if (!scope && readScopeDefault !== 'ask' && !opts.continueFrom) {
      scope = readScopeDefault
      byDefault = true
    }
    enterFlowView()
    choosingScope = false
    summarizing = true
    previewError = ''
    bodyEl.className = 'dsh-recap-body'
    bodyEl.textContent = opts.continueFrom
      ? T.readingContinue
      : scope === 'all'
        ? (byDefault ? T.readingAllDefault : T.readingAll)
        : scope === 'recent'
          ? (byDefault ? T.readingRecentDefault : T.readingRecent)
          : T.saving
    hideNoticeBar()
    saveBtn.disabled = true
    syncTemplateGate()
    openPanel()
    let res
    try {
      res = await POST('/dsh-recap/summary', {
        sessionId,
        ...(scope ? { scope } : {}),
        ...(opts.continueFrom ? { continueFrom: opts.continueFrom } : {}),
      })
    } catch {
      res = { ok: false, error: '网络错误，请重试' }
    }
    summarizing = false

    if (!res.ok && res.code === 'NEED_SCOPE' && !scope && !opts.continueFrom) {
      // 首次请求只判断长度，没有调用模型；按设置默认或让用户选。
      if (readScopeDefault !== 'ask') {
        return doSummary(sessionId, { scope: readScopeDefault, byDefault: true })
      }
      return renderScopeChoice(sessionId, res.stats)
    }

    if (!res.ok) {
      // 续写失败时保留眼前这稿；普通生成失败仍按原规则清掉看不见的旧稿。
      if (opts.continueFrom && previewId) {
        if (res.code === 'PREVIEW_STALE' || res.code === 'NO_PREVIEW') {
          // 服务端已经没有这一稿：不能再让同一 previewId 反复 POST
          previewId = ''
          previewTruncated = false
          previewError = (res.error || '这稿已不在待续写队列') + '\n请重新生成后再续写。'
        } else {
          previewError = '继续写失败：' + (res.error || '未知错误')
        }
        renderPreviewBody()
        syncSave()
        syncTemplateGate()
        return openPanel()
      }
      previewId = ''
      previewMarkdown = ''
      previewView = 'preview'
      previewNotice = ''
      previewScope = ''
      previewTruncated = false
      previewChunks = 0
      previewError = ''
      saveUncertain = false
      flow.saved()
      bodyEl.className = 'dsh-recap-body dsh-recap-err'
      bodyEl.textContent = '失败：' + (res.error || '未知错误')
      hideNoticeBar()
      syncSave()
      syncTemplateGate()
      return openPanel()
    }

    pickedSession = res.sessionId || sessionId
    previewId = res.previewId || ''
    previewMarkdown = res.markdown || ''
    // 新生成 / 重新生成回到预览；继续写保持用户当前的源码或预览视图
    if (!opts.continueFrom) previewView = 'preview'
    previewNotice = res.trimNotice || res.meta?.trimNotice || ''
    previewScope = res.scope || scope || ''
    previewTruncated = Boolean(res.truncated)
    previewChunks = Number(res.chunks) || 0
    previewError = ''
    saveUncertain = false
    flow.summaryDone(pickedSession)
    renderPreviewBody()
    syncSave()
    syncTemplateGate()
    clearBtn.disabled = false
    openPanel()
  }

  panel.addEventListener('click', async (e) => {
    const t = e.target
    const act = t?.dataset?.act
    const editIdx = t?.dataset?.tpledit
    const delIdx = t?.dataset?.tpldel

    if (editIdx !== undefined) return showEditor(Number(editIdx))

    if (delIdx !== undefined) {
      if (tpls.length <= 1) {
        setSettingsStatus('至少保留一个模板。', true)
        return revealSettingsNode(tplStatusEl())
      }
      tpls.splice(Number(delIdx), 1)
      if (active >= tpls.length) active = Math.max(0, tpls.length - 1)
      hideEditor()
      await saveTpls()
      renderTabs()
      renderTplList()
      return openPanel()
    }

    if (!act) return
    if (act === 'close') return closePanel()

    if (act === 'settings') {
      const opening = !settingsOpen()
      setSettingsOpen(opening)
      if (opening) {
        renderTplList()
        // 从总结流程回来时，未保存的模板编辑继续留在原处
        if (editing >= 0) {
          editorEl.style.display = 'block'
          panel.classList.add('editing')
        }
      } else {
        // 只收起编辑区外观：正在编辑的模板与未保存输入留在原处，重新打开可继续
        editorEl.style.display = 'none'
        panel.classList.remove('editing')
      }
      return openPanel()
    }

    if (act === 'goedit') return showEditor(active)

    if (act === 'detect') {
      const box = panel.querySelector('.dsh-recap-vaults')
      box.textContent = '正在找…'
      try {
        const res = await GET('/dsh-recap/vaults')
        const list = res.candidates || []
        // 默认选中第一条只在这里做（渲染保持无副作用）
        vaultPick.ensureSelected(list)
        const picked = vaultPick.state().selected
        const vpEl = settingsBox.querySelector('[data-k=vaultPath]')
        if (picked && vpEl) vpEl.value = picked.path
        renderVaults(list)
      } catch {
        box.textContent = '检测失败，请手动填写路径。'
      }
      return openPanel()
    }

    if (act === 'manual') {
      const vp = settingsBox.querySelector('[data-k=vaultPath]')
      vp.focus()
      vp.select?.()
      return
    }

    if (act === 'usevault') {
      const picked = vaultPick.current()
      if (!picked) return
      const chk = await POST('/dsh-recap/vault/check', { path: picked.path })
      if (!chk.ok) {
        const reason = chk.reason || '这个目录不能写'
        const extra =
          reason.includes('目录不存在')
            ? '：检查路径是否指向含 .obsidian 的文件夹'
            : reason.includes('.obsidian')
              ? '：检查路径是否指向 Obsidian 库根目录'
              : ''
        vaultPick.fail(reason + extra)
        return renderVaults(currentCandidates)
      }
      const saveRes = await POST('/dsh-recap/config', {
        config: {
          vaultPath: picked.path,
          projectRoot: settingsBox.querySelector('[data-k=projectRoot]').value.trim() || '项目经历',
        },
      })
      if (!saveRes.ok) {
        vaultPick.fail(saveRes.error || '保存失败')
        return renderVaults(currentCandidates)
      }
      vaultPick.confirm(picked.name || picked.path)
      settingsBox.querySelector('[data-k=vaultPath]').value = picked.path
      setCurrentVault(picked.path)
      setVaultHint('')
      hasVault = true
      renderNoticeBar()
      syncSave()
      // 回执只由 renderVaults 渲染一处，避免重复
      return renderVaults(currentCandidates)
    }

    if (act === 'savecfg') {
      const res = await POST('/dsh-recap/config', {
        // 只写与库无关的设置；库路径唯一入口是「用这个库」
        config: {
          projectRoot: settingsBox.querySelector('[data-k=projectRoot]').value.trim() || '项目经历',
        },
      })
      setSoundStatus(res.ok ? '其他设置已保存。' : '保存失败：' + (res.error || ''), !res.ok)
      return revealSettingsNode(soundStatusEl())
    }

    if (act === 'tplsave') {
      if (editing < 0) return
      const idx = editing
      const name = editorEl.querySelector('[data-tpl=name]').value.trim() || `模板${idx + 1}`
      const bodyTpl = editorEl.querySelector('[data-tpl=body]').value
      const color = editorEl.querySelector('[data-tpl=color]').value
      const next = tpls.map((t, i) => (i === idx ? { ...(t || {}), name, body: bodyTpl, color } : t))
      let res
      try {
        res = await saveTpls(next)
      } catch {
        res = { ok: false, error: '网络错误，请重试' }
      }
      // 写盘失败不改本地模板：总结能力按上一次成功保存的内容算
      if (!res?.ok) {
        setSettingsStatus('模板保存失败：' + (res?.error || '请重试'), true)
        syncTemplateGate()
        return revealSettingsNode(tplStatusEl())
      }
      tpls = next
      syncTemplateGate()
      hideEditor()
      renderTabs()
      renderTplList()
      setSettingsStatus('模板已保存。', false)
      return revealSettingsNode(tplStatusEl())
    }

    if (act === 'tplnew') {
      if (tpls.length >= 6) {
        setSettingsStatus('最多 6 个模板。', true)
        return revealSettingsNode(tplStatusEl())
      }
      tpls.push({ name: `模板${tpls.length + 1}`, body: '' })
      active = tpls.length - 1
      syncTemplateGate()
      await saveTpls()
      renderTabs()
      renderTplList()
      return showEditor(active, 'name')
    }

    if (act === 'tpldel') {
      if (editing < 0) return
      if (tpls.length <= 1) {
        setSettingsStatus('至少保留一个模板。', true)
        return revealSettingsNode(tplStatusEl())
      }
      tpls.splice(editing, 1)
      active = Math.max(0, Math.min(editing, tpls.length - 1))
      syncTemplateGate()
      hideEditor()
      await saveTpls()
      renderTabs()
      renderTplList()
      return openPanel()
    }

    if (act === 'clear') {
      inviteGen++
      inviteShowing = false
      choosingScope = false
      bodyEl.textContent = ''
      previewId = ''
      previewMarkdown = ''
      previewView = 'preview'
      previewNotice = ''
      previewScope = ''
      previewTruncated = false
      previewChunks = 0
      previewError = ''
      saveUncertain = false
      hideNoticeBar()
      // 预览状态一并清掉：之后开关设置不能把保存按钮复原成「能存空稿」
      flow.saved()
      saveBtn.disabled = true
      regenBtn.disabled = true
      clearBtn.disabled = true
      syncTemplateGate()
      return openPanel()
    }

    if (act === 'toggle-view') {
      if (!previewMarkdown) return
      // 只换显示；previewId、previewMarkdown、保存状态都不动，也不发请求
      const top = bodyEl.scrollTop
      previewView = previewView === 'preview' ? 'source' : 'preview'
      renderPreviewBody()
      bodyEl.scrollTop = Math.min(top, Math.max(0, bodyEl.scrollHeight - bodyEl.clientHeight))
      return openPanel()
    }

    if (act === 'copy') {
      if (!previewMarkdown) return
      const ok = await copyRaw(previewMarkdown)
      if (ok) {
        copyBtn.textContent = T.copied
        setTimeout(() => {
          copyBtn.textContent = '复制'
        }, 1500)
      } else {
        previewError = T.copyFailed
        selectBodyText()
        renderNoticeBar()
      }
      return openPanel()
    }

    if (act === 'usefull') {
      const sid = flow.state().preview || pickedSession
      if (!sid || !previewMarkdown) return
      // 同一会话记住「读全部」：之后重新生成不再问
      scopeBySession.set(sid, 'all')
      return doSummary(sid, { scope: 'all' })
    }

    if (act === 'continue') {
      const sid = flow.state().preview || pickedSession
      if (!sid || !previewId || !previewTruncated) return
      return doSummary(sid, { continueFrom: previewId, scope: previewScope })
    }

    if (act === 'summary' || act === 'regen') return showConfirm()
    if (act === 'confirmYes') {
      // 从确认到生成之间可能刚切到空模板：旧确认也不能调用模型
      if (blockEmptyTemplate()) return
      if (!pickedSession) return showPicker()
      return doSummary(pickedSession)
    }
    if (act === 'confirmPick') return showPicker()

    if (act === 'save') {
      if (!hasVault) {
        // 无库只挡保存：打开设置选库，原稿和 previewId 都留在原地
        setSettingsOpen(true)
        setVaultHint(T.saveNeedVault)
        renderTplList()
        openPanel()
        const vp = settingsBox.querySelector('[data-k=vaultPath]')
        if (vp) revealSettingsNode(vp)
        return
      }
      if (!flow.canSave()) return flash(flow.hint())
      saveBtn.disabled = true
      // runSave 会接住断网/响应解析失败：保留原稿，返回是否还能重试，绝不把按钮卡死
      const result = await runSave({
        post: POST,
        sessionId: flow.state().preview,
        previewId,
        previewMarkdown,
        uncertain: saveUncertain,
        toText: mdToText,
      })
      saveUncertain = result.uncertain
      if (result.action === 'saved') {
        previewId = ''
        previewMarkdown = ''
        previewView = 'preview'
        previewNotice = ''
        previewScope = ''
        previewTruncated = false
        previewChunks = 0
        previewError = ''
        saveUncertain = false
        hideNoticeBar()
        bodyEl.className = 'dsh-recap-body'
        bodyEl.textContent = '已写入：\n' + result.file
        flow.saved()
        syncSave()
        saveBtn.disabled = true
        syncTemplateGate()
        return openPanel()
      }
      hideNoticeBar()
      bodyEl.className = 'dsh-recap-body'
      bodyEl.textContent = result.message
      // 过期、或上次结果不明且服务端已没有这稿：别再让同一份稿反复 POST
      if (result.action === 'stale' || result.action === 'already' || result.action === 'no-preview') {
        previewId = ''
        saveBtn.disabled = true
        syncTemplateGate()
        return openPanel()
      }
      // 网络失败或写盘失败：原预览和按钮都留着，直接再点一次，不重新调模型
      saveBtn.disabled = !result.canRetry
      return openPanel()
    }
  })
})()
