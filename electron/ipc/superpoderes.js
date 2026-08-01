// Superpoderes de cada perfil: skills y plugins de Claude Code.
//
// Van juntos porque son la misma idea —cosas que se instalan en el
// CLAUDE_CONFIG_DIR del perfil y que los agentes headless usan solos, sin que
// nadie se las tenga que pedir— y porque se gestionan igual: el catálogo se lee,
// pero instalar y desinstalar pasa por el CLI para no reimplementar su semántica.
//
// `skillsDirFor` se recibe en vez de definirse aquí: lo usa también el snapshot
// de configuración al exportar, así que su sitio sigue siendo main.js.
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { ipcMain, app } = require('electron')

function registra({ skillsDirFor, execFileP, claudePlugin }) {
  // description del frontmatter del SKILL.md (best-effort, sin parser YAML)
  function skillMeta(dir) {
    try {
      const raw = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
      const desc = /^description:\s*(.+)$/m.exec(raw)?.[1]?.trim().replace(/^["']|["']$/g, '') || ''
      return { desc: desc.slice(0, 200) }
    } catch {
      return { desc: '' }
    }
  }

  ipcMain.handle('skills:list', (_e, profile) => {
    const dir = skillsDirFor(profile)
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
        .map((d) => ({ id: d.name, ...skillMeta(path.join(dir, d.name)) }))
    } catch {
      return []
    }
  })

  // Busca la carpeta de la skill dentro del repo clonado (tolerante al layout).
  function findSkillDir(root, id, depth = 0) {
    if (depth > 3) return null
    try {
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name.startsWith('.')) continue
        const p = path.join(root, d.name)
        if (d.name === id && fs.existsSync(path.join(p, 'SKILL.md'))) return p
        const hit = findSkillDir(p, id, depth + 1)
        if (hit) return hit
      }
    } catch {}
    return null
  }

  // Instala (o actualiza) una skill del catálogo: clon superficial del repo en
  // caché + copia de la carpeta de la skill al skills/ del perfil.
  ipcMain.handle('skills:install', async (_e, { profile, id, repo }) => {
    if (!/^[\w.-]+$/.test(id || '') || !/^[\w.-]+\/[\w.-]+$/.test(repo || '')) return { ok: false, error: 'Entrada inválida' }
    let cache
    try {
      cache = await fetchRepo(repo)
    } catch (err) {
      return { ok: false, error: `git: ${err.message}` }
    }
    const src = findSkillDir(cache, id)
    if (!src) return { ok: false, error: `La skill «${id}» no está en ${repo}` }
    const dest = path.join(skillsDirFor(profile), id)
    try {
      fs.rmSync(dest, { recursive: true, force: true })
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.cpSync(src, dest, { recursive: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Normaliza «user/repo», «https://github.com/user/repo(.git)» → user/repo
  const normRepo = (s = '') => {
    const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(s.trim())
    return m ? m[1] : null
  }

  // Clona (o actualiza) un repo en caché y devuelve su ruta local.
  async function fetchRepo(repo) {
    const cache = path.join(app.getPath('userData'), 'skills-cache', repo.replace('/', '__'))
    if (fs.existsSync(path.join(cache, '.git'))) await execFileP('git', ['-C', cache, 'pull', '--ff-only'], { timeout: 60000 })
    else {
      fs.mkdirSync(path.dirname(cache), { recursive: true })
      await execFileP('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, cache], { timeout: 120000 })
    }
    return cache
  }

  // Escanea un repo cualquiera y lista las skills (carpetas con SKILL.md) que trae.
  ipcMain.handle('skills:scan', async (_e, source) => {
    const repo = normRepo(source)
    if (!repo) return { ok: false, error: 'Pega un repo de GitHub («usuario/repo» o su URL)' }
    let cache
    try {
      cache = await fetchRepo(repo)
    } catch (err) {
      return { ok: false, error: `git: ${err.message}` }
    }
    const found = []
    const walk = (dir, depth) => {
      if (depth > 4 || found.length >= 60) return
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const d of entries) {
        if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue
        const p = path.join(dir, d.name)
        if (fs.existsSync(path.join(p, 'SKILL.md'))) found.push({ id: d.name, ...skillMeta(p) })
        else walk(p, depth + 1)
      }
    }
    walk(cache, 0)
    return { ok: true, repo, skills: found }
  })

  // Crea el esqueleto de una skill propia y lo abre en el editor de texto.
  ipcMain.handle('skills:create', (_e, { profile, name, description }) => {
    const id = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    if (!id) return { ok: false, error: 'Nombre inválido' }
    const dir = path.join(skillsDirFor(profile), id)
    const file = path.join(dir, 'SKILL.md')
    try {
      fs.mkdirSync(dir, { recursive: true })
      if (!fs.existsSync(file))
        fs.writeFileSync(
          file,
          `---\nname: ${id}\ndescription: ${String(description || '').trim() || 'Describe aquí CUÁNDO debe usarse esta skill — el agente lee esto para decidir activarla'}\n---\n\n# ${name}\n\nInstrucciones para el agente cuando esta skill se activa:\n\n- …\n- …\n\n<!-- Puedes añadir más archivos a esta carpeta (plantillas, ejemplos, scripts)\n     y referenciarlos desde aquí. -->\n`
        )
      execFile('open', ['-t', file], (err) => {
        if (err) execFile('open', [file], () => {})
      })
      return { ok: true, id }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('skills:remove', (_e, { profile, id }) => {
    if (!/^[a-z0-9-]+$/.test(id || '')) return { ok: false, error: 'Id inválido' }
    try {
      fs.rmSync(path.join(skillsDirFor(profile), id), { recursive: true, force: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('plugins:list', async (_e, profile) => {
    try {
      const j = JSON.parse(await claudePlugin(profile, ['list', '--available', '--json']))
      const slim = (p) => ({
        id: p.pluginId || p.name,
        name: p.name || p.pluginId,
        desc: String(p.description || '').slice(0, 180),
        marketplace: p.marketplaceName || '',
        installs: p.installCount || 0,
        enabled: p.enabled !== false,
      })
      return { ok: true, installed: (j.installed || []).map(slim), available: (j.available || []).map(slim) }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('plugins:marketplaces', async (_e, profile) => {
    try {
      const j = JSON.parse(await claudePlugin(profile, ['marketplace', 'list', '--json']))
      return { ok: true, marketplaces: (Array.isArray(j) ? j : []).map((m) => ({ name: m.name, repo: m.repo || m.source || '' })) }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('plugins:addMarketplace', async (_e, { profile, source }) => {
    const src = String(source || '').trim()
    if (!src || /\s/.test(src)) return { ok: false, error: 'Fuente inválida' }
    try {
      await claudePlugin(profile, ['marketplace', 'add', src])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('plugins:removeMarketplace', async (_e, { profile, name }) => {
    if (!/^[\w.-]+$/.test(name || '')) return { ok: false, error: 'Nombre inválido' }
    try {
      await claudePlugin(profile, ['marketplace', 'remove', name])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('plugins:install', async (_e, { profile, id }) => {
    if (!/^[\w.@/-]+$/.test(id || '')) return { ok: false, error: 'Id inválido' }
    try {
      await claudePlugin(profile, ['install', id])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('plugins:uninstall', async (_e, { profile, id }) => {
    if (!/^[\w.@/-]+$/.test(id || '')) return { ok: false, error: 'Id inválido' }
    try {
      await claudePlugin(profile, ['uninstall', id])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

module.exports = { registra }
