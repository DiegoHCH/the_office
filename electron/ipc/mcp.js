// Servidores MCP por perfil.
//
// Se listan leyendo el .claude.json del perfil —rápido y sin health-check— pero
// se agregan y se quitan por CLI, para respetar la semántica de scopes de Claude
// Code en vez de reimplementarla escribiendo el archivo a mano.
const fs = require('node:fs')
const path = require('node:path')
const { ipcMain, app } = require('electron')

function registra({ CLAUDE_BIN, claudeEnvFor, execFileP, PROFILE_DIRS }) {
  // ── Servidores MCP por perfil ────────────────────────────────────────────────
  // Lista desde el .claude.json del perfil (rápido, sin health-check); agrega y
  // quita vía CLI para respetar la semántica de scopes de Claude Code.
  ipcMain.handle('mcp:list', (_e, profile) => {
    try {
      const dir = PROFILE_DIRS[profile] ? PROFILE_DIRS[profile]() : path.join(app.getPath('home'), '.claude')
      const j = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'))
      const servers = Object.entries(j.mcpServers || {}).map(([name, s]) => ({
        name,
        spec: s.url || [s.command, ...(s.args || [])].join(' '),
      }))
      return { ok: true, servers }
    } catch {
      return { ok: true, servers: [] }
    }
  })

  // Lo que ve el CLI completo (incluye los conectores de la cuenta claude.ai y
  // cualquier server configurado desde la terminal). Lento: hace health-check.
  ipcMain.handle('mcp:account', async (_e, profile) => {
    try {
      const out = await execFileP(CLAUDE_BIN, ['mcp', 'list'], { env: claudeEnvFor(profile), timeout: 45000, maxBuffer: 4 * 1024 * 1024 })
      const servers = []
      for (const line of String(out).split('\n')) {
        const m = /^(.+?):\s+(\S+)\s+-\s+(.+)$/.exec(line.trim())
        if (m) servers.push({ name: m[1].trim(), target: m[2], status: m[3].trim() })
      }
      return { ok: true, servers }
    } catch (err) {
      return { ok: false, error: String(err.message || '').slice(0, 200) }
    }
  })

  ipcMain.handle('mcp:add', async (_e, { profile, name, url, cmd, env }) => {
    if (!/^[\w.-]{1,40}$/.test(name || '')) return { ok: false, error: 'Nombre inválido' }
    const args = ['mcp', 'add', '-s', 'user']
    if (url) args.push('--transport', 'http', name, url)
    else if (Array.isArray(cmd) && cmd.length) {
      args.push(name)
      // variables de entorno del server (API keys): -e KEY=valor
      for (const kv of Array.isArray(env) ? env : []) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=.+$/.test(kv)) args.push('-e', kv)
      }
      args.push('--', ...cmd)
    } else return { ok: false, error: 'Falta el comando o la URL' }
    try {
      await execFileP(CLAUDE_BIN, args, { env: claudeEnvFor(profile), timeout: 60000 })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('mcp:remove', async (_e, { profile, name }) => {
    if (!/^[\w.-]{1,40}$/.test(name || '')) return { ok: false, error: 'Nombre inválido' }
    try {
      await execFileP(CLAUDE_BIN, ['mcp', 'remove', '-s', 'user', name], { env: claudeEnvFor(profile), timeout: 60000 })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

module.exports = { registra }
