// Respaldo, exportación, importación y copia entre perfiles.
//
// Sale de main.js porque es donde vive la regla más delicada de la app: qué se
// lleva un export y qué NO. Los servidores MCP con credenciales se quedan fuera
// y se listan aparte, para que el usuario los reconecte a mano en la otra
// máquina en vez de que sus secretos viajen en un archivo. Tenerlo en su propio
// archivo hace esa decisión visible en vez de enterrada.
const fs = require('node:fs')
const path = require('node:path')
const { ipcMain, dialog, app } = require('electron')

function registra({ buildConfigSnapshot, squadFile, customProjectsFile, getCustomProjects, artifactsDirFile, personaFile, CONFIG_PROFILES, PROFILE_DIRS, ventana }) {
  const win = () => ventana()
  // Respaldo automático semanal en userData/backups (rota, máx 8) — red de
  // seguridad silenciosa contra pérdidas de squad, personas y plantillas.
  ipcMain.handle('config:autoBackup', (_e, extras) => {
    try {
      const dir = path.join(app.getPath('userData'), 'backups')
      fs.mkdirSync(dir, { recursive: true })
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
      const last = files.length ? fs.statSync(path.join(dir, files[files.length - 1])).mtimeMs : 0
      if (Date.now() - last < 7 * 24 * 3600 * 1000) return { ok: true, skipped: true }
      const name = `config-${new Date().toISOString().slice(0, 10)}.json`
      fs.writeFileSync(path.join(dir, name), JSON.stringify(buildConfigSnapshot(extras), null, 2))
      for (const old of files.slice(0, Math.max(0, files.length - 7))) {
        try {
          fs.unlinkSync(path.join(dir, old))
        } catch {}
      }
      return { ok: true, saved: name }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Lista de respaldos automáticos disponibles (para restaurar).
  ipcMain.handle('config:backups', () => {
    try {
      const dir = path.join(app.getPath('userData'), 'backups')
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ file: f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.at - a.at)
    } catch {
      return []
    }
  })

  // Copiar la configuración de un perfil a otro, directo en disco. Nace de un
  // malentendido razonable: exportar e importar parecía servir para esto, pero el
  // export lleva SIEMPRE los tres perfiles y el import devuelve cada uno a su
  // sitio —sirve para respaldar y migrar de máquina, no para llevarse el squad de
  // «work» a «private»—. Esto es lo que la gente quería de verdad.
  ipcMain.handle('config:copyProfile', async (_e, { desde, hacia, partes } = {}) => {
    if (!CONFIG_PROFILES.includes(desde) || !CONFIG_PROFILES.includes(hacia)) {
      return { ok: false, error: 'Perfil inválido' }
    }
    if (desde === hacia) return { ok: false, error: 'Origen y destino son el mismo perfil' }
    const q = { squad: !!partes?.squad, personas: !!partes?.personas, proyectos: !!partes?.proyectos }
    if (!q.squad && !q.personas && !q.proyectos) return { ok: false, error: 'No se eligió nada que copiar' }

    const nombres = [q.squad && 'el squad', q.personas && 'las personalidades', q.proyectos && 'los proyectos agregados']
      .filter(Boolean)
      .join(', ')
    const ans = await dialog.showMessageBox(win(), {
      type: 'warning',
      buttons: [`Copiar en «${hacia}»`, 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      message: `Copiar de «${desde}» a «${hacia}»`,
      detail: `Se sobrescribe ${nombres} de «${hacia}». Lo demás de ese perfil no se toca: conversaciones, sesiones, credenciales, y lo que no hayas marcado.`,
    })
    if (ans.response !== 0) return { ok: false, canceled: true }

    const hechos = []
    // y lo que NO se pudo: antes un fallo solo se notaba porque ese elemento no
    // aparecía en la lista de copiados, que es pedirle mucho al usuario
    const fallidos = []
    try {
      if (q.squad) {
        try {
          fs.writeFileSync(squadFile(hacia), fs.readFileSync(squadFile(desde), 'utf8'))
          hechos.push('squad')
        } catch (err) {
          fallidos.push('squad')
          console.error('[oficina] copiar squad:', err)
        }
      }
      if (q.proyectos) {
        try {
          fs.writeFileSync(customProjectsFile(hacia), JSON.stringify(getCustomProjects(desde), null, 2))
          hechos.push('proyectos')
        } catch (err) {
          fallidos.push('proyectos')
          console.error('[oficina] copiar proyectos:', err)
        }
      }
      if (q.personas) {
        // se reemplazan las del destino por las del origen
        const dirDesde = path.join(app.getPath('userData'), 'personas', desde)
        const dirHacia = path.join(app.getPath('userData'), 'personas', hacia)
        try {
          fs.rmSync(dirHacia, { recursive: true, force: true })
        } catch {}
        try {
          const files = fs.readdirSync(dirDesde).filter((f) => f.endsWith('.md'))
          if (files.length) fs.mkdirSync(dirHacia, { recursive: true })
          for (const f of files) fs.copyFileSync(path.join(dirDesde, f), path.join(dirHacia, f))
          hechos.push('personalidades')
        } catch (err) {
          fallidos.push('personalidades')
          console.error('[oficina] copiar personalidades:', err)
        }
      }
      return { ok: true, desde, hacia, hechos, fallidos }
    } catch (err) {
      return { ok: false, error: String(err.message || err).slice(0, 250) }
    }
  })

  // Qué tiene cada perfil, para poder mostrarlo antes de copiar y no elegir a
  // ciegas: copiar un squad vacío encima de uno bueno no tendría vuelta atrás.
  ipcMain.handle('config:profileSummary', (_e, prof) => {
    if (!CONFIG_PROFILES.includes(prof)) return null
    let squad = 0
    try {
      const j = JSON.parse(fs.readFileSync(squadFile(prof), 'utf8'))
      squad = (Array.isArray(j) ? j : j?.roster || []).filter((r) => r?.active !== false).length
    } catch {}
    let personas = 0
    try {
      personas = fs.readdirSync(path.join(app.getPath('userData'), 'personas', prof)).filter((f) => f.endsWith('.md')).length
    } catch {}
    let proyectos = 0
    try {
      proyectos = getCustomProjects(prof).length
    } catch {}
    return { profile: prof, squad, personas, proyectos }
  })

  ipcMain.handle('config:export', async (_e, extras) => {
    const res = await dialog.showSaveDialog(win(), {
      defaultPath: 'la-oficina-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    const data = buildConfigSnapshot(extras)
    try {
      fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2))
      return { ok: true, path: res.filePath }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Aplica squads/personas/proyectos y devuelve los extras (localStorage) para
  // que el renderer los restaure. Pide confirmación: sobrescribe lo actual.
  ipcMain.handle('config:import', async () => {
    const res = await dialog.showOpenDialog(win(), { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true }
    let data
    try {
      data = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'))
    } catch (err) {
      return { ok: false, error: `No es un JSON válido: ${err.message}` }
    }
    if (data.app !== 'la-oficina' || typeof data.profiles !== 'object') return { ok: false, error: 'Ese archivo no es una configuración de La Oficina' }
    const ans = await dialog.showMessageBox(win(), {
      type: 'warning',
      buttons: ['Importar', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      message: 'Importar configuración',
      detail: 'Se sobrescribirán el squad, las personalidades y los proyectos agregados de los perfiles incluidos en el archivo. ¿Continuar?',
    })
    if (ans.response !== 0) return { ok: false, canceled: true }
    try {
      if (data.artifactsDir && fs.existsSync(data.artifactsDir)) fs.writeFileSync(artifactsDirFile(), data.artifactsDir)
      const skillsToInstall = {} // profile → [ids] para que el renderer reinstale las del catálogo
      const mcpSkipped = [] // servers con credenciales que el export excluyó (reconectar a mano)
      for (const [prof, entry] of Object.entries(data.profiles)) {
        if (!CONFIG_PROFILES.includes(prof)) continue
        if (entry.squad) fs.writeFileSync(squadFile(prof), JSON.stringify(entry.squad, null, 2))
        if (Array.isArray(entry.projects)) fs.writeFileSync(customProjectsFile(prof), JSON.stringify(entry.projects, null, 2))
        for (const [role, md] of Object.entries(entry.personas || {})) {
          if (!/^[\w-]+$/.test(role)) continue
          const file = personaFile(prof, role)
          fs.mkdirSync(path.dirname(file), { recursive: true })
          fs.writeFileSync(file, String(md))
        }
        // servidores MCP: merge directo al .claude.json del perfil (los ya
        // existentes con el mismo nombre se conservan como están)
        if (entry.mcp && typeof entry.mcp === 'object') {
          try {
            const cdir = PROFILE_DIRS[prof] ? PROFILE_DIRS[prof]() : path.join(app.getPath('home'), '.claude')
            const cfile = path.join(cdir, '.claude.json')
            let cj = {}
            try {
              cj = JSON.parse(fs.readFileSync(cfile, 'utf8'))
            } catch {}
            cj.mcpServers = { ...entry.mcp, ...(cj.mcpServers || {}) }
            fs.mkdirSync(cdir, { recursive: true })
            fs.writeFileSync(cfile, JSON.stringify(cj, null, 2))
          } catch {}
        }
        if (entry.skills?.length) skillsToInstall[prof] = entry.skills
        if (entry.mcpSkipped?.length) mcpSkipped.push(...entry.mcpSkipped)
      }
      return { ok: true, extras: data.extras || null, skills: skillsToInstall, mcpSkipped: [...new Set(mcpSkipped)] }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

module.exports = { registra }
