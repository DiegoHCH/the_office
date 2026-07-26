const { app, BrowserWindow, ipcMain, protocol, net, Notification, dialog, shell, Tray, Menu, nativeImage, globalShortcut, powerSaveBlocker, powerMonitor } = require('electron')
const { spawn, execFile } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const https = require('node:https')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')

const isDev = process.env.NODE_ENV === 'development'

// En producción el bundle se sirve por app:// (fetch de glTF no funciona con file://).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// Ruta absoluta del binario: Electron NO hereda el PATH del shell interactivo.
const CLAUDE_CANDIDATES = [
  path.join(app.getPath('home'), '.local', 'bin', 'claude'),
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
]
const CLAUDE_BIN = CLAUDE_CANDIDATES.find((p) => fs.existsSync(p)) || 'claude'

let win = null
// Un proceso claude por rol → el squad puede trabajar en paralelo.
const children = new Map() // role → child process
// Sesión por rol+perfil+proyecto → cada personaje tiene su propio contexto.
const sessions = new Map() // `${role}::${profile}::${workdir}` → sessionId

// Última sesión conocida de cada rol (persistida): la memoria del standup.
// A diferencia de `sessions`, NO se borra con "conversación nueva".
let lastSessions = null
const lastSessionsFile = () => path.join(app.getPath('userData'), 'last-sessions.json')
function getLastSessions() {
  if (!lastSessions) {
    lastSessions = new Map()
    try {
      for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(lastSessionsFile(), 'utf8')))) {
        lastSessions.set(k, v)
      }
    } catch {}
  }
  return lastSessions
}
function rememberSession(key, sid) {
  if (!sid) return
  const m = getLastSessions()
  if (m.get(key) === sid) return
  m.set(key, sid)
  try {
    fs.writeFileSync(lastSessionsFile(), JSON.stringify(Object.fromEntries(m), null, 2))
  } catch {}
}

// Catálogo de roles: plantilla de persona por rol, con el nombre configurable.
const ROLE_TEMPLATES = {
  dev: (n) =>
    `Eres ${n}, dev principal del squad. Tu foco: implementar código, arreglar bugs y refactorizar. Preséntate como ${n} cuando te saluden.`,
  research: (n) =>
    `Eres ${n}, investigador/a del squad. Tu foco: investigar código y web, analizar, comparar y producir documentos/artifacts claros (archivos .md bien estructurados). Preséntate como ${n} cuando te saluden.`,
  design: (n) =>
    `Eres ${n}, diseñador/a UI/UX del squad. Tu foco: diseño de interfaces, experiencia de usuario, estilos, accesibilidad y propuestas visuales concretas. Preséntate como ${n} cuando te saluden.`,
  qa: (n) =>
    `Eres ${n}, QA del squad. Tu foco: calidad — escribir tests, ejecutarlos, reproducir bugs y reportar resultados con claridad. Preséntate como ${n} cuando te saluden.`,
  pr: (n) =>
    `Eres ${n}, revisor/a de Pull Requests del squad. Tu foco: revisar PRs y diffs con ojo crítico — correctitud, diseño, tests, riesgos y estilo — y dar feedback concreto y accionable. Eres dueño/a de TODO el flujo de PRs de punta a punta. Si el proyecto define un protocolo en su CLAUDE.md, SÍGUELO: identifica el repo y carga su skill de PR (p. ej. flash-pre-pr, g66-pr, review-pr, merge-hu) leyendo su SKILL.md, y ejecútalo completo — incluyendo push, creación del PR con la herramienta del repo (gh/aws/etc.) y el tracking asociado en Jira/Slack vía los conectores disponibles, cuando el skill lo haga. Tienes gh y acli en el PATH y los conectores MCP habilitados; úsalos según lo pida el skill, no inventes pasos fuera de él. Preséntate como ${n} cuando te saluden.`,
  docs: (n) =>
    `Eres ${n}, technical writer del squad. Tu foco: documentación clara — READMEs, guías, ADRs, comentarios útiles. Preséntate como ${n} cuando te saluden.`,
  publish: (n) =>
    `Eres ${n}, publicador/DevOps del squad. Tu foco: tomar artifacts (páginas HTML) que crean tus compañeros y publicarlos en la web como GitHub Pages, además de tareas ligeras de despliegue. Cuando un compañero te pase un artifact para publicar, localízalo, prepáralo y súbelo siguiendo el procedimiento de publicación indicado. REGLA DE ORO: siempre confirma con el usuario antes de hacer cualquier cosa pública. Preséntate como ${n} cuando te saluden.`,
}

// Squad por defecto: en una instalación nueva SOLO el principal (dev) está
// activo — los demás roles los activa el usuario desde 👥 Agentes. Los
// nombres son fallback: el primer arranque los reemplaza por nombres reales.
const DEFAULT_SQUAD = [
  { id: 'dev', name: 'Dev', enabled: true },
  { id: 'research', name: 'Research', enabled: false },
  { id: 'design', name: 'Diseño', enabled: false },
  { id: 'qa', name: 'QA', enabled: false },
  { id: 'pr', name: 'Revisor PR', enabled: false },
  { id: 'docs', name: 'Docs', enabled: false },
  { id: 'publish', name: 'Publicador', enabled: false },
]

const squadFile = (profile) => path.join(app.getPath('userData'), `squad-${profile}.json`)

// Nombres reales para el primer arranque: los personajes no deben llamarse
// como su rol ("Dev", "QA"…). Se sortean una vez por perfil y se persisten.
const FIRST_RUN_NAMES = [
  'Sofía', 'Mateo', 'Valentina', 'Santiago', 'Emma', 'Sebastián', 'Camila',
  'Lucía', 'Martín', 'Julieta', 'Tomás', 'Renata', 'Andrés', 'Elena', 'Pablo', 'Mariana',
]

// Primer arranque del perfil (sin squad-<profile>.json): roster por defecto
// con nombres reales únicos al azar, guardado de inmediato para que el
// sorteo no cambie entre arranques.
function firstRunSquad(profile) {
  const pool = [...FIRST_RUN_NAMES].sort(() => Math.random() - 0.5)
  const roster = DEFAULT_SQUAD.map((d, i) => ({ ...d, name: pool[i % pool.length], custom: false }))
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(
      squadFile(profile),
      JSON.stringify(
        roster.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, avatar: null, custom: false })),
        null,
        2
      )
    )
  } catch {}
  return roster
}

// Personalidad editable por personaje: userData/personas/<profile>/<role>.md
const personaFile = (profile, role) => path.join(app.getPath('userData'), 'personas', profile, `${role}.md`)
function readPersonaMd(profile, role) {
  try {
    const txt = fs.readFileSync(personaFile(profile, role), 'utf8').trim()
    return txt || null
  } catch {
    return null
  }
}
const PERSONA_TEMPLATE = (role, name) =>
  `# Personalidad de ${name} (${role})\n\n` +
  `Escribe aquí instrucciones extra para este personaje: su estilo, reglas, en qué es experto,\n` +
  `qué skills/comandos usar, formato de sus respuestas, etc. Se añaden a su rol base.\n\n` +
  `Ejemplos:\n` +
  `- Sigue las convenciones de commits del equipo.\n` +
  `- Responde en español, conciso y con viñetas.\n` +
  `- Antes de terminar, verifica que compile.\n`

ipcMain.handle('persona:open', (_e, { profile, role, name }) => {
  try {
    const file = personaFile(profile, role)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (!fs.existsSync(file)) fs.writeFileSync(file, PERSONA_TEMPLATE(role, name || role))
    execFile('open', ['-t', file], (err) => {
      if (err) execFile('open', [file], () => {})
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Roster del perfil: defaults + overrides guardados (nombre/enabled por rol).
// Roles predefinidos que NO se pueden eliminar (los demás built-ins y todos los
// custom sí). Mantener en sync con PROTECTED_ROLES del renderer (App.jsx).
const PROTECTED_ROLES = new Set(['dev', 'research', 'pr', 'publish'])

function getSquad(profile) {
  let saved = null
  try {
    saved = JSON.parse(fs.readFileSync(squadFile(profile), 'utf8'))
  } catch {}
  // Sin roster guardado = primer arranque: nombres reales sorteados.
  if (!saved) return firstRunSquad(profile)
  // Formato antiguo (mapa {id:{name,enabled,avatar}}): solo built-ins.
  if (saved && !Array.isArray(saved)) {
    return DEFAULT_SQUAD.map((d) => ({ ...d, ...(saved[d.id] || {}), custom: false }))
  }
  // Formato nuevo (array de roles), respetando EL ORDEN GUARDADO (el 1º activo
  // es el principal, y el usuario puede reordenar desde 👥 Agentes). Los
  // built-ins nuevos de una actualización se agregan al final, salvo los
  // marcados como borrados (tombstone `{id, deleted:true}`; los protegidos
  // nunca se borran).
  if (Array.isArray(saved)) {
    const deleted = new Set(saved.filter((r) => r.deleted && !PROTECTED_ROLES.has(r.id)).map((r) => r.id))
    const savedIds = new Set(saved.filter((r) => !r.deleted).map((r) => r.id))
    const roster = saved
      .filter((r) => !r.deleted)
      .map((r) => {
        const def = DEFAULT_SQUAD.find((d) => d.id === r.id)
        if (def) return { ...def, ...r, custom: false }
        return r.custom ? { ...r, custom: true } : null
      })
      .filter(Boolean)
    for (const d of DEFAULT_SQUAD) {
      if (!savedIds.has(d.id) && !deleted.has(d.id)) roster.push({ ...d, custom: false })
    }
    return roster
  }
  return DEFAULT_SQUAD.map((d) => ({ ...d, custom: false }))
}

let notifEnabled = true
ipcMain.handle('prefs:notify', (_e, v) => {
  notifEnabled = !!v
  return { ok: true }
})

// Badge del Dock + Tray + energía: nº de agentes trabajando (del renderer).
// Con trabajo en curso el Mac NO debe dormirse: una siesta congela el proceso
// claude y su stream con Anthropic muere por timeout.
let powerBlockId = null
ipcMain.handle('dock:badge', (_e, n) => {
  try {
    app.dock?.setBadge(n > 0 ? String(n) : '')
  } catch {}
  try {
    tray?.setTitle(n > 0 ? `🏢 ${n}` : '🏢')
    tray?.setToolTip(n > 0 ? `La Oficina — ${n} agente${n > 1 ? 's' : ''} trabajando` : 'La Oficina — squad libre')
  } catch {}
  try {
    if (n > 0 && powerBlockId === null) powerBlockId = powerSaveBlocker.start('prevent-app-suspension')
    else if (n === 0 && powerBlockId !== null) {
      powerSaveBlocker.stop(powerBlockId)
      powerBlockId = null
    }
  } catch {}
  return { ok: true }
})

// Icono en la barra de menús: estado del squad de un vistazo + menú rápido.
let tray = null
function createTray() {
  try {
    tray = new Tray(nativeImage.createEmpty())
    tray.setTitle('🏢')
    tray.setToolTip('La Oficina')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Mostrar La Oficina',
          click: () => {
            win?.show()
            win?.focus()
          },
        },
        {
          label: 'Nueva conversación',
          click: () => {
            win?.show()
            win?.focus()
            win?.webContents.send('claude:event', { kind: 'new-chat' })
          },
        },
        { type: 'separator' },
        { label: 'Salir', role: 'quit' },
      ])
    )
    tray.on('click', () => {
      win?.show()
      win?.focus()
    })
  } catch {}
}

// Notifica solo si la ventana no está al frente (tareas largas en background).
function notify(displayName, body) {
  if (!notifEnabled || !Notification.isSupported() || !win || win.isDestroyed() || win.isFocused()) return
  try {
    app.dock?.bounce('informational') // salto del ícono al terminar en background
  } catch {}
  const n = new Notification({
    title: `${displayName} terminó`,
    body: (body || '').replace(/\s+/g, ' ').slice(0, 140) || 'Tarea completada',
    silent: true, // ya tenemos nuestro "ding" dentro de la app
  })
  n.on('click', () => {
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  })
  n.show()
}

// Herramientas por modo. Lectura: investigar sin tocar nada.
const READ_TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch'
const WRITE_TOOLS = `${READ_TOOLS},Edit,Write,NotebookEdit,Bash`
// El Revisor PR además necesita las tools MCP de los conectores que usan los
// skills de PR del equipo (Jira/Slack): p. ej. flash-pre-pr setea el campo
// "PR en prod" con `editJiraIssue`. Cubrimos ambas variantes de nombre del
// conector Atlassian (con y sin "Rovo") por si el prefijo cambia.
const PR_MCP_TOOLS = 'mcp__claude_ai_Atlassian_Rovo,mcp__claude_ai_Atlassian,mcp__claude_ai_Slack'
const PR_TOOLS = `${WRITE_TOOLS},${PR_MCP_TOOLS}`

// Pizarra compartida: memoria común del squad en la raíz del proyecto.
let boardEnabled = true
ipcMain.handle('prefs:board', (_e, v) => {
  boardEnabled = !!v
  return { ok: true }
})
const SQUAD_BOARD_NOTE =
  'MEMORIA COMPARTIDA DEL SQUAD: el equipo comparte un archivo `SQUAD.md` en la raíz del proyecto (cwd) como pizarra común. ' +
  'Si es relevante para tu tarea, LÉELO al empezar (con Read) para ver en qué anda el resto. ' +
  'Cuando tomes una decisión importante, termines algo notable o dejes algo pendiente, AÑADE una línea breve al final de `SQUAD.md` firmando con tu nombre y la fecha (crea el archivo si no existe). ' +
  'No lo uses para tareas triviales ni lo llenes de ruido.'

// Perfiles = mismos alias que en zsh: claude-work / claude-private.
const PROFILE_DIRS = {
  work: () => path.join(app.getPath('home'), '.claude-work'),
  private: () => path.join(app.getPath('home'), '.claude-private'),
}
const PROJECT_ROOTS = { work: 'Workspace', private: 'personal' }
// Sin perfiles work/private (usuario con ~/.claude a secas): buscar raíces comunes.
const DEFAULT_ROOT_CANDIDATES = ['Workspace', 'workspace', 'Projects', 'projects', 'dev', 'code', 'repos', 'personal']

// Splash: ventana chica sin marco mientras carga el renderer.
let splash = null
function createSplash() {
  splash = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    backgroundColor: '#0e1417',
    webPreferences: { contextIsolation: true },
  })
  splash.loadFile(path.join(__dirname, 'splash.html'))
  splash.on('closed', () => {
    splash = null
  })
}
function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close()
  splash = null
}

// Bounds de la ventana persistidos: la app reabre donde y como la dejaste.
const boundsFile = () => path.join(app.getPath('userData'), 'window-bounds.json')
function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'))
    if (!(b.width >= 820 && b.height >= 640)) return null
    // válidos solo si siguen (mayormente) dentro de alguna pantalla conectada
    const { screen } = require('electron')
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y >= a.y - 10 && b.y < a.y + a.height - 60
    })
    return visible ? b : null
  } catch {
    return null
  }
}

function createWindow() {
  const b = savedBounds()
  win = new BrowserWindow({
    width: b?.width ?? 1100,
    height: b?.height ?? 820,
    x: b?.x,
    y: b?.y,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: '#0e1417',
    title: 'La Oficina',
    show: false, // aparece cuando el renderer está listo (el splash cubre la espera)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // guardar bounds al mover/redimensionar (debounced)
  let boundsTimer = null
  const persistBounds = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      try {
        if (win && !win.isDestroyed() && !win.isFullScreen()) {
          fs.writeFileSync(boundsFile(), JSON.stringify(win.getBounds()))
        }
      } catch {}
    }, 500)
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)

  win.once('ready-to-show', () => {
    win.show()
    closeSplash()
  })
  // red de seguridad: si ready-to-show no llega (renderer colgado), mostrar igual
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      win.show()
      closeSplash()
    }
  }, 15000)

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadURL('app://bundle/')
  }

  // Links externos (p. ej. la URL de un artifact publicado) van al navegador,
  // nunca a una ventana de Electron ni navegando la app misma.
  const isAppUrl = (url) => url.startsWith('http://localhost:5173') || url.startsWith('app://')
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })

  win.on('closed', () => {
    win = null
  })
}

const emit = (payload) => {
  if (win && !win.isDestroyed()) win.webContents.send('claude:event', payload)
}

// Qué está haciendo exactamente una herramienta (archivo, comando, búsqueda…).
function toolDetail(name, input = {}) {
  const base = (p) => (p ? String(p).split('/').pop() : '')
  try {
    switch (name) {
      case 'Edit':
      case 'Write':
      case 'Read':
        return base(input.file_path)
      case 'NotebookEdit':
        return base(input.notebook_path)
      case 'Bash':
        return (input.command || '').replace(/\s+/g, ' ').slice(0, 42)
      case 'Grep':
        return input.pattern ? `"${String(input.pattern).slice(0, 28)}"` : ''
      case 'Glob':
        return String(input.pattern || '').slice(0, 32)
      case 'WebSearch':
        return input.query ? `"${String(input.query).slice(0, 36)}"` : ''
      case 'WebFetch':
        return new URL(input.url).host
      default:
        return ''
    }
  } catch {
    return ''
  }
}

// Parser de una línea NDJSON del stream, ligado al rol que la produce.
function makeLineHandler(role, sessionKey, displayName) {
  return (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    if (msg.type === 'system' && msg.subtype === 'init') {
      if (msg.session_id) {
        sessions.set(sessionKey, msg.session_id)
        rememberSession(sessionKey, msg.session_id)
      }
      emit({ kind: 'init', role, sessionId: msg.session_id })
      return
    }

    if (msg.type === 'stream_event' && msg.event) {
      const ev = msg.event
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        emit({ kind: 'text', role, text: ev.delta.text })
      }
      // los tool_use NO se emiten desde aquí: el mensaje del asistente (abajo)
      // trae el mismo bloque con su input completo — emitir ambos duplicaba el
      // evento y el chip/burbuja parpadeaba (primero sin detalle, luego con él)
      return
    }

    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') {
          // aquí ya viene el input completo → detalle de QUÉ hace exactamente
          emit({ kind: 'tool', role, name: block.name, detail: toolDetail(block.name, block.input) })
          // la checklist del agente, tal cual la va actualizando
          if (block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
            emit({
              kind: 'todos',
              role,
              todos: block.input.todos.map((t) => ({ text: t.content || '', status: t.status || 'pending' })),
            })
          }
        }
      }
      return
    }

    if (msg.type === 'result') {
      if (msg.session_id) {
        sessions.set(sessionKey, msg.session_id)
        rememberSession(sessionKey, msg.session_id)
      }
      console.log('[claude:result]', role, JSON.stringify({ cost: msg.total_cost_usd, session: msg.session_id }))
      emit({ kind: 'done', role, result: msg.result ?? '', cost: msg.total_cost_usd ?? null, usage: msg.usage ?? null })
      notify(displayName, msg.result)
    }
  }
}

// Proyectos añadidos a mano (fuera de la carpeta raíz del perfil).
const customProjectsFile = (profile) => path.join(app.getPath('userData'), `projects-${profile}.json`)
function getCustomProjects(profile) {
  try {
    // se filtran rutas que ya no existen (repos movidos/borrados)
    return JSON.parse(fs.readFileSync(customProjectsFile(profile), 'utf8')).filter((p) => fs.existsSync(p))
  } catch {
    return []
  }
}
ipcMain.handle('projects:add', async (_e, profile) => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Agregar proyecto' })
  if (res.canceled || !res.filePaths[0]) return { ok: false }
  const dir = res.filePaths[0]
  const list = getCustomProjects(profile)
  if (!list.includes(dir)) {
    list.push(dir)
    try {
      fs.writeFileSync(customProjectsFile(profile), JSON.stringify(list, null, 2))
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }
  return { ok: true, path: dir, name: path.basename(dir) }
})

// Config para el renderer: perfiles, proyectos y modelos default.
ipcMain.handle('config:get', () => {
  const home = app.getPath('home')
  const profiles = Object.keys(PROFILE_DIRS).filter((p) => fs.existsSync(PROFILE_DIRS[p]()))
  const projectsByProfile = {}
  for (const p of profiles.length ? profiles : ['default']) {
    // raíces de proyectos del perfil: fija (work/private) o detectadas (default)
    const rootNames = PROJECT_ROOTS[p]
      ? [PROJECT_ROOTS[p]]
      : DEFAULT_ROOT_CANDIDATES.filter((r) => fs.existsSync(path.join(home, r)))
    const list = []
    for (const rootName of rootNames) {
      const root = path.join(home, rootName)
      list.push({ name: `🗂 ${rootName}`, path: root })
      try {
        fs.readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .forEach((d) =>
            list.push({
              name: rootNames.length > 1 ? `${rootName}/${d.name}` : d.name,
              path: path.join(root, d.name),
            })
          )
      } catch {}
    }
    if (!list.length) list.push({ name: '🏠 Home', path: home })
    // proyectos añadidos a mano (📌): van al final, sin duplicar los detectados
    for (const cp of getCustomProjects(p)) {
      if (!list.some((x) => x.path === cp)) list.push({ name: `📌 ${path.basename(cp)}`, path: cp })
    }
    projectsByProfile[p] = list
  }
  const defaultModels = {}
  for (const p of profiles) {
    try {
      defaultModels[p] = JSON.parse(fs.readFileSync(path.join(PROFILE_DIRS[p](), 'settings.json'), 'utf8')).model || null
    } catch {
      defaultModels[p] = null
    }
  }
  return { profiles: profiles.length ? profiles : ['default'], projectsByProfile, defaultModels }
})

ipcMain.handle('squad:get', (_e, profile) => getSquad(profile))

ipcMain.handle('squad:save', (_e, { profile, roster }) => {
  try {
    // Guarda el roster completo (built-ins con sus overrides + roles custom con
    // toda su definición) como array, para soportar roles añadidos/eliminados.
    const clean = (roster || []).map((r) =>
      r.custom
        ? {
            id: r.id,
            name: r.name,
            enabled: !!r.enabled,
            avatar: r.avatar || null,
            custom: true,
            emoji: r.emoji || '🛠️',
            color: r.color || '#38bdf8',
            hair: r.hair || '#1f2937',
            focus: r.focus || '',
            kw: r.kw || '',
          }
        : { id: r.id, name: r.name, enabled: !!r.enabled, avatar: r.avatar || null, custom: false },
    )
    // Built-ins borrables que ya NO están en el roster → tombstone para que
    // getSquad no los re-agregue. Los protegidos nunca se marcan como borrados.
    const present = new Set((roster || []).map((r) => r.id))
    for (const d of DEFAULT_SQUAD) {
      if (!present.has(d.id) && !PROTECTED_ROLES.has(d.id)) clean.push({ id: d.id, deleted: true })
    }
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(squadFile(profile), JSON.stringify(clean, null, 2))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Detiene la tarea en curso de un agente (mata su proceso claude).
ipcMain.handle('claude:stop', (_e, role) => {
  const child = children.get(role)
  if (!child) return { ok: false, error: 'no hay tarea corriendo' }
  child.stoppedByUser = true // para que el close no se reporte como error
  child.kill('SIGTERM')
  children.delete(role)
  emit({ kind: 'stopped', role })
  return { ok: true }
})

ipcMain.handle('claude:reset', () => {
  sessions.clear()
  return { ok: true }
})

// Restaura las sesiones de una conversación del historial (por rol).
ipcMain.handle('claude:setSession', (_e, { sessions: saved = {}, profile, cwd }) => {
  const workdir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home')
  sessions.clear()
  for (const [role, sid] of Object.entries(saved)) {
    if (sid) sessions.set(`${role}::${profile}::${workdir}`, sid)
  }
  return { ok: true }
})

ipcMain.handle('claude:ask', (_e, payload) => {
  const { prompt, profile = 'work', cwd, writeMode = false, model = '', role = 'dev', standup = false } =
    typeof payload === 'string' ? { prompt: payload } : payload

  if (children.has(role)) return { ok: false, error: `${role} ya está trabajando en algo` }

  const workdir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home')
  const sessionKey = `${role}::${profile}::${workdir}`
  // standup: si no hay conversación activa, retoma la ÚLTIMA sesión conocida
  const sid = sessions.get(sessionKey) || (standup ? getLastSessions().get(sessionKey) : undefined)

  const member = getSquad(profile).find((r) => r.id === role)
  const displayName = member?.name || role
  // Rol predefinido → su plantilla; rol personalizado → persona a partir del foco.
  let persona = ROLE_TEMPLATES[role]
    ? ROLE_TEMPLATES[role](displayName)
    : `Eres ${displayName}, ${member?.focus?.trim() || 'parte del squad'}. Preséntate como ${displayName} cuando te saluden.`
  // instrucción de artifacts: si el usuario pide un "artifact"/página/dashboard/visual,
  // generar un HTML autocontenido (CSS/JS inline) en esta carpeta.
  const artDir = getArtifactsDir()
  try {
    fs.mkdirSync(artDir, { recursive: true })
  } catch {}
  persona +=
    `\n\nDOCUMENTOS: si te piden un "documento", un "reporte", un "artifact", una página web, un dashboard, un diagrama o algo visual, ` +
    `créalo como un archivo HTML y guárdalo con la herramienta Write en la carpeta: ${artDir} ` +
    `(nombre descriptivo terminado en .html). El CSS y el JS van INLINE (sin CDNs ni librerías externas). ` +
    `IMÁGENES: puedes y debes usar imágenes cuando aporten. Busca en la web imágenes relevantes con WebSearch/WebFetch ` +
    `y consigue la URL DIRECTA del archivo de imagen (que termine en .png/.jpg/.svg/.webp). ` +
    `Para máxima fiabilidad, si tienes Bash disponible, descárgalas con curl a una subcarpeta 'assets/' junto al HTML y refiérelas con ruta relativa; ` +
    `si no, úsalas por su URL directa en <img src>. Si no consigues una imagen fiable, usa un emoji, un SVG inline o un placeholder — nunca dejes imágenes rotas. ` +
    `No publiques a internet ni uses .md para esto; la app abrirá el HTML renderizado.`
  // Rol publicador: procedimiento concreto para publicar artifacts en GitHub Pages.
  if (role === 'publish') {
    persona +=
      `\n\nPUBLICACIÓN EN GITHUB PAGES: eres quien publica artifacts en la web. Los artifacts viven en: ${artDir} ` +
      `(archivos .html, con posible subcarpeta 'assets/'). El destino es un repo PÚBLICO llamado "Artifacts" en la cuenta de GitHub del usuario. ` +
      `Usa Bash con 'gh' y 'git' (ya están autenticados). Procedimiento:\n` +
      `1) Dueño de la cuenta: 'gh api user -q .login'.\n` +
      `2) CONFIRMACIÓN OBLIGATORIA ANTES DE HACER NADA PÚBLICO: antes de crear el repo o hacer push, DETENTE y avisa claramente que el/los artifact(s) quedarán PÚBLICOS en internet (visibles por cualquiera con la URL e indexables por buscadores). Pregunta y ofrece opciones en tu respuesta, por ejemplo "Sí, publícalo" / "No". NO ejecutes push ni crees el repo hasta un OK explícito del usuario.\n` +
      `3) Tras el OK: si 'gh repo view <owner>/Artifacts' falla, créalo con 'gh repo create <owner>/Artifacts --public -d "Artifacts publicados desde La Oficina"'. Trabaja sobre un clon local del repo; copia el artifact (y su carpeta 'assets/' si existe); regenera un 'index.html' con la lista de todos los artifacts publicados; luego 'git add -A && git commit && git push' a la rama main. No borres artifacts ya publicados de otros: solo agrega o actualiza.\n` +
      `4) Activa Pages si aún no lo está: 'gh api -X POST repos/<owner>/Artifacts/pages -f "source[branch]=main" -f "source[path]=/"' (si ya estaba activo, ignora el error).\n` +
      `5) Devuelve la URL final: https://<owner-en-minúsculas>.github.io/Artifacts/<archivo>.html y avisa que el primer build de Pages puede tardar ~1 minuto en quedar disponible.`
  }
  // personalidad personalizada del usuario (userData/personas/<profile>/<role>.md)
  const customMd = readPersonaMd(profile, role)
  if (customMd) persona += `\n\nInstrucciones personalizadas de ${displayName}:\n${customMd}`
  if (boardEnabled) persona += `\n\n${SQUAD_BOARD_NOTE}`

  // El Revisor PR ejecuta skills que llaman conectores MCP (Jira/Slack). En
  // headless no hay prompt para aprobarlos y el conector OAuth puede aparecer con
  // un UUID en vez de su nombre, así que el allowlist por sí solo es frágil: para
  // el rol PR usamos bypassPermissions y el allowlist extendido (PR_TOOLS), y así
  // el flujo completo (push + gh pr create + acli + editJiraIssue) corre igual que
  // en la consola. El resto del squad sigue en acceptEdits con WRITE_TOOLS.
  const isPR = role === 'pr'
  const allowed = !writeMode ? READ_TOOLS : isPR ? PR_TOOLS : WRITE_TOOLS

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--allowedTools', allowed,
    '--append-system-prompt', persona,
  ]
  if (writeMode) args.push('--permission-mode', isPR ? 'bypassPermissions' : 'acceptEdits')
  if (model) args.push('--model', model)
  if (sid) args.push('--resume', sid)

  // Sin API key en el entorno → usa el login de la suscripción ($0 por token).
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  // El PATH del shell de login no llega a Electron: añade las rutas típicas
  // (Homebrew, ~/.local/bin) para que los agentes encuentren gh, acli, etc.
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', path.join(app.getPath('home'), '.local', 'bin')]
  env.PATH = [...new Set([...(env.PATH || '').split(':').filter(Boolean), ...extraPaths])].join(':')
  if (PROFILE_DIRS[profile]) env.CLAUDE_CONFIG_DIR = PROFILE_DIRS[profile]()
  else delete env.CLAUDE_CONFIG_DIR

  let child
  try {
    child = spawn(CLAUDE_BIN, args, { cwd: workdir, env })
  } catch (err) {
    return { ok: false, error: `No pude lanzar claude: ${err.message}` }
  }
  children.set(role, child)

  const handleLine = makeLineHandler(role, sessionKey, displayName)
  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (line) handleLine(line)
    }
  })
  // cola del stderr: si claude muere, las últimas líneas van al chat (antes
  // solo llegaban a la consola y el error era un "mira la terminal" a secas)
  let errTail = ''
  child.stderr.on('data', (chunk) => {
    const s = chunk.toString()
    errTail = (errTail + s).slice(-1500)
    console.error(`[claude:stderr:${role}]`, s)
  })
  child.on('error', (err) => {
    emit({ kind: 'error', role, message: `Error al ejecutar claude: ${err.message}` })
    children.delete(role)
  })
  child.on('close', (code) => {
    // una detención del usuario no es un error (SIGTERM sale con 143)
    if (code !== 0 && code !== null && !child.stoppedByUser) {
      emit({ kind: 'error', role, message: `claude terminó con código ${code}`, detail: errTail.trim() })
      notify(displayName, `⚠️ terminó con error (código ${code})`)
    }
    children.delete(role)
  })

  return { ok: true }
})

// ── Historial de conversaciones (JSON por conversación en userData) ─────────
const HIST_DIR = path.join(app.getPath('userData'), 'history')

ipcMain.handle('history:save', (_e, convo) => {
  try {
    fs.mkdirSync(HIST_DIR, { recursive: true })
    const p = path.join(HIST_DIR, `${convo.id}.json`)
    // el autosave del renderer no conoce el pin: preservarlo del archivo
    try {
      convo.pinned = convo.pinned ?? !!JSON.parse(fs.readFileSync(p, 'utf8')).pinned
    } catch {}
    fs.writeFileSync(p, JSON.stringify(convo, null, 2))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('history:list', () => {
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
          }
        } catch {
          return null
        }
      })
      .filter(Boolean)
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

ipcMain.handle('history:delete', (_e, id) => {
  try {
    fs.unlinkSync(path.join(HIST_DIR, `${id}.json`))
    return { ok: true }
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
  const res = await dialog.showSaveDialog(win, {
    defaultPath: `${safe}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  const when = convo.updatedAt ? new Date(convo.updatedAt).toLocaleString('es') : ''
  const lines = [
    `# ${convo.title || 'Conversación'}`,
    '',
    `> Perfil: ${convo.profile || '—'} · Proyecto: \`${convo.project || '—'}\` · Modelo: ${convo.model || '—'}${when ? ` · ${when}` : ''}`,
    '',
  ]
  for (const m of convo.messages || []) {
    const head = m.role === 'user' ? `## 👤 Tú${m.to ? ` → ${m.to}` : ''}` : `## 🤖 ${m.who || 'Agente'}`
    lines.push(head, '', m.text || '', '')
    if (m.artifact) lines.push(`> 📄 Documento: \`${m.artifact}\``, '')
    if (m.atts?.length) lines.push(`> 📎 Adjuntos: ${m.atts.map((a) => `\`${a.name || a.path || a}\``).join(', ')}`, '')
  }
  try {
    fs.writeFileSync(res.filePath, lines.join('\n'))
    return { ok: true, path: res.filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── Monitor de recursos + uso de Claude ──────────────────────────────────────
let lastCpus = os.cpus()
function cpuPercent() {
  const cur = os.cpus()
  let idle = 0
  let total = 0
  cur.forEach((c, i) => {
    const p = lastCpus[i]?.times || c.times
    for (const k of Object.keys(c.times)) total += c.times[k] - p[k]
    idle += c.times.idle - p.idle
  })
  lastCpus = cur
  return total > 0 ? Math.round((1 - idle / total) * 100) : 0
}

// Nombre del "service" del Keychain para cada perfil. Claude Code guarda el
// token OAuth en `Claude Code-credentials-<sha256(configDir)[:8]>` por perfil
// (y `Claude Code-credentials` a secas para la cuenta default ~/.claude).
function keychainService(profile) {
  const dir = PROFILE_DIRS[profile] ? PROFILE_DIRS[profile]() : null
  if (!dir) return 'Claude Code-credentials'
  const hash = crypto.createHash('sha256').update(dir).digest('hex').slice(0, 8)
  return `Claude Code-credentials-${hash}`
}

// Token OAuth de un perfil desde el Keychain (se queda en el main, nunca va al renderer).
function getOAuthToken(profile) {
  return new Promise((resolve) => {
    const svc = keychainService(profile)
    execFile('security', ['find-generic-password', '-s', svc, '-w'], (err, out) => {
      const parse = (o) => {
        try {
          return JSON.parse(o).claudeAiOauth?.accessToken || null
        } catch {
          return null
        }
      }
      if (!err) return resolve(parse(out))
      // fallback a la credencial default por si el perfil no tiene sufijo
      execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], (e2, o2) =>
        resolve(e2 ? null : parse(o2))
      )
    })
  })
}

// % de uso de la suscripción (mismo endpoint que usa la app de la barra de menú).
function fetchClaudeUsage(profile) {
  return getOAuthToken(profile).then((token) => {
    if (!token) return null
    return new Promise((resolve) => {
      const req = https.get(
        {
          hostname: 'api.anthropic.com',
          path: '/api/oauth/usage',
          headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
          timeout: 10000,
        },
        (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            try {
              // un error de la API (401 por token expirado, 5xx…) también trae
              // JSON parseable: sin este check producía {session:null, weekly:null},
              // que pisaba el último dato bueno y el monitor "desaparecía".
              // Solo un 200 con datos reales cuenta como éxito; lo demás → null
              // (la caché conserva el dato anterior y reintenta con backoff).
              if (res.statusCode !== 200) return resolve(null)
              const j = JSON.parse(body)
              if (!j.five_hour && !j.seven_day) return resolve(null)
              resolve({
                session: j.five_hour ? { pct: j.five_hour.utilization ?? 0, resetsAt: j.five_hour.resets_at } : null,
                weekly: j.seven_day ? { pct: j.seven_day.utilization ?? 0, resetsAt: j.seven_day.resets_at } : null,
              })
            } catch {
              resolve(null)
            }
          })
        }
      )
      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })
    })
  })
}

// RAM realmente usada (como el Activity Monitor: activa + wired + comprimida).
// os.freemem() engaña en macOS: el caché de archivos "llena" la RAM a propósito.
function realRamUsed() {
  return new Promise((resolve) => {
    execFile('vm_stat', (err, out) => {
      if (err) return resolve(os.totalmem() - os.freemem())
      try {
        const page = Number(out.match(/page size of (\d+)/)?.[1] || 16384)
        const grab = (label) => Number(out.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] || 0)
        const used = (grab('Pages active') + grab('Pages wired down') + grab('Pages occupied by compressor')) * page
        resolve(used || os.totalmem() - os.freemem())
      } catch {
        resolve(os.totalmem() - os.freemem())
      }
    })
  })
}

// Caché de uso por perfil (cada cuenta tiene su token y sus %).
const usageCache = {} // profile → { nextAt, fails, data, fetching }
ipcMain.handle('stats:refreshUsage', () => {
  for (const k of Object.keys(usageCache)) usageCache[k].nextAt = 0
  return { ok: true }
})
ipcMain.handle('stats:get', async (_e, profile = 'work') => {
  const c = (usageCache[profile] ||= { nextAt: 0, fails: 0, data: null, fetching: false })
  // Refresca cada 60s, pero evita disparar fetches en paralelo (fetching flag).
  if (!c.fetching && Date.now() >= c.nextAt) {
    c.fetching = true
    fetchClaudeUsage(profile).then((d) => {
      c.fetching = false
      if (d) {
        // éxito: guarda el dato y marca fresco por 60s
        c.data = d
        c.fails = 0
        c.nextAt = Date.now() + 60_000
      } else {
        // fallo (red/timeout/sin token): CONSERVA el último dato bueno y
        // reintenta con backoff (15s → 30s → 60s), no en cada poll de 3s —
        // sin token en el Keychain eso eran 2 procesos `security` por poll.
        c.fails += 1
        c.nextAt = Date.now() + Math.min(60_000, 15_000 * 2 ** (c.fails - 1))
      }
    })
  }
  const appMB = Math.round(app.getAppMetrics().reduce((s, p) => s + (p.memory?.workingSetSize || 0), 0) / 1024)
  return {
    cpu: cpuPercent(),
    ramUsed: await realRamUsed(),
    ramTotal: os.totalmem(),
    appMB,
    claude: c.data,
  }
})

// Ventana de la guía de uso (ayuda.html empaquetada con la app).
let helpWin = null
function openHelp() {
  if (helpWin && !helpWin.isDestroyed()) {
    helpWin.focus()
    return { ok: true }
  }
  helpWin = new BrowserWindow({
    width: 860,
    height: 760,
    backgroundColor: '#0e1417',
    title: 'La Oficina · Guía de uso',
  })
  helpWin.loadURL(isDev ? 'http://localhost:5173/ayuda.html' : 'app://bundle/ayuda.html')
  helpWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  helpWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost:5173') && !url.startsWith('app://')) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })
  helpWin.on('closed', () => {
    helpWin = null
  })
  return { ok: true }
}
ipcMain.handle('help:open', () => openHelp())

// ── Artifacts locales ────────────────────────────────────────────────────────
// Carpeta donde el squad guarda los artifacts HTML (configurable desde ⚙️).
const artifactsDirFile = () => path.join(app.getPath('userData'), 'artifacts-dir.txt')
function getArtifactsDir() {
  try {
    const d = fs.readFileSync(artifactsDirFile(), 'utf8').trim()
    if (d && fs.existsSync(d)) return d
  } catch {}
  return path.join(app.getPath('userData'), 'artifacts') // por defecto
}
ipcMain.handle('artifacts:getDir', () => getArtifactsDir())
ipcMain.handle('artifacts:pickDir', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (res.canceled || !res.filePaths[0]) return { ok: false }
  fs.writeFileSync(artifactsDirFile(), res.filePaths[0])
  return { ok: true, dir: res.filePaths[0] }
})
ipcMain.handle('artifacts:list', () => {
  const dir = getArtifactsDir()
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.html'))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f))
        return { name: f, path: path.join(dir, f), at: st.mtimeMs }
      })
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
})
ipcMain.handle('artifacts:open', (_e, file) => {
  if (!file || !fs.existsSync(file)) return { ok: false }
  const w = new BrowserWindow({ width: 1000, height: 780, backgroundColor: '#ffffff', title: path.basename(file) })
  w.loadFile(file)
  // El visor local se queda en el archivo; links externos dentro del artifact van al navegador.
  w.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })
  return { ok: true }
})
// Revela el artifact en Finder (seleccionado).
ipcMain.handle('artifacts:reveal', (_e, file) => {
  if (!file || !fs.existsSync(file)) return { ok: false }
  require('electron').shell.showItemInFolder(file)
  return { ok: true }
})
// Exporta el artifact + su carpeta assets/ en un .zip para compartir.
ipcMain.handle('artifacts:zip', async (_e, file) => {
  if (!file || !fs.existsSync(file)) return { ok: false }
  const base = path.basename(file, path.extname(file))
  const res = await dialog.showSaveDialog(win, { defaultPath: `${base}.zip` })
  if (res.canceled || !res.filePath) return { ok: false }
  const dir = path.dirname(file)
  // incluye el .html y, si existe, la carpeta assets/ (imágenes descargadas)
  const items = [path.basename(file)]
  if (fs.existsSync(path.join(dir, 'assets'))) items.push('assets')
  return new Promise((resolve) => {
    execFile('zip', ['-r', '-q', res.filePath, ...items], { cwd: dir }, (err) => {
      resolve(err ? { ok: false, error: err.message } : { ok: true, path: res.filePath })
    })
  })
})

// ── Skills de Claude Code por perfil ─────────────────────────────────────────
// Se instalan en CLAUDE_CONFIG_DIR/skills/<id>; los agentes headless las usan
// automáticamente al correr con ese perfil.
const skillsDirFor = (profile) =>
  path.join(PROFILE_DIRS[profile] ? PROFILE_DIRS[profile]() : path.join(app.getPath('home'), '.claude'), 'skills')

const execFileP = (cmd, args, opts) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, opts, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message || '').slice(0, 400))) : resolve(out)))
  )

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

// ── Plugins de Claude Code por perfil (marketplaces) ─────────────────────────
// Mismo entorno que los agentes headless: el CLI opera sobre el perfil elegido.
function claudeEnvFor(profile) {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', path.join(app.getPath('home'), '.local', 'bin')]
  env.PATH = [...new Set([...(env.PATH || '').split(':').filter(Boolean), ...extraPaths])].join(':')
  if (PROFILE_DIRS[profile]) env.CLAUDE_CONFIG_DIR = PROFILE_DIRS[profile]()
  else delete env.CLAUDE_CONFIG_DIR
  return env
}
const claudePlugin = (profile, args, timeout = 180000) =>
  execFileP(CLAUDE_BIN, ['plugin', ...args], { env: claudeEnvFor(profile), timeout, maxBuffer: 16 * 1024 * 1024 })

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

// ── Exportar/importar configuración (squad + personas + proyectos + extras) ──
const CONFIG_PROFILES = ['work', 'private', 'default']
ipcMain.handle('config:export', async (_e, extras) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: 'la-oficina-config.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  const data = { app: 'la-oficina', version: app.getVersion(), profiles: {}, extras: extras || null }
  try {
    data.artifactsDir = fs.readFileSync(artifactsDirFile(), 'utf8').trim() || null
  } catch {}
  for (const prof of CONFIG_PROFILES) {
    const entry = {}
    try {
      entry.squad = JSON.parse(fs.readFileSync(squadFile(prof), 'utf8'))
    } catch {}
    try {
      entry.projects = getCustomProjects(prof)
    } catch {}
    entry.personas = {}
    try {
      const dir = path.join(app.getPath('userData'), 'personas', prof)
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
        entry.personas[f.replace(/\.md$/, '')] = fs.readFileSync(path.join(dir, f), 'utf8')
      }
    } catch {}
    // skills instaladas (solo los ids: el import reinstala las del catálogo)
    try {
      const sdir = skillsDirFor(prof)
      entry.skills = fs
        .readdirSync(sdir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(sdir, d.name, 'SKILL.md')))
        .map((d) => d.name)
    } catch {}
    // servidores MCP del perfil (objeto completo del .claude.json)
    try {
      const cdir = PROFILE_DIRS[prof] ? PROFILE_DIRS[prof]() : path.join(app.getPath('home'), '.claude')
      const cj = JSON.parse(fs.readFileSync(path.join(cdir, '.claude.json'), 'utf8'))
      if (cj.mcpServers && Object.keys(cj.mcpServers).length) entry.mcp = cj.mcpServers
    } catch {}
    if (entry.squad || entry.projects?.length || Object.keys(entry.personas).length || entry.skills?.length || entry.mcp)
      data.profiles[prof] = entry
  }
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
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true }
  let data
  try {
    data = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'))
  } catch (err) {
    return { ok: false, error: `No es un JSON válido: ${err.message}` }
  }
  if (data.app !== 'la-oficina' || typeof data.profiles !== 'object') return { ok: false, error: 'Ese archivo no es una configuración de La Oficina' }
  const ans = await dialog.showMessageBox(win, {
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
    }
    return { ok: true, extras: data.extras || null, skills: skillsToInstall }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

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

ipcMain.handle('mcp:add', async (_e, { profile, name, url, cmd }) => {
  if (!/^[\w.-]{1,40}$/.test(name || '')) return { ok: false, error: 'Nombre inválido' }
  const args = ['mcp', 'add', '-s', 'user']
  if (url) args.push('--transport', 'http', name, url)
  else if (Array.isArray(cmd) && cmd.length) args.push(name, '--', ...cmd)
  else return { ok: false, error: 'Falta el comando o la URL' }
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

// Diff del proyecto (staged + unstaged) para la vista de cambios del agente.
ipcMain.handle('git:diff', async (_e, cwd) => {
  if (!cwd) return { ok: false, error: 'Sin proyecto seleccionado' }
  return new Promise((resolve) => {
    execFile('git', ['diff', 'HEAD'], { cwd, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err && !out) return resolve({ ok: false, error: String(err.message || 'git diff falló').slice(0, 300) })
      let diff = out || ''
      if (diff.length > 300000) diff = diff.slice(0, 300000) + '\n… (recortado)'
      // los archivos nuevos sin trackear no salen en el diff: listarlos aparte
      execFile('git', ['ls-files', '--others', '--exclude-standard'], { cwd }, (_e2, untracked) => {
        resolve({ ok: true, diff, untracked: (untracked || '').split('\n').filter(Boolean) })
      })
    })
  })
})

// Info de una ruta arrastrada (archivo vs carpeta).
ipcMain.handle('path:info', (_e, p) => {
  try {
    const st = fs.statSync(p)
    return { ok: true, path: p, name: path.basename(p), isDir: st.isDirectory() }
  } catch {
    return { ok: false }
  }
})

// Guarda una imagen pegada/arrastrada para que el squad la pueda leer.
ipcMain.handle('image:save', (_e, { name, data }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'attachments')
    fs.mkdirSync(dir, { recursive: true })
    const ext = (name && path.extname(name)) || '.png'
    const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
    fs.writeFileSync(file, Buffer.from(data))
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Abre la pizarra compartida SQUAD.md del proyecto (la crea si no existe).
ipcMain.handle('board:open', (_e, cwd) => {
  const dir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home')
  const file = path.join(dir, 'SQUAD.md')
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, '# 🧠 Pizarra del squad\n\nMemoria común del equipo. Cada quien anota aquí lo importante.\n')
    }
    // -t abre en el editor de texto por defecto (fiable para .md); fallback a open normal
    execFile('open', ['-t', file], (err) => {
      if (err) execFile('open', [file], () => {})
    })
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Abre la terminal (Warp si está, si no la predeterminada) en el proyecto actual.
ipcMain.handle('terminal:open', (_e, cwd) => {
  const dir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home')
  const hasWarp = fs.existsSync('/Applications/Warp.app')
  return new Promise((resolve) => {
    // `open -a X <dir>` abre esa app con la carpeta como argumento
    const args = hasWarp ? ['-a', 'Warp', dir] : ['-a', 'Terminal', dir]
    execFile('open', args, (err) => {
      if (err) {
        // último recurso: Terminal.app
        execFile('open', ['-a', 'Terminal', dir], (e2) =>
          resolve(e2 ? { ok: false, error: e2.message } : { ok: true, app: 'Terminal' })
        )
      } else {
        resolve({ ok: true, app: hasWarp ? 'Warp' : 'Terminal' })
      }
    })
  })
})

ipcMain.handle('app:version', () => app.getVersion())

// Limpieza al arrancar: adjuntos e historial crecían sin límite.
// - attachments: imágenes pegadas de más de 7 días (ya viajaron en su prompt)
// - history: se conservan las 100 conversaciones más recientes
function pruneStorage() {
  const WEEK = 7 * 24 * 3600 * 1000
  const attDir = path.join(app.getPath('userData'), 'attachments')
  try {
    for (const f of fs.readdirSync(attDir)) {
      const p = path.join(attDir, f)
      try {
        if (Date.now() - fs.statSync(p).mtimeMs > WEEK) fs.unlinkSync(p)
      } catch {}
    }
  } catch {}
  try {
    const convos = fs
      .readdirSync(HIST_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const p = path.join(HIST_DIR, f)
        let pinned = false
        try {
          pinned = !!JSON.parse(fs.readFileSync(p, 'utf8')).pinned
        } catch {}
        return { p, at: fs.statSync(p).mtimeMs, pinned }
      })
      .sort((a, b) => b.at - a.at)
    // las fijadas 📌 no cuentan para el límite ni se purgan
    for (const { p } of convos.filter((c) => !c.pinned).slice(100)) {
      try {
        fs.unlinkSync(p)
      } catch {}
    }
  } catch {}
}

// ¿a.b.c es más nueva que x.y.z?
function isNewerVersion(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

// Descarga el DMG del release a ~/Downloads y abre el instalador al terminar.
// Si algo falla, cae al navegador (que descarga el mismo archivo).
function downloadUpdate(dmgUrl, version) {
  const ses = win?.webContents?.session
  if (!ses) {
    shell.openExternal(dmgUrl)
    return
  }
  ses.once('will-download', (_e, item) => {
    const dest = path.join(app.getPath('downloads'), item.getFilename())
    item.setSavePath(dest)
    item.once('done', (_ev, state) => {
      if (state === 'completed') {
        const ok = new Notification({ title: 'La Oficina', body: `v${version} descargada — abriendo el instalador…` })
        ok.show()
        shell.openPath(dest)
      } else {
        shell.openExternal(dmgUrl)
      }
    })
  })
  new Notification({ title: 'La Oficina', body: `Descargando v${version}…` }).show()
  ses.downloadURL(dmgUrl)
}

// Aviso de nueva versión (sin auto-update): consulta el último release de
// GitHub en cada arranque y notifica como mucho una vez por versión (se
// recuerda la última notificada). Clic en la notificación descarga el DMG
// y abre el instalador (o abre el release si el asset no está).
function checkForUpdates() {
  if (isDev) return // el dev comparte userData con la app instalada: no interferir
  const stamp = path.join(app.getPath('userData'), 'last-notified-version.txt')
  try {
    fs.unlinkSync(path.join(app.getPath('userData'), 'last-update-check.txt')) // stamp del esquema anterior
  } catch {}
  const req = https.get(
    {
      hostname: 'api.github.com',
      path: '/repos/DiegoHCH/the_office/releases/latest',
      headers: { 'User-Agent': 'la-oficina', Accept: 'application/vnd.github+json' },
      timeout: 8000,
    },
    (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) return // sin releases (404) o rate-limited: silencio
          const j = JSON.parse(body)
          const latest = String(j.tag_name || '').replace(/^v/, '')
          if (!latest || !isNewerVersion(latest, app.getVersion())) return
          let notified = ''
          try {
            notified = fs.readFileSync(stamp, 'utf8').trim()
          } catch {}
          if (notified === latest) return // ya se avisó de esta versión
          if (!Notification.isSupported()) return
          // el DMG de esta arquitectura, si el release lo trae
          const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
          const assets = j.assets || []
          const dmg = assets.find((a) => a.name?.endsWith(`${arch}.dmg`)) || assets.find((a) => a.name?.endsWith('.dmg'))
          const n = new Notification({
            title: 'La Oficina',
            body: `Hay una versión nueva: v${latest} (tienes v${app.getVersion()}). Clic para ${dmg ? 'descargarla' : 'ver el release'}.`,
          })
          n.on('click', () => {
            if (dmg?.browser_download_url) downloadUpdate(dmg.browser_download_url, latest)
            else shell.openExternal(j.html_url || 'https://github.com/DiegoHCH/the_office/releases')
          })
          n.show()
          try {
            fs.writeFileSync(stamp, latest) // solo tras mostrarla: un fallo no quema el aviso
          } catch {}
        } catch {}
      })
    }
  )
  req.on('error', () => {})
  req.on('timeout', () => req.destroy())
}

app.whenReady().then(() => {
  pruneStorage()
  createTray()
  // Si el sistema durmió pese a todo (batería crítica, tapa cerrada), avisar
  // al renderer al despertar: las tareas que estaban corriendo quedaron rotas.
  powerMonitor.on('resume', () => {
    try {
      win?.webContents.send('claude:event', { kind: 'system-resumed' })
    } catch {}
  })
  // Atajo global ⌥Espacio: trae la app al frente con el composer enfocado,
  // listo para lanzar un prompt desde cualquier otra app.
  try {
    globalShortcut.register('Alt+Space', () => {
      if (!win || win.isDestroyed()) return
      if (win.isFocused()) {
        win.hide() // segundo toque: se aparta, como Spotlight
        return
      }
      win.show()
      win.focus()
      win.webContents.send('claude:event', { kind: 'focus-composer' })
    })
  } catch {}
  setTimeout(checkForUpdates, 5000) // sin estorbar el arranque
  if (!isDev) {
    protocol.handle('app', (req) => {
      let p = decodeURIComponent(new URL(req.url).pathname)
      if (p === '/' || p === '') p = '/index.html'
      return net.fetch(pathToFileURL(path.join(__dirname, '..', 'dist', p)).toString())
    })
  }
  console.log('[oficina] usando binario claude en:', CLAUDE_BIN)
  createSplash()
  createWindow()
  // Primer arranque tras instalar: abrir la Guía de uso encima de la ventana
  // principal (una sola vez), para que el usuario vea requisitos y cómo
  // hablarle al squad antes de empezar.
  const firstRunFlag = path.join(app.getPath('userData'), 'first-run-done')
  if (!fs.existsSync(firstRunFlag)) {
    try {
      fs.writeFileSync(firstRunFlag, String(Date.now()))
    } catch {}
    win.once('show', () => setTimeout(openHelp, 700))
  }
  // Aviso claro al arrancar si no encontramos el binario — antes el fallo
  // aparecía como "spawn claude ENOENT" recién al enviar el primer mensaje.
  // (se muestra cuando la ventana ya es visible: un sheet sobre una ventana
  // oculta no se vería)
  if (CLAUDE_BIN === 'claude') {
    win.once('show', () => dialog.showMessageBox(win, {
      type: 'warning',
      title: 'La Oficina',
      message: 'No encontré el binario de Claude Code',
      detail:
        'Busqué en ~/.local/bin, /usr/local/bin y /opt/homebrew/bin.\n\n' +
        'Instálalo con:\n  curl -fsSL https://claude.ai/install.sh | bash\n\n' +
        'inicia sesión con `claude` en la terminal y vuelve a abrir La Oficina.',
    }))
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

const killAll = () => {
  for (const child of children.values()) child.kill()
  children.clear()
}
app.on('before-quit', killAll)
app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll()
  } catch {}
})
app.on('window-all-closed', () => {
  killAll()
  if (process.platform !== 'darwin') app.quit()
})
