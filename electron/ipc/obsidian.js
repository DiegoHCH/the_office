// Las conversaciones en tu vault de Obsidian: el disco.
//
// Todo lo que decide QUÉ se escribe y DÓNDE está en lib/obsidian.js, probado.
// Aquí solo queda elegir la carpeta y escribir.
//
// DOS GARANTÍAS, y son el diseño entero:
//
//  1. Sin carpeta configurada esto no existe. Ni Obsidian, ni cuenta, ni nada: lo
//     que se guarda son archivos .md normales, y Obsidian es solo quien los lee.
//     El historial de la app sigue funcionando igual que siempre.
//  2. Escribir la nota NUNCA puede tumbar el guardado de la conversación. Si la
//     carpeta ya no está —disco externo, renombrada, sin permisos— la
//     conversación se guarda igual y el fallo se DEVUELVE para poder avisar. Un
//     `catch {}` vacío aquí sería perder notas sin que nadie se enterara, que es
//     el error que este proyecto ya ha pagado varias veces.
const fs = require('node:fs')
const path = require('node:path')
const { ipcMain, dialog, shell } = require('electron')
const obs = require('../lib/obsidian.js')

function registra({ HIST_DIR, userData, ventana }) {
  const dirFile = () => path.join(userData(), 'obsidian-dir.txt')

  const leeDir = () => {
    try {
      return fs.readFileSync(dirFile(), 'utf8').trim()
    } catch {
      return ''
    }
  }

  /// Escribe (o actualiza) la nota de una conversación. Devuelve qué pasó, sin
  /// lanzar: quien llama es el guardado del historial y no puede fallar por esto.
  function escribeNota(convo) {
    const vault = leeDir()
    if (!vault) return { ok: true, off: true } // sin configurar: no es un fallo
    try {
      if (!fs.existsSync(vault)) return { ok: false, error: `la carpeta ya no está: ${vault}` }
      const carpeta = obs.carpetaDeNota({ vault, perfil: convo.profile, proyecto: convo.project }, path.join)
      fs.mkdirSync(carpeta, { recursive: true })
      // Un vault POR PROYECTO: la carpeta de cada proyecto lleva su `.obsidian`,
      // que es lo que hace que Obsidian la abra como vault propio en vez de
      // tener todo en uno. Así el grafo, las búsquedas y los ajustes de cada
      // proyecto son suyos y no se mezclan con los de otro.
      try {
        fs.mkdirSync(path.join(carpeta, '.obsidian'), { recursive: true })
      } catch {}

      // La nota de la madre, para enlazarla desde la de un subagente.
      let padre = ''
      if (convo.parentId) {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(HIST_DIR, `${convo.parentId}.json`), 'utf8'))
          padre = obs.nombreDeNota(m.title, m.id)
        } catch {} // sin madre legible, la nota va suelta y ya
      }

      const destino = path.join(carpeta, obs.nombreDeNota(convo.title, convo.id))
      // El título cambia (sale del primer mensaje, y se puede renombrar), así que
      // la nota de antes tiene otro nombre: se busca por el sufijo del id y se
      // renombra en vez de dejar dos notas de la misma conversación.
      try {
        for (const f of fs.readdirSync(carpeta)) {
          if (f.endsWith('.md') && obs.esNotaDe(f, convo.id) && path.join(carpeta, f) !== destino) {
            fs.renameSync(path.join(carpeta, f), destino)
            break
          }
        }
      } catch {}

      let previo = null
      try {
        previo = fs.readFileSync(destino, 'utf8')
      } catch {}
      const contenido = obs.contenidoAEscribir(convo, previo, { padre })
      // null = el archivo existe y NO es nuestro: es una nota de la persona que
      // coincidió de nombre. No se toca, y se dice por qué.
      if (contenido === null) return { ok: false, error: `hay una nota tuya con ese nombre y no se ha tocado: ${path.basename(destino)}` }
      fs.writeFileSync(destino, contenido)
      return { ok: true, path: destino }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }

  /// La memoria de un perfil+proyecto, lista para el system prompt.
  ///
  /// Esta es la dirección CONTRARIA a las notas: aquí el vault no recibe, alimenta.
  /// Lo que escribas en `_memoria.md` entra en la persona de cada agente de ese
  /// proyecto, igual que el CLAUDE.md o el CONTEXT.md — no hay que pedirle a nadie
  /// que lo busque ni que lo lea.
  function leeMemoria(perfil, proyecto) {
    const vault = leeDir()
    if (!vault) return ''
    try {
      const f = obs.rutaDeMemoria({ vault, perfil, proyecto }, path.join)
      return obs.memoriaParaPersona(fs.readFileSync(f, 'utf8'))
    } catch {
      return '' // sin nota de memoria en ese proyecto: no es un fallo
    }
  }

  /// Abre la memoria del proyecto, creándola con la plantilla si no existe.
  /// Un archivo vacío no dice qué se espera dentro; la plantilla sí.
  ipcMain.handle('obsidian:openMemoria', (_e, { profile, project } = {}) => {
    const vault = leeDir()
    if (!vault) return { ok: false, error: 'sin carpeta configurada' }
    try {
      const f = obs.rutaDeMemoria({ vault, perfil: profile, proyecto: project }, path.join)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      if (!fs.existsSync(f)) fs.writeFileSync(f, obs.PLANTILLA_MEMORIA)
      shell.openPath(f)
      return { ok: true, path: f }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  /// ¿Hay memoria en este proyecto, y cuánto ocupa? Para poder decirlo en ⚙️ en
  /// vez de que el usuario tenga que adivinar si se está enviando algo.
  ipcMain.handle('obsidian:memoriaInfo', (_e, { profile, project } = {}) => {
    const t = leeMemoria(profile, project)
    return { hay: !!t, chars: t.length }
  })

  /// La lista del historial, leída del VAULT.
  ///
  /// El vault es el índice: si borras una nota en Obsidian, esa conversación deja
  /// de aparecer en la app —aunque su JSON siga ahí—. Es lo que se pidió, y es
  /// coherente: si el vault manda, manda también para desaparecer.
  ///
  /// Lo que NO se toca es el dato: los mensajes y las sesiones se siguen leyendo
  /// del JSON por el id de la nota. Una nota es legible, pero no devuelve el
  /// contexto de una conversación; eso solo lo hace `--resume` con su id.
  ///
  /// Devuelve null si no hay vault o no hay ni una nota: así quien llama sabe que
  /// tiene que usar el historial de siempre en vez de enseñar una lista vacía.
  function listaDesdeVault(profile) {
    const vault = leeDir()
    if (!vault) return null
    const raiz = path.join(vault, obs.sanitiza(profile || 'sin-perfil', 40))
    let proyectos
    try {
      proyectos = fs.readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    } catch {
      return null // este perfil aún no tiene nada en el vault
    }
    const out = []
    for (const p of proyectos) {
      let archivos = []
      try {
        archivos = fs.readdirSync(path.join(raiz, p.name)).filter((f) => f.endsWith('.md') && f !== obs.nombreMemoria())
      } catch {}
      for (const f of archivos) {
        try {
          const e = obs.entradaDeNota(fs.readFileSync(path.join(raiz, p.name, f), 'utf8'), f)
          if (e) out.push(e)
        } catch {} // una nota ilegible no puede dejar sin historial a las demás
      }
    }
    return out.length ? out : null
  }

  /// Crea el vault de un proyecto si no existía: su carpeta, su `.obsidian` —que
  /// es lo que hace que Obsidian la abra como vault propio— y su `_memoria.md`
  /// con la plantilla.
  ///
  /// Se llama al EMPEZAR una conversación y no al guardarla, que era cuando se
  /// creaba antes: así la memoria del proyecto existe desde el primer mensaje y
  /// no a partir del segundo. Si ya estaba, no toca nada.
  ipcMain.handle('obsidian:ensureVault', (_e, { profile, project } = {}) => {
    const vault = leeDir()
    if (!vault) return { ok: true, off: true }
    try {
      const carpeta = obs.carpetaDeNota({ vault, perfil: profile, proyecto: project }, path.join)
      const nuevo = !fs.existsSync(carpeta)
      fs.mkdirSync(path.join(carpeta, '.obsidian'), { recursive: true })
      const mem = path.join(carpeta, obs.nombreMemoria())
      if (!fs.existsSync(mem)) fs.writeFileSync(mem, obs.PLANTILLA_MEMORIA)
      return { ok: true, nuevo, path: carpeta }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('obsidian:getDir', () => ({ dir: leeDir() }))

  ipcMain.handle('obsidian:pickDir', async () => {
    const res = await dialog.showOpenDialog(ventana(), {
      properties: ['openDirectory', 'createDirectory'],
      message: 'Elige la carpeta del vault (o una carpeta dentro de él)',
    })
    if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true }
    try {
      fs.mkdirSync(userData(), { recursive: true })
      fs.writeFileSync(dirFile(), res.filePaths[0])
      return { ok: true, dir: res.filePaths[0] }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  /// Desconectar: se olvida la carpeta. Las notas ya escritas NO se borran — son
  /// tuyas y pueden llevar anotaciones propias debajo del separador.
  ipcMain.handle('obsidian:clearDir', () => {
    try {
      fs.unlinkSync(dirFile())
    } catch {}
    return { ok: true }
  })

  /// Abre el vault de ESTE proyecto en Obsidian.
  ///
  /// Con el deep link `obsidian://open?path=…`, que lo abre como vault propio. Si
  /// Obsidian no está instalado no pasa nada raro: se cae a abrir la carpeta en
  /// el Finder, que es lo único que se puede hacer sin él.
  ipcMain.handle('obsidian:openVault', async (_e, { profile, project } = {}) => {
    const vault = leeDir()
    if (!vault) return { ok: false, error: 'sin carpeta configurada' }
    const carpeta = obs.carpetaDeNota({ vault, perfil: profile, proyecto: project }, path.join)
    try {
      fs.mkdirSync(path.join(carpeta, '.obsidian'), { recursive: true })
    } catch {}
    try {
      await shell.openExternal(`obsidian://open?path=${encodeURIComponent(carpeta)}`)
      return { ok: true, path: carpeta }
    } catch {
      shell.openPath(carpeta)
      return { ok: true, path: carpeta, finder: true }
    }
  })

  ipcMain.handle('obsidian:reveal', () => {
    const d = leeDir()
    if (!d) return { ok: false }
    shell.openPath(d)
    return { ok: true }
  })

  /// Exportar todo lo que ya había: al conectar el vault, el historial de antes no
  /// aparece solo. Devuelve cuántas se escribieron y cuántas fallaron.
  ipcMain.handle('obsidian:syncAll', () => {
    if (!leeDir()) return { ok: false, error: 'sin carpeta configurada' }
    let hechas = 0
    const fallos = []
    let archivos
    try {
      archivos = fs.readdirSync(HIST_DIR).filter((f) => f.endsWith('.json'))
    } catch {
      return { ok: false, error: 'no se pudo leer el historial' }
    }
    for (const f of archivos) {
      let convo
      try {
        convo = JSON.parse(fs.readFileSync(path.join(HIST_DIR, f), 'utf8'))
      } catch {
        continue // una conversación ilegible no detiene las demás
      }
      const r = escribeNota(convo)
      if (r.ok && !r.off) hechas++
      else if (!r.ok) fallos.push(r.error)
    }
    return { ok: true, hechas, fallos: fallos.slice(0, 3), total: archivos.length }
  })

  return { escribeNota, leeDir, leeMemoria, listaDesdeVault }
}

module.exports = { registra }
