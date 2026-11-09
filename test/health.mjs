// 防白屏检查：确认 ui.js / flow.js / strings.js 都能按 module 加载，
// 并且 ui.js 里每个 import 的落点都返回 200。
// 端口来自 DSH_WEB_PORT 或第一个命令行参数；都没有就打印 skipped 退出 0。
// 用 node:http + 不保活连接，避免 process.exit 与 undici 在 Windows 上的句柄竞争。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const port = process.env.DSH_WEB_PORT || process.argv[2]
if (!port) {
  console.log('skipped: 没有端口（设置 DSH_WEB_PORT 或传参）')
  process.exitCode = 0
} else {
  const agent = new http.Agent({ keepAlive: false })

  const get = (url) =>
    new Promise((resolve, reject) => {
      const req = http.get(url, { agent }, (res) => {
        res.resume()
        res.on('end', () =>
          resolve({ status: res.statusCode, type: res.headers['content-type'] || '' }),
        )
      })
      req.on('error', reject)
    })

  const post = (url) =>
    new Promise((resolve, reject) => {
      const req = http.request(url, { method: 'POST', agent, headers: { 'content-type': 'application/json' } }, (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode }))
      })
      req.on('error', reject)
      req.end('{}')
    })

  const base = `http://127.0.0.1:${port}`
  let failed = false

  const check = async (url) => {
    try {
      const res = await get(url)
      const ok = res.status === 200 && String(res.type).startsWith('text/javascript')
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${url} → ${res.status} ${res.type}`)
      if (!ok) failed = true
    } catch (error) {
      console.log(`FAIL ${url} → ${error.message}`)
      failed = true
    }
  }

  for (const p of ['/dsh-recap/ui.js', '/dsh-recap/flow.js', '/dsh-recap/strings.js', '/dsh-recap/markdown.js']) {
    await check(base + p)
  }

  const ui = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'ui.js'), 'utf8')
  for (const match of ui.matchAll(/^import .* from '(.+?)'/gm)) {
    await check(new URL(match[1], base + '/dsh-recap/ui.js').toString())
  }

  // 巡逻：无口令一律拒绝（以后谁忘了加 guard，这里当场红）
  for (const p of ['/dsh-recap/config', '/dsh-recap/vaults', '/dsh-recap/sessions']) {
    try {
      const res = await get(base + p)
      const ok = res.status === 403
      console.log(`${ok ? 'ok  ' : 'FAIL'} 无口令 GET ${p} → ${res.status}（应 403）`)
      if (!ok) failed = true
    } catch (e) { console.log('FAIL', p, e.message); failed = true }
  }
  for (const p of ['/dsh-recap/summary', '/dsh-recap/save']) {
    try {
      const res = await post(base + p)
      const ok = res.status === 403
      console.log(`${ok ? 'ok  ' : 'FAIL'} 无口令 POST ${p} → ${res.status}（应 403）`)
      if (!ok) failed = true
    } catch (e) { console.log('FAIL', p, e.message); failed = true }
  }

  agent.destroy()
  console.log(failed ? 'health FAILED' : 'health ok')
  process.exitCode = failed ? 1 : 0
}
