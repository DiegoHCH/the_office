// Historial de conversaciones: guardar, listar, buscar, renombrar, fijar,
// borrar y exportar. Sale de main.js porque es un grupo con una sola
// responsabilidad y sus propias reglas —qué se preserva al guardar, qué se
// lleva por delante un borrado— que no tienen nada que ver con el resto del
// proceso principal.
//
// `registra` recibe lo que necesita en vez de importarlo: main.js es quien sabe
// dónde vive el historial y quién es la ventana, y así este archivo no arrastra
// medio proceso principal para poder leerse.
const fs = require('node:fs')
const path = require('node:path')
const { ipcMain, dialog } = require('electron')
const obs = require('../lib/obsidian.js')

// `escribeNota` viene de ipc/obsidian.js y es opcional: sin vault configurado
// devuelve `{off:true}` y aquí no cambia nada. Se llama desde el guardado —y no
// desde el renderer— porque este es el ÚNICO sitio por donde pasa una
// conversación al persistirse: cualquier otro punto de enganche se acabaría
// olvidando de alguna ruta (el autosave, el cierre de un subagente, el renombrar).
function registra({ HIST_DIR, ventana, escribeNota, listaDesdeVault }) {
  const win = () => ventana()
  ipcMain.handle('history:save', (_e, convo) => {
    try {
      fs.mkdirSync(HIST_DIR, { recursive: true })
      const p = path.join(HIST_DIR, `${convo.id}.json`)
      // el autosave del renderer no conoce el pin ni el título renombrado:
      // preservarlos del archivo existente
      try {
        const prev = JSON.parse(fs.readFileSync(p, 'utf8'))
        convo.pinned = convo.pinned ?? !!prev.pinned
        // de quién es hija no se pierde por un guardado que no lo traiga: el
        // vínculo solo lo conoce quien la creó, y se guarda muchas veces después
        convo.parentId = convo.parentId ?? prev.parentId ?? null
        if (prev.titleCustom) {
          convo.title = prev.title
          convo.titleCustom = true
        }
      } catch {}
      fs.writeFileSync(p, JSON.stringify(convo, null, 2))
      // Y la nota del vault, si hay uno. Va DESPUÉS y su resultado viaja aparte:
      // la conversación ya está a salvo en su JSON pase lo que pase con el vault,
      // y si la nota no se pudo escribir se dice en vez de perderse en silencio.
      const nota = escribeNota ? escribeNota(convo) : { ok: true, off: true }
      return { ok: true, vault: nota.ok || nota.off ? null : nota.error }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // El historial se filtra por perfil: work y private no deben verse la
  // conversación del otro. Cada conversación ya guardaba su `profile`, así que no
  // hay que mover nada — solo dejar de mostrarlas todas juntas.
  ipcMain.handle('history:list', (_e, profile) => {
    // Con vault conectado, el ÍNDICE es el vault: la lista sale de las notas, así
    // que borrar una en Obsidian la quita también de aquí. Lo que se sigue leyendo
    // del JSON es el dato de cada una —fijada, de quién es hija, si tiene sesión
    // con la que retomar—, porque eso una nota no lo tiene.
    const delVault = listaDesdeVault ? listaDesdeVault(profile) : null
    if (delVault) {
      return delVault
        .map((e) => {
          let extra
          try {
            const c = JSON.parse(fs.readFileSync(path.join(HIST_DIR, `${e.id}.json`), 'utf8'))
            extra = { pinned: !!c.pinned, parentId: c.parentId || null, title: c.titleCustom ? c.title : e.title }
          } catch {
            // hay nota pero no datos: se ve en la lista y se dice al abrirla, en
            // vez de desaparecer sin explicación o fingir que se puede retomar
            extra = { sinDatos: true, pinned: false, parentId: null }
          }
          return { ...e, ...extra }
        })
        .filter((c) => !profile || (c.profile || 'work') === profile)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    }
    try {
      return fs
        .readdirSync(HIST_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            const c = JSON.parse(fs.readFileSync(path.join(HIST_DIR, f), 'utf8'))
            return {
              id: c.id,
              title: c.title,
              profile: c.profile,
              project: c.project,
              updatedAt: c.updatedAt,
              count: c.messages?.length ?? 0,
              pinned: !!c.pinned,
              // hija de la conversación que la repartió (subagentes): el panel las
              // anida bajo su madre en vez de mezclarlas en la lista por fecha
              parentId: c.parentId || null,
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)
        // las viejas sin perfil marcado cuentan como «work», que era el default
        // histórico: dejarlas visibles en todos los perfiles sería la misma fuga
        .filter((c) => !profile || (c.profile || 'work') === profile)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    } catch {
      return []
    }
  })

  ipcMain.handle('history:get', (_e, id) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(HIST_DIR, `${id}.json`), 'utf8'))
    } catch {
      return null
    }
  })

  // Renombra una conversación (el título queda fijo, el autosave no lo pisa).
  ipcMain.handle('history:rename', (_e, { id, title }) => {
    try {
      const p = path.join(HIST_DIR, `${id}.json`)
      const c = JSON.parse(fs.readFileSync(p, 'utf8'))
      c.title = String(title || '').trim().slice(0, 80) || c.title
      c.titleCustom = true
      fs.writeFileSync(p, JSON.stringify(c, null, 2))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Busca DENTRO del texto de los mensajes: {id: extracto} de las que matchean.
  ipcMain.handle('history:search', (_e, q, profile) => {
    const needle = String(q || '').toLowerCase()
    if (needle.length < 3) return {}
    const out = {}
    try {
      for (const f of fs.readdirSync(HIST_DIR).filter((x) => x.endsWith('.json'))) {
        try {
          const c = JSON.parse(fs.readFileSync(path.join(HIST_DIR, f), 'utf8'))
          if (profile && (c.profile || 'work') !== profile) continue
          for (const m of c.messages || []) {
            const t = String(m.text || '')
            const i = t.toLowerCase().indexOf(needle)
            if (i >= 0) {
              out[c.id] = `…${t.slice(Math.max(0, i - 30), i + 60).replace(/\s+/g, ' ')}…`
              break
            }
          }
        } catch {}
      }
    } catch {}
    return out
  })

  // Fija/desfija una conversación (las fijadas no se purgan y van arriba).
  ipcMain.handle('history:pin', (_e, { id, pinned }) => {
    try {
      const p = path.join(HIST_DIR, `${id}.json`)
      const c = JSON.parse(fs.readFileSync(p, 'utf8'))
      c.pinned = !!pinned
      fs.writeFileSync(p, JSON.stringify(c, null, 2))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Borrar una conversación se lleva a sus hijas: las de los subagentes no tienen
  // vida propia —«comparar X vs Y» sin el encargo del que salió no se entiende— y
  // dejarlas huérfanas es dejar basura que el usuario no sabe de dónde viene.
  // Devuelve cuántas cayeron, para poder decirlo.
  ipcMain.handle('history:delete', (_e, id) => {
    try {
      let hijas = 0
      for (const f of fs.readdirSync(HIST_DIR)) {
        if (!f.endsWith('.json') || f === `${id}.json`) continue
        try {
          const c = JSON.parse(fs.readFileSync(path.join(HIST_DIR, f), 'utf8'))
          if (c.parentId === id) {
            fs.unlinkSync(path.join(HIST_DIR, f))
            hijas++
          }
        } catch {} // una hija ilegible no puede impedir borrar la madre
      }
      fs.unlinkSync(path.join(HIST_DIR, `${id}.json`))
      return { ok: true, hijas }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Exporta una conversación a Markdown (elige destino con el diálogo de guardar).
  ipcMain.handle('history:export', async (_e, id) => {
    let convo
    try {
      convo = JSON.parse(fs.readFileSync(path.join(HIST_DIR, `${id}.json`), 'utf8'))
    } catch {
      return { ok: false, error: 'Conversación no encontrada' }
    }
    const safe = (convo.title || 'conversacion')
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .slice(0, 50) || 'conversacion'
    const res = await dialog.showSaveDialog(win(), {
      defaultPath: `${safe}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    try {
      // El mismo renderizador que usan las notas del vault: si cada salida tuviera
      // su formato, la misma conversación se leería distinta según por dónde saliera.
      fs.writeFileSync(res.filePath, obs.cuerpoDeConversacion(convo))
      return { ok: true, path: res.filePath }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

module.exports = { registra }
