/** 找 Obsidian 库：读 Obsidian 自己的注册表，找不到就让用户手填。 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function registryPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'obsidian', 'obsidian.json')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json')
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'obsidian', 'obsidian.json')
}

/** 返回 [{ path, name, open }]，读不到返回 []。 */
export function candidateVaults() {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath(), 'utf8'))
    const vaults = raw?.vaults ?? {}
    return Object.values(vaults)
      .filter((v) => v && typeof v.path === 'string')
      .map((v) => ({ path: v.path, name: path.basename(v.path), open: Boolean(v.open) }))
  } catch {
    return []
  }
}

/** 哪个库上次开着（Obsidian 里 open: true 的那个）。 */
export function lastOpenedVault() {
  const list = candidateVaults()
  return list.find((v) => v.open)?.path ?? null
}
