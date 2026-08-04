const { app, BrowserWindow, ipcMain, protocol, net, Notification, dialog, shell, clipboard, Tray, Menu, nativeImage, globalShortcut, powerSaveBlocker, powerMonitor, session } = require('electron')
const { spawn, execFile } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const https = require('node:https')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
// lógica pura y testeable del main (#116)
const {
  sanitizeEnv,
  sessionKey,
  pickSafeMcp,
  parseUsage,
  gitignoreConSquad,
  buildClaudeArgs,
  esProyectoFlutter,
  buscaProyectosFlutter,
  parseEmuladores,
  idsEmuladorAdb,
  marcaEmuladoresCorriendo,
  resultadoLanzarEmulador,
  parseLineaDaemon,
  peticionRecarga,
  comoCancelar,
  resultadoRecarga,
  aplicaProgreso,
  progresoVisible,
  decideRecarga,
  parseLaunchConfigs,
  argsDeLaunchConfig,
  interpretaCorrer,
  plataformaOcupada,
  plataformasDelProyecto,
  filtraPorPlataforma,
  dispositivoDeDaemon,
  scriptsDelProyecto,
  gestorDePaquetes,
  argsDeScript,
  urlDeSalida,
  interpretaScript,
  parsePathDeShell,
  parseMakefile,
  agrupaTargets,
  ordenaDispositivos,
  subDeMensaje,
  tocaLimpiarCache,
  CACHE_MAX,
  clavesDeSesion,
  quitaProyecto,
  agregaProyecto,
} = require('./lib/core.js')

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

// Avisar de algo que solo el renderer sabe nombrar. Un subagente termina dentro
// del turno del principal, así que el proceso principal ve el cierre pero no a
// quién corresponde: el personaje prestado y su encargo se deciden arriba.
ipcMain.handle('notify:custom', (_e, { title, body }) => {
  notify(String(title || '').slice(0, 80), String(body || ''))
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
    tray?.setTitle(n > 0 ? ` ${n}` : '') // solo el contador junto al icono
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
    // icono «template» monocromo: macOS lo tiñe según el tema, como el resto
    // de la barra de menús (el emoji a color desentonaba)
    const iconPath = path.join(__dirname, '..', 'build', 'trayTemplate.png')
    let icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) icon = nativeImage.createEmpty()
    icon.setTemplateImage(true)
    tray = new Tray(icon)
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

// Notifica al terminar un turno, con la ventana al frente o no. Antes solo en
// background, pero un turno puede tardar minutos y quien está mirando otra cosa
// DENTRO de la app —leyendo otra pestaña, revisando un diff— se lo perdía igual.
// El rebote del dock sí sigue siendo solo de background: con la ventana delante
// no llama la atención de nadie y el ícono salta por una app que ya estás usando.
function notify(displayName, body) {
  // Fallar mudo aquí es lo peor que puede hacer: el usuario no distingue «no
  // hubo aviso» de «el aviso no llegó». El motivo queda en Diagnóstico.
  const motivo = !notifEnabled
    ? 'desactivadas en Preferencias (van con el interruptor del sonido)'
    : !Notification.isSupported()
      ? 'el sistema no las soporta'
      : !win || win.isDestroyed()
        ? 'sin ventana'
        : null
  if (motivo) {
    emit({ kind: 'system', role: 'app', subtype: 'notif-omitida', fields: motivo })
    return
  }
  try {
    if (!win.isFocused()) app.dock?.bounce('informational')
  } catch {}
  const n = new Notification({
    title: `${displayName} terminó`,
    // sin texto no se anuncia como respuesta: el turno terminó, y ya
    body: (body || '').replace(/\s+/g, ' ').slice(0, 140) || 'Terminó sin respuesta',
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

// Idioma de la interfaz (#103): el squad contesta en el mismo idioma que ve
// el usuario, aunque las plantillas de persona estén escritas en español.
let answerLang = 'Spanish'
ipcMain.handle('prefs:lang', (_e, v) => {
  answerLang = v === 'English' ? 'English' : 'Spanish'
  return { ok: true }
})

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
  'Si el proyecto es un repo git y `SQUAD.md` no está en el `.gitignore` de la raíz, agrégalo (la pizarra es memoria local: no debe colarse en los commits). ' +
  'No lo uses para tareas triviales ni lo llenes de ruido.'

// La pizarra es memoria local: en repos git se mantiene fuera de los commits.
function ensureSquadIgnored(dir) {
  try {
    if (!fs.existsSync(path.join(dir, '.git'))) return
    const gi = path.join(dir, '.gitignore')
    const nuevo = gitignoreConSquad(fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '')
    if (nuevo) fs.writeFileSync(gi, nuevo)
  } catch {}
}

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
      // Sin esto, Chromium suspende el render y throttlea los timers cuando la
      // ventana no está al frente: el trabajo del agente avanzaba igual, pero la
      // respuesta no se pintaba hasta volver a enfocarla y parecía congelada.
      // La escena 3D no se dispara por esto: Office.jsx pasa el frameloop a
      // 'demand' cuando la ventana pierde el foco o se oculta.
      backgroundThrottling: false,
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

// La herramienta de subagentes se llama `Agent` en unas sesiones y `Task` en
// otras —verificado que el CLI usa ambos nombres—, así que atarse a uno deja la
// delegación invisible según con cuál toque: sin pestaña, sin personaje, y el
// trabajo del subagente cayendo encima del principal.
const esDelegacion = (name) => name === 'Agent' || name === 'Task'

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
      // delegar: lo que importa es QUÉ se delegó, no que se delegó
      case 'Agent':
      case 'Task':
        return String(input.description || input.prompt || '').replace(/\s+/g, ' ').slice(0, 42)
      default:
        return ''
    }
  } catch {
    return ''
  }
}

// Ruta COMPLETA del archivo que toca una herramienta de edición. El detalle que
// se pinta en la burbuja es solo el nombre del archivo, pero la vista de cambios
// necesita la ruta entera para saber en qué repo cae (ver el handler git:diff).
function rutaEditada(name, input = {}) {
  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') return input.file_path || null
  if (name === 'NotebookEdit') return input.notebook_path || null
  return null
}

// Parser de una línea NDJSON del stream, ligado al rol que la produce.
function makeLineHandler(role, claveSesion, displayName) {
  return (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    if (msg.type === 'system' && msg.subtype === 'init') {
      if (msg.session_id) {
        sessions.set(claveSesion, msg.session_id)
        rememberSession(claveSesion, msg.session_id)
      }
      emit({ kind: 'init', role, sessionId: msg.session_id })
      return
    }

    // Cualquier otro mensaje de sistema queda registrado en Diagnóstico con su
    // subtipo y campos (#123). Hoy no sabemos qué emite Claude Code al compactar
    // el contexto —la documentación del SDK no lo menciona— así que en vez de
    // adivinar el nombre, esto deja la evidencia la próxima vez que ocurra.
    if (msg.type === 'system') {
      const campos = Object.keys(msg).filter((k) => k !== 'type' && k !== 'subtype' && k !== 'session_id')
      emit({ kind: 'system', role, subtype: msg.subtype || '(sin subtipo)', fields: campos.join(', ') })
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

    // Un subagente cierra cuando el principal recibe el tool_result de su
    // tool_use (verificado contra el stream). Es la señal para liberar su
    // personaje y dar su pestaña por terminada.
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          emit({ kind: 'sub-done', role, subId: block.tool_use_id, isError: !!block.is_error })
        }
      }
      return
    }

    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      // Ocupación del contexto: la de ESTA llamada a la API. El usage del
      // `result` es el ACUMULADO del turno —suma todas las llamadas del bucle
      // agéntico— y como cada una vuelve a leer el contexto cacheado, un turno
      // con veinte herramientas reporta millones de tokens: el monitor marcaba
      // 100% en el primer mensaje de la conversación. Aquí, además, se actualiza
      // mientras el turno avanza en vez de solo al final.
      // El del PRINCIPAL es el que ocupa esta conversación. El de un subagente va
      // marcado como suyo: no cuenta para el monitor, pero sirve para saber
      // cuánto trabajo se hizo FUERA de este hilo, que es lo que justifica haber
      // repartido.
      const sub = subDeMensaje(msg)
      if (msg.message.usage) emit({ kind: 'ctx', role, sub, usage: msg.message.usage })
      for (const block of msg.message.content) {
        // El texto del principal llega por deltas (stream_event) y NO se emite
        // aquí, o saldría dos veces. El de un subagente no: verificado contra el
        // binario, los deltas son siempre del principal. Así que el único sitio
        // donde el texto de un subagente aparece es este.
        if (sub && block.type === 'text' && block.text) {
          emit({ kind: 'text', role, sub, text: block.text })
        }
        // el razonamiento llega completo en el bloque (#122); se emite entero y
        // no por deltas, igual que los tool_use, para no pintarlo a trozos
        if (block.type === 'thinking' && block.thinking) {
          emit({ kind: 'thinking', role, sub, text: block.thinking })
        }
        if (block.type === 'tool_use') {
          // Delegar es lo único que abre puesto y pestaña: se avisa aparte del
          // chip de herramienta, con el encargo tal como lo escribió el agente.
          if (esDelegacion(block.name) && !sub) {
            emit({
              kind: 'sub-start',
              role,
              subId: block.id,
              desc: block.input?.description || block.input?.prompt || '',
              tipo: block.input?.subagent_type || null,
            })
          }
          // …y NO se emite además como herramienta suya: delegar no es «correr
          // un comando». Si se emitiera, el principal saldría en la escena
          // «Usando Agent · comparar X» —haciendo el trabajo que acaba de
          // repartir— y el usuario ve a quien delega ocupando el sitio de quien
          // trabaja. Quien lo hace es el subagente, en su personaje.
          if (esDelegacion(block.name) && !sub) continue
          // aquí ya viene el input completo → detalle de QUÉ hace exactamente
          emit({
            kind: 'tool',
            role,
            sub,
            name: block.name,
            detail: toolDetail(block.name, block.input),
            path: rutaEditada(block.name, block.input),
          })
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
        sessions.set(claveSesion, msg.session_id)
        rememberSession(claveSesion, msg.session_id)
      }
      console.log('[claude:result]', role, JSON.stringify({ cost: msg.total_cost_usd, session: msg.session_id, subtype: msg.subtype, is_error: msg.is_error }))
      // is_error y subtype vienen en el result y se estaban tirando: sin ellos, un
      // turno que acabó MAL era indistinguible de uno que acabó sin decir nada, y
      // se anunciaba como «terminó el turno sin decir nada» ocultando el error.
      emit({
        kind: 'done',
        role,
        result: msg.result ?? '',
        isError: !!msg.is_error,
        subtype: msg.subtype || null,
        cost: msg.total_cost_usd ?? null,
        usage: msg.usage ?? null,
      })
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
// Proyectos que el usuario quitó de la lista. Los detectados (subcarpetas de la
// raíz del perfil) se recalculan leyendo el disco, así que la única forma de que
// dejen de aparecer es recordar que se ocultaron.
const hiddenProjectsFile = (profile) => path.join(app.getPath('userData'), `hidden-projects-${profile}.json`)
function getHiddenProjects(profile) {
  try {
    return JSON.parse(fs.readFileSync(hiddenProjectsFile(profile), 'utf8'))
  } catch {
    return []
  }
}
function guardaListas(profile, { custom, ocultos }) {
  fs.writeFileSync(customProjectsFile(profile), JSON.stringify(custom, null, 2))
  fs.writeFileSync(hiddenProjectsFile(profile), JSON.stringify(ocultos, null, 2))
}

ipcMain.handle('projects:add', async (_e, profile) => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Agregar proyecto' })
  if (res.canceled || !res.filePaths[0]) return { ok: false }
  const dir = res.filePaths[0]
  try {
    guardaListas(
      profile,
      agregaProyecto({ custom: getCustomProjects(profile), ocultos: getHiddenProjects(profile), path: dir })
    )
  } catch (err) {
    return { ok: false, error: err.message }
  }
  return { ok: true, path: dir, name: path.basename(dir) }
})

ipcMain.handle('projects:remove', (_e, { profile, path: dir }) => {
  if (!dir) return { ok: false, error: 'sin ruta' }
  try {
    const custom = getCustomProjects(profile)
    guardaListas(
      profile,
      quitaProyecto({ custom, ocultos: getHiddenProjects(profile), path: dir, detectado: !custom.includes(dir) })
    )
  } catch (err) {
    return { ok: false, error: err.message }
  }
  return { ok: true }
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
      // `raiz`/`padre`: la lista es plana pero el desplegable la pinta anidada.
      // Un proyecto que vive DENTRO de otro debe verse dentro, no al lado: si no,
      // `Workspace` y `Workspace/front-mobile-b2c` parecen dos sitios sin
      // relación, y el segundo hereda el CLAUDE.md del primero.
      list.push({ name: `🗂 ${rootName}`, path: root, raiz: true })
      try {
        fs.readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .forEach((d) =>
            list.push({
              name: d.name,
              path: path.join(root, d.name),
              padre: root,
            })
          )
      } catch {}
    }
    // proyectos añadidos a mano (📌): van al final, sin duplicar los detectados
    for (const cp of getCustomProjects(p)) {
      if (list.some((x) => x.path === cp)) continue
      // Una carpeta añadida a mano puede ser dos cosas muy distintas: un
      // proyecto (un repo) o un workspace que CONTIENE proyectos. Listar las
      // subcarpetas de un repo sería ruido puro —`src`, `ios`, `android`—, así
      // que solo se expande lo que no es repo. Es la misma distinción que hace
      // el usuario en su cabeza, y `.git` la responde sin preguntar.
      const esRepo = fs.existsSync(path.join(cp, '.git'))
      list.push({ name: `📌 ${path.basename(cp)}`, path: cp, raiz: !esRepo })
      if (esRepo) continue
      try {
        fs.readdirSync(cp, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .forEach((d) => list.push({ name: d.name, path: path.join(cp, d.name), padre: cp }))
      } catch {}
    }
    // los que el usuario quitó de la lista
    const ocultos = new Set(getHiddenProjects(p))
    // ocultar una raíz oculta también lo que hay dentro: dejar hijos huérfanos
    // sin su padre los pintaría indentados bajo la raíz equivocada
    let visibles = list.filter((x) => !ocultos.has(x.path) && !(x.padre && ocultos.has(x.padre)))
    // nunca dejarlo sin nada donde trabajar
    if (!visibles.length) visibles = [{ name: '🏠 Home', path: home }]
    projectsByProfile[p] = visibles
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
            // el modelo y el esfuerzo propios son del rol, no del catálogo, así
            // que si no se guardan aquí se pierden en el siguiente guardado
            model: r.model || null,
            effort: r.effort || null,
          }
        : {
            id: r.id,
            name: r.name,
            enabled: !!r.enabled,
            avatar: r.avatar || null,
            custom: false,
            model: r.model || null,
            effort: r.effort || null,
          },
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
ipcMain.handle('claude:setSession', (_e, { sessions: saved = {}, profile, cwd, cwds = {} }) => {
  // `cwds` trae el proyecto de cada rol: con una pestaña por proyecto, cada uno
  // puede estar trabajando en un sitio distinto. Ver `clavesDeSesion`.
  sessions.clear()
  for (const [k, v] of clavesDeSesion({
    sessions: saved,
    profile,
    cwd,
    cwds,
    home: app.getPath('home'),
    existe: (d) => fs.existsSync(d),
  })) {
    sessions.set(k, v)
  }
  return { ok: true }
})

ipcMain.handle('claude:ask', async (_e, payload) => {
  const { prompt, profile = 'work', cwd, writeMode = false, model = '', effort = '', role = 'dev', standup = false, repartir = false } =
    typeof payload === 'string' ? { prompt: payload } : payload

  if (children.has(role)) return { ok: false, error: `${role} ya está trabajando en algo` }

  const workdir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home')
  const sesion = sessionKey(role, profile, workdir)
  // standup: si no hay conversación activa, retoma la ÚLTIMA sesión conocida
  const sid = sessions.get(sesion) || (standup ? getLastSessions().get(sesion) : undefined)

  const member = getSquad(profile).find((r) => r.id === role)
  const displayName = member?.name || role
  // Rol predefinido → su plantilla; rol personalizado → persona a partir del foco.
  let persona = ROLE_TEMPLATES[role]
    ? ROLE_TEMPLATES[role](displayName)
    : `Eres ${displayName}, ${member?.focus?.trim() || 'parte del squad'}. Preséntate como ${displayName} cuando te saluden.`
  // Un rol que contesta fuera de su área hace daño doble: da una respuesta
  // genérica que PARECE la buena, y de paso impide que la tome quien sí sabe.
  persona +=
    `\n\nALCANCE: si lo que te piden no es de tu área, NO respondas a medias. ` +
    `Dilo en una frase, di de quién del equipo es, y ofrece pasárselo. ` +
    `Una respuesta genérica de quien no es el experto es peor que no responder: parece una respuesta, y ocupa el sitio de la buena.`

  // Delegación: solo si el usuario la pidió.
  //
  // Antes esto se inyectaba en CADA mensaje, así que todo agente iba autorizado
  // a repartir «un encargo con partes independientes» — y un encargo con una
  // lista de tareas dentro (un refinamiento técnico, una HU con sus tareas de
  // front) encaja en esa descripción. El usuario pedía UN documento y recibía
  // cinco pestañas que luego hay que recoser. Repartir es caro y cambia la forma
  // del resultado, así que ahora se pide: con `/repartir` o diciéndolo.
  //
  // El tope de 5 no es capricho: la oficina tiene seis puestos y este agente ya
  // ocupa uno, y cada subagente es trabajo real compitiendo por la máquina del
  // usuario. Cuántos lanza lo decide el modelo —el CLI no ofrece limitarlo— así
  // que aquí se pide, y en el renderer se aplica el tope de puestos.
  if (repartir) {
    persona +=
      `\n\nDELEGAR: este encargo tiene partes independientes y el usuario ha pedido repartirlo. ` +
      `Usa la herramienta Agent: da a cada subagente su propio contexto y evita saturar el tuyo. Máximo CINCO a la vez. ` +
      `Dale a cada uno una descripción corta y concreta de su parte: se muestra al usuario como título de su pestaña. `
      // El usuario ve una oficina con personajes, no un CLI: «lancé dos
      // subagentes en paralelo» nombra la tubería. Lo que ve es que asignaste
      // trabajo a gente que se puso a trabajar.
      + `Cuéntalo como lo que el usuario ve: ASIGNAS partes del trabajo a miembros del equipo, cada uno con su pestaña. ` +
      `Di «asigno» o «reparto», no «lanzo subagentes en paralelo» ni «uso la herramienta Agent»: eso nombra la tubería, no el trabajo. ` +
      `Usa SIEMPRE subagent_type "companero": es el miembro del equipo definido para esto, y es lo que garantiza que te contesten en ${answerLang}. `
      // El subagente arranca con el system prompt del CLI, no con esta persona, así
      // que la instrucción de idioma NO le llega: contestaba en inglés aunque el
      // usuario tenga español. Solo el que delega puede pasársela, en el encargo.
      + `Escribe el encargo de cada subagente en ${answerLang} y pídele explícitamente que responda en ${answerLang}: ` +
      `su respuesta la lee el usuario en una pestaña propia, y no hereda tus instrucciones de idioma. ` +
      `Cuando terminen, resume tú el conjunto en tu respuesta — el usuario ve el detalle de cada uno por separado, ` +
      `así que tu resumen debe ser la conclusión, no la transcripción.`
  } else {
    // Sin esto el modelo reparte igual cuando el encargo «parece» divisible: la
    // herramienta Agent sigue estando disponible aunque no la nombremos.
    persona +=
      `\n\nHAZLO TÚ: el usuario te lo ha pedido a ti. NO uses la herramienta Agent ni repartas el trabajo entre otros, ` +
      `aunque el encargo contenga una lista de tareas o partes que parezcan independientes: una lista dentro de un ` +
      `encargo describe el trabajo, no pide que se divida. Si de verdad crees que conviene repartirlo, dilo en una frase ` +
      `al final y deja que el usuario lo decida — puede pedirlo con /repartir.`
  }

  // instrucción de artifacts: si el usuario pide un "artifact"/página/dashboard/visual,
  // generar un HTML autocontenido (CSS/JS inline) en esta carpeta.
  const artDir = getArtifactsDir(profile)
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
  // El «y si delegas» va aquí, en la regla de idioma, además de en DELEGAR: los
  // subagentes arrancan con el system prompt del CLI y por defecto contestan en
  // inglés, y solo el que reparte puede imponerles el idioma, dentro del encargo.
  persona +=
    `\n\nIDIOMA: responde SIEMPRE en ${answerLang}, sin importar el idioma de estas instrucciones. ` +
    `Esto incluye lo que delegas: cada encargo a un subagente va escrito en ${answerLang} y termina exigiéndole ` +
    `que responda en ${answerLang}. Un subagente NO hereda esta instrucción, así que si no se la das, contestará en inglés ` +
    `y el usuario leerá su pestaña en un idioma que no es el suyo.`

  // El Revisor PR ejecuta skills que llaman conectores MCP (Jira/Slack). En
  // headless no hay prompt para aprobarlos y el conector OAuth puede aparecer con
  // un UUID en vez de su nombre, así que el allowlist por sí solo es frágil: para
  // el rol PR usamos bypassPermissions y el allowlist extendido (PR_TOOLS), y así
  // el flujo completo (push + gh pr create + acli + editJiraIssue) corre igual que
  // en la consola. El resto del squad sigue en acceptEdits con WRITE_TOOLS.
  const isPR = role === 'pr'
  const allowed = !writeMode ? READ_TOOLS : isPR ? PR_TOOLS : WRITE_TOOLS

  const args = buildClaudeArgs({ prompt, allowed, persona, writeMode, isPR, model, effort, sid, idioma: answerLang })

  // Sin API key en el entorno → usa el login de la suscripción ($0 por token).
  const env = sanitizeEnv(process.env, {
    home: app.getPath('home'),
    profileDir: PROFILE_DIRS[profile] ? PROFILE_DIRS[profile]() : null,
    extraPath: await rutasDelProyecto(workdir),
  })

  let child
  try {
    child = spawn(CLAUDE_BIN, args, { cwd: workdir, env })
  } catch (err) {
    return { ok: false, error: `No pude lanzar claude: ${err.message}` }
  }
  children.set(role, child)

  const handleLine = makeLineHandler(role, sesion, displayName)
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

// Los handlers del historial viven en su propio archivo: mismo grupo, misma
// responsabilidad. Se le pasa dónde está y cómo pedir la ventana, en vez de que
// se lo importe él.
require('./ipc/historial.js').registra({ HIST_DIR, ventana: () => win })

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
              resolve(parseUsage(res.statusCode, res.headers, body))
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
      if (d?.rateLimited) {
        // limitado por la API: no insistir hasta que lo permita; conserva el
        // último dato bueno y deja constancia para que el monitor lo explique
        c.limitedUntil = Date.now() + d.retryAfter * 1000
        c.nextAt = c.limitedUntil
      } else if (d) {
        // éxito: guarda el dato y marca fresco por 60s
        c.data = d
        c.fails = 0
        c.limitedUntil = 0
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
    claudeLimitedFor: c.limitedUntil > Date.now() ? Math.round((c.limitedUntil - Date.now()) / 60000) : 0,
  }
})

// Ventana de la guía de uso (ayuda.html / ayuda.en.html, empaquetadas).
let helpWin = null
function openHelp(lang) {
  const en = (lang || (answerLang === 'English' ? 'en' : 'es')) === 'en'
  const file = en ? 'ayuda.en.html' : 'ayuda.html'
  if (helpWin && !helpWin.isDestroyed()) {
    helpWin.focus()
    return { ok: true }
  }
  helpWin = new BrowserWindow({
    width: 860,
    height: 760,
    backgroundColor: '#0e1417',
    title: en ? 'La Oficina · User guide' : 'La Oficina · Guía de uso',
  })
  helpWin.loadURL(isDev ? `http://localhost:5173/${file}` : `app://bundle/${file}`)
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
ipcMain.handle('help:open', (_e, lang) => openHelp(lang))

// ── Artifacts locales ────────────────────────────────────────────────────────
// Carpeta donde el squad guarda los artifacts HTML (configurable desde ⚙️).
// Los documentos se guardan por perfil: los de «work» no tienen por qué
// aparecer en «private». La carpeta elegida a mano también es por perfil; la
// global de antes se conserva como base y cada perfil escribe en su subcarpeta.
const artifactsDirFile = (profile) =>
  path.join(app.getPath('userData'), profile ? `artifacts-dir-${profile}.txt` : 'artifacts-dir.txt')

function baseArtifacts() {
  try {
    const d = fs.readFileSync(artifactsDirFile(), 'utf8').trim()
    if (d) return d
  } catch {}
  return path.join(app.getPath('userData'), 'artifacts')
}

// Una vez: los documentos sueltos en la raíz de la carpeta base son anteriores a
// la separación por perfil y pertenecen a «work». Se mueven ahí en lugar de
// dejarlos invisibles para todos.
let migrado = false
function migraArtifactsAWork() {
  if (migrado) return
  migrado = true
  const base = baseArtifacts()
  const destino = path.join(base, 'work')
  try {
    const sueltos = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isFile() && /\.html?$/i.test(d.name))
    if (!sueltos.length) return
    fs.mkdirSync(destino, { recursive: true })
    for (const f of sueltos) {
      const desde = path.join(base, f.name)
      const hacia = path.join(destino, f.name)
      if (!fs.existsSync(hacia)) fs.renameSync(desde, hacia)
    }
  } catch {}
}

function getArtifactsDir(profile) {
  const prof = profile || 'work'
  try {
    const d = fs.readFileSync(artifactsDirFile(prof), 'utf8').trim()
    if (d) return d
  } catch {}
  migraArtifactsAWork()
  return path.join(baseArtifacts(), prof)
}
// Los handlers de documentos, en su propio archivo. Los ayudantes se le pasan:
// getArtifactsDir lo usa también la persona de los agentes.
require('./ipc/artifacts.js').registra({ getArtifactsDir, artifactsDirFile, ventana: () => win })

// ── Skills de Claude Code por perfil ─────────────────────────────────────────
// Se instalan en CLAUDE_CONFIG_DIR/skills/<id>; los agentes headless las usan
// automáticamente al correr con ese perfil.
const skillsDirFor = (profile) =>
  path.join(PROFILE_DIRS[profile] ? PROFILE_DIRS[profile]() : path.join(app.getPath('home'), '.claude'), 'skills')

const execFileP = (cmd, args, opts) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, opts, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message || '').slice(0, 400))) : resolve(out)))
  )



// ── Plugins de Claude Code por perfil (marketplaces) ─────────────────────────
// Mismo entorno que los agentes headless: el CLI opera sobre el perfil elegido.
// ── El PATH que reciben los agentes ─────────────────────────────────────────
// Una app de GUI en macOS no hereda el PATH del shell de login, así que los
// agentes veían una versión mutilada: sin rbenv (y por tanto sin CocoaPods), sin
// el node de nvm, sin el Java de temurin… y sin Flutter, que en muchas máquinas
// solo existe vía fvm o vía el SDK que fija el proyecto.
let pathShell = null
async function pathDelShell() {
  if (pathShell !== null) return pathShell
  pathShell = []
  try {
    // `shell` a secas pisaría el módulo shell de electron importado arriba
    const elShell = process.env.SHELL || '/bin/zsh'
    const out = await execFileP(elShell, ['-lic', 'printf "%s" "$PATH"'], { timeout: 20000 })
    pathShell = parsePathDeShell(out)
  } catch {}
  return pathShell
}

// Rutas extra para un proyecto: el PATH del usuario más el SDK que fije, si lo
// hay, para que `flutter …` funcione sin que el agente sepa nada de fvm.
async function rutasDelProyecto(cwd) {
  const rutas = [...(await pathDelShell())]
  try {
    if (cwd) {
      const { esFlutter, proyecto } = resuelveProyectoFlutter(cwd)
      if (esFlutter) {
        const bin = await flutterCmd(proyecto)
        // solo si es un SDK real en disco, no `fvm flutter`
        if (bin && !bin.base.length) rutas.unshift(path.dirname(bin.cmd))
      }
    }
  } catch {}
  return rutas
}

function claudeEnvFor(profile) {
  return sanitizeEnv(process.env, {
    home: app.getPath('home'),
    profileDir: PROFILE_DIRS[profile] ? PROFILE_DIRS[profile]() : null,
  })
}
const claudePlugin = (profile, args, timeout = 180000) =>
  execFileP(CLAUDE_BIN, ['plugin', ...args], { env: claudeEnvFor(profile), timeout, maxBuffer: 16 * 1024 * 1024 })

// Skills y plugins del perfil, en su propio archivo. La llamada va AQUÍ y no
// donde estaban los handlers: `claudePlugin` se define más abajo, y registrarlos
// antes le pasaría undefined —los const no se elevan— así que instalar un plugin
// habría fallado sin que nada lo delatara.
require('./ipc/superpoderes.js').registra({ skillsDirFor, execFileP, claudePlugin })

// ── Exportar/importar configuración (squad + personas + proyectos + extras) ──
const CONFIG_PROFILES = ['work', 'private', 'default']
// Arma el objeto de configuración completo (perfiles, personas, proyectos,
// skills y MCP sin credenciales). Lo usan el export manual y el respaldo auto.
function buildConfigSnapshot(extras) {
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
    try {
      const sdir = skillsDirFor(prof)
      entry.skills = fs
        .readdirSync(sdir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(sdir, d.name, 'SKILL.md')))
        .map((d) => d.name)
    } catch {}
    try {
      const cdir = PROFILE_DIRS[prof] ? PROFILE_DIRS[prof]() : path.join(app.getPath('home'), '.claude')
      const cj = JSON.parse(fs.readFileSync(path.join(cdir, '.claude.json'), 'utf8'))
      const { safe, skipped } = pickSafeMcp(cj.mcpServers)
      if (Object.keys(safe).length) entry.mcp = safe
      if (skipped.length) entry.mcpSkipped = skipped
    } catch {}
    if (entry.squad || entry.projects?.length || Object.keys(entry.personas).length || entry.skills?.length || entry.mcp)
      data.profiles[prof] = entry
  }
  return data
}

// Respaldo, export/import y copia entre perfiles, en su propio archivo: ahí
// vive la regla de qué NO sale en un export (los MCP con credenciales).
require('./ipc/config.js').registra({
  buildConfigSnapshot,
  squadFile,
  customProjectsFile,
  getCustomProjects,
  artifactsDirFile,
  personaFile,
  CONFIG_PROFILES,
  PROFILE_DIRS,
  ventana: () => win,
})

// Servidores MCP, en su propio archivo.
require('./ipc/mcp.js').registra({ CLAUDE_BIN, claudeEnvFor, execFileP, PROFILE_DIRS })

// ── Flutter: dónde puede correr el proyecto ──────────────────────────────────
// Electron no hereda el PATH del shell, y en un proyecto con fvm el SDK que vale
// es el que fija el proyecto, no el global. `.fvm/flutter_sdk` es un symlink al
// SDK pinneado: es la vía más directa y no depende de que `fvm` esté en el PATH.
// Último recurso para encontrar un binario: preguntarle al shell de login del
// usuario. Una app de GUI en macOS no hereda su PATH, y ahí es donde se declaran
// las instalaciones que no están en las rutas típicas —asdf, mise, puro, o una
// carpeta propia—. Es lento (arranca un shell), así que se cachea.
const cacheShell = new Map()
async function buscaEnShell(bin) {
  if (cacheShell.has(bin)) return cacheShell.get(bin)
  let ruta = null
  try {
    // ojo: `shell` a secas pisaría el módulo shell de electron importado arriba
    const elShell = process.env.SHELL || '/bin/zsh'
    const out = await execFileP(elShell, ['-lic', `command -v ${bin}`], { timeout: 20000 })
    // puede venir con ruido del propio shell: vale la última línea que sea ruta
    const cand = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('/'))
      .pop()
    if (cand && fs.existsSync(cand)) ruta = cand
  } catch {}
  cacheShell.set(bin, ruta)
  return ruta
}

const FVM_CANDIDATES = ['/opt/homebrew/bin/fvm', '/usr/local/bin/fvm']
const FLUTTER_CANDIDATES = () => [
  '/opt/homebrew/bin/flutter',
  '/usr/local/bin/flutter',
  path.join(app.getPath('home'), 'development', 'flutter', 'bin', 'flutter'),
  path.join(app.getPath('home'), 'flutter', 'bin', 'flutter'),
  path.join(app.getPath('home'), 'fvm', 'default', 'bin', 'flutter'),
]

async function flutterCmd(cwd) {
  const conFvm = fs.existsSync(path.join(cwd, '.fvmrc')) || fs.existsSync(path.join(cwd, '.fvm'))
  // 1) el SDK que fija el proyecto, invocado directo
  const link = path.join(cwd, '.fvm', 'flutter_sdk', 'bin', 'flutter')
  if (fs.existsSync(link)) return { cmd: link, base: [], via: 'SDK del proyecto (fvm)' }
  // 2) la versión de .fvmrc, si el symlink no está materializado
  try {
    const v = JSON.parse(fs.readFileSync(path.join(cwd, '.fvmrc'), 'utf8'))?.flutter
    const p = v && path.join(app.getPath('home'), 'fvm', 'versions', v, 'bin', 'flutter')
    if (p && fs.existsSync(p)) return { cmd: p, base: [], via: `fvm ${v}` }
  } catch {}
  // 3) que lo resuelva fvm
  if (conFvm) {
    const fvm = FVM_CANDIDATES.find((p) => fs.existsSync(p)) || (await buscaEnShell('fvm'))
    if (fvm) return { cmd: fvm, base: ['flutter'], via: 'fvm' }
  }
  // 4) el flutter del sistema, y si no está donde se espera, se le pregunta al shell
  const delSistema = FLUTTER_CANDIDATES().find((p) => fs.existsSync(p)) || (await buscaEnShell('flutter'))
  if (delSistema) return { cmd: delSistema, base: [], via: 'flutter del sistema' }
  return null
}

// `flutter devices --machine` puede escupir avisos antes del JSON.
function jsonDeLaSalida(out) {
  const i = String(out || '').indexOf('[')
  if (i < 0) return []
  try {
    return JSON.parse(String(out).slice(i))
  } catch {
    return []
  }
}

// Qué proyecto Flutter hay a la vista: la raíz elegida, o uno de sus hijos
// directos cuando el proyecto apunta a una carpeta padre. Solo toca disco, así
// que sirve para decidir al instante si la app muestra el control de ejecución.
function resuelveProyectoFlutter(cwd) {
  const leePubspec = (dir) => {
    try {
      return fs.readFileSync(path.join(dir, 'pubspec.yaml'), 'utf8')
    } catch {
      return null
    }
  }
  const candidatos = [{ dir: cwd, pubspec: leePubspec(cwd) }]
  if (!esProyectoFlutter(candidatos[0].pubspec)) {
    let hijos = []
    try {
      hijos = fs
        .readdirSync(cwd, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => path.join(cwd, d.name))
        .slice(0, 40)
    } catch {}
    for (const h of hijos) candidatos.push({ dir: h, pubspec: leePubspec(h) })
  }
  const proyectos = buscaProyectosFlutter(candidatos)
  // si hay varios, manda el primero y la UI ofrece cambiar
  return { esFlutter: proyectos.length > 0, proyecto: proyectos[0] || null, proyectos }
}

// Dispositivos y emuladores son de la MÁQUINA: se cachean aquí para poder
// re-filtrarlos al instante cuando cambia el proyecto, sin volver a arrancar el
// toolchain solo para descubrir lo mismo.
let cacheMaquina = null // { devices, emulators }

// Carpetas de plataforma que tiene el proyecto: sin `web/` no hay Chrome, sin
// `macos/` no hay escritorio. Solo disco, así que es instantáneo.
const DIRS_PLATAFORMA = ['ios', 'android', 'web', 'macos', 'windows', 'linux']
const plataformasDe = (proyecto) =>
  plataformasDelProyecto(DIRS_PLATAFORMA.filter((d) => fs.existsSync(path.join(proyecto, d))))

// Chequeo instantáneo (solo disco) de lo que SÍ depende del proyecto: cuál es y
// qué configuraciones ofrece. Los dispositivos y emuladores no dependen del
// proyecto —son de la máquina— así que no hace falta volver a descubrirlos al
// cambiar de carpeta.
ipcMain.handle('flutter:project', (_e, cwd) => {
  if (!cwd) return { esFlutter: false, proyectos: [], configs: [] }
  const r = resuelveProyectoFlutter(cwd)
  let configs = []
  if (r.proyecto) {
    try {
      configs = parseLaunchConfigs(fs.readFileSync(path.join(r.proyecto, '.vscode', 'launch.json'), 'utf8'))
    } catch {}
  }
  const plataformas = r.proyecto ? plataformasDe(r.proyecto) : []
  // Con el listado de la máquina ya en memoria, el cambio de proyecto solo
  // re-filtra: no hace falta volver a preguntarle a flutter.
  //
  // Sin proyecto Flutter no se ofrece NADA. Esto es distinto de un proyecto
  // Flutter con una estructura que no reconocemos, donde sí se muestra todo:
  // ahí filtrar dejaría la lista vacía por un falso negativo, pero aquí la lista
  // vacía es la respuesta correcta —no hay dónde correr—. Confundir los dos
  // casos hacía que al pasar a un repo que no es Flutter siguieran saliendo
  // todos los dispositivos.
  const listas = r.esFlutter
    ? {
        devices: filtraPorPlataforma(cacheMaquina?.devices || [], plataformas),
        emulators: filtraPorPlataforma(cacheMaquina?.emulators || [], plataformas),
      }
    : { devices: [], emulators: [] }
  return { ...r, configs, plataformas, ...listas }
})

// Dónde puede correr el proyecto: móviles enchufados, emuladores ya arrancados,
// escritorio y web, más los emuladores que se pueden lanzar.
ipcMain.handle('flutter:targets', async (_e, cwd) => {
  if (!cwd) return { ok: false, error: 'Sin proyecto seleccionado' }
  const { esFlutter, proyecto, proyectos } = resuelveProyectoFlutter(cwd)
  if (!esFlutter) return { ok: true, esFlutter: false, devices: [], emulators: [] }

  const bin = await flutterCmd(proyecto)
  if (!bin) {
    return {
      ok: false,
      esFlutter: true,
      error:
        'No se encontró Flutter. Se buscó el SDK del proyecto (.fvm/flutter_sdk), la versión de .fvmrc, ' +
        'fvm y flutter en las rutas típicas, y en el PATH de tu shell de login. Si el proyecto usa fvm, ' +
        'corre `fvm install` una vez en su carpeta.',
    }
  }
  const correr = (args) =>
    execFileP(bin.cmd, [...bin.base, ...args], { cwd: proyecto, timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
  // los dos tardan lo suyo (el primero arranca el toolchain): van en paralelo, y
  // que falle uno no tumba al otro — con el móvil enchufado y el SDK de Android
  // a medio instalar, `emulators` puede reventar mientras `devices` responde bien
  const [devs, emus] = await Promise.allSettled([correr(['devices', '--machine']), correr(['emulators'])])
  if (devs.status === 'rejected' && emus.status === 'rejected') {
    return { ok: false, esFlutter: true, via: bin.via, proyecto, error: String(devs.reason?.message || '').slice(0, 300) }
  }
  const lista = emus.status === 'fulfilled' ? parseEmuladores(emus.value) : []
  // solo lo que el proyecto puede compilar: ofrecer Chrome a una app solo
  // android+ios es regalar una compilación fallida
  const plataformas = plataformasDe(proyecto)
  const todosDevices = ordenaDispositivos(devs.status === 'fulfilled' ? jsonDeLaSalida(devs.value) : [])
  const todosEmus = marcaEmuladoresCorriendo(lista, await emuladoresArriba())
  cacheMaquina = { devices: todosDevices, emulators: todosEmus }
  // las mismas configuraciones que ofrece el editor: flavor, dart-defines, entry
  let configs = []
  try {
    configs = parseLaunchConfigs(fs.readFileSync(path.join(proyecto, '.vscode', 'launch.json'), 'utf8'))
  } catch {}
  return {
    ok: true,
    esFlutter: true,
    via: bin.via,
    proyecto,
    proyectos,
    plataformas,
    devices: filtraPorPlataforma(todosDevices, plataformas),
    // cuáles ya están arriba: ahí el botón no es «lanzar» sino «cerrar»
    emulators: filtraPorPlataforma(todosEmus, plataformas),
    configs,
  }
})

// Lanza un emulador. El comando vuelve enseguida —solo dispara el arranque, no
// lo espera— y encima sale con 0 aunque no encuentre el emulador, así que el
// veredicto se saca de la salida (ver resultadoLanzarEmulador).
ipcMain.handle('flutter:launchEmulator', async (_e, { cwd, id, cold } = {}) => {
  if (!cwd || !id) return { ok: false, error: 'Falta el proyecto o el emulador' }
  const { esFlutter, proyecto } = resuelveProyectoFlutter(cwd)
  if (!esFlutter) return { ok: false, error: 'No hay un proyecto Flutter en esta carpeta' }
  const bin = await flutterCmd(proyecto)
  if (!bin) return { ok: false, error: 'No se encontró Flutter' }
  const args = [...bin.base, 'emulators', '--launch', id]
  if (cold) args.push('--cold') // arranque en frío, solo Android
  try {
    const out = await execFileP(bin.cmd, args, { cwd: proyecto, timeout: 180000, maxBuffer: 4 * 1024 * 1024 })
    return resultadoLanzarEmulador(out)
  } catch (err) {
    // aquí solo caen los fallos de verdad del proceso (no encontrado, timeout…)
    return { ok: false, error: String(err.message || 'No se pudo lanzar el emulador').slice(0, 250) }
  }
})

// Qué emuladores están arriba. No hay id común con el dispositivo resultante, así
// que se pregunta a las herramientas de cada plataforma (ver core.js).
const ADB_CANDIDATES = () => [
  path.join(app.getPath('home'), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
  path.join(app.getPath('home'), 'Android', 'Sdk', 'platform-tools', 'adb'),
  '/opt/homebrew/bin/adb',
  '/usr/local/bin/adb',
]
const adbBin = async () => ADB_CANDIDATES().find((p) => fs.existsSync(p)) || (await buscaEnShell('adb'))

async function emuladoresArriba() {
  const estado = { ios: false, android: {} }
  try {
    const out = await execFileP('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], { timeout: 20000 })
    const devs = JSON.parse(out).devices || {}
    estado.ios = Object.values(devs).some((lista) => (lista || []).some((d) => d.state === 'Booted'))
  } catch {}
  const adb = await adbBin()
  if (adb) {
    try {
      for (const id of idsEmuladorAdb(await execFileP(adb, ['devices'], { timeout: 15000 }))) {
        try {
          const nombre = (await execFileP(adb, ['-s', id, 'emu', 'avd', 'name'], { timeout: 10000 }))
            .split('\n')[0]
            .trim()
          if (nombre) estado.android[nombre] = id
        } catch {}
      }
    } catch {}
  }
  return estado
}

// Cierra un emulador que está arriba. Android se mata por adb; en iOS se apaga el
// simulador y además se cierra la app, que si no queda la ventana abierta en negro.
ipcMain.handle('flutter:stopEmulator', async (_e, { platform, deviceId } = {}) => {
  try {
    if (platform === 'ios') {
      await execFileP('/usr/bin/xcrun', ['simctl', 'shutdown', 'all'], { timeout: 30000 })
      try {
        await execFileP('/usr/bin/osascript', ['-e', 'quit app "Simulator"'], { timeout: 15000 })
      } catch {}
      return { ok: true }
    }
    const adb = await adbBin()
    if (!adb) return { ok: false, error: 'No se encontró adb para cerrar el emulador' }
    if (!deviceId) return { ok: false, error: 'No se supo qué emulador cerrar' }
    await execFileP(adb, ['-s', deviceId, 'emu', 'kill'], { timeout: 20000 })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err.message || 'No se pudo cerrar el emulador').slice(0, 250) }
  }
})

// ── Targets de Makefile ─────────────────────────────────────────────────────
// Se leen del archivo, no de `make help`: preguntarle a make obligaría a evaluar
// el Makefile entero, y eso puede tener side effects.
function resuelveProyectoMake(cwd) {
  const tiene = (dir) => ['Makefile', 'makefile', 'GNUmakefile'].some((f) => fs.existsSync(path.join(dir, f)))
  if (tiene(cwd)) return cwd
  try {
    return (
      fs
        .readdirSync(cwd, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
        .map((d) => path.join(cwd, d.name))
        .slice(0, 40)
        .find(tiene) || null
    )
  } catch {
    return null
  }
}

ipcMain.handle('make:project', (_e, cwd) => {
  if (!cwd) return { esMake: false, grupos: [] }
  const proyecto = resuelveProyectoMake(cwd)
  if (!proyecto) return { esMake: false, grupos: [] }
  const archivos = []
  for (const f of ['Makefile', 'makefile', 'GNUmakefile']) {
    try {
      archivos.push({ nombre: f, texto: fs.readFileSync(path.join(proyecto, f), 'utf8') })
      break // los tres son el mismo archivo en macOS (case-insensitive)
    } catch {}
  }
  // los módulos incluidos, que es donde vive la mayoría
  for (const dir of ['make', 'makefiles', 'scripts/make']) {
    try {
      for (const f of fs.readdirSync(path.join(proyecto, dir)).filter((x) => x.endsWith('.mk')).sort()) {
        archivos.push({ nombre: f, texto: fs.readFileSync(path.join(proyecto, dir, f), 'utf8') })
      }
    } catch {}
  }
  const targets = parseMakefile(archivos)
  return { esMake: targets.length > 0, proyecto, grupos: agrupaTargets(targets), total: targets.length }
})

ipcMain.handle('make:run', async (_e, { cwd, target, vars } = {}) => {
  if (!cwd || !target) return { ok: false, error: 'Falta el proyecto o el target' }
  const clave = `make:${target}`
  if (corriendo.has(clave)) return { ok: false, error: 'Ese target ya está corriendo' }
  const proyecto = resuelveProyectoMake(cwd)
  if (!proyecto) return { ok: false, error: 'No hay Makefile en esta carpeta' }
  const args = [target]
  for (const [k, v] of Object.entries(vars || {})) {
    if (/^[A-Z][A-Z0-9_]*$/.test(k) && v) args.push(`${k}=${v}`)
  }
  // make vive en /usr/bin, pero los targets llaman a flutter, pod o fastlane:
  // sin el PATH del usuario fallarían igual que le fallaban a los agentes
  const child = spawn('/usr/bin/make', args, {
    cwd: proyecto,
    env: sanitizeEnv(process.env, { home: app.getPath('home'), extraPath: await rutasDelProyecto(proyecto) }),
  })
  const c = {
    child,
    tipo: 'make',
    deviceId: clave,
    device: target,
    platform: null,
    appId: null,
    proyecto,
    pendientes: new Map(),
    seq: 0,
    progreso: {},
    parando: false,
  }
  corriendo.set(clave, c)
  avisaFlutter({ kind: 'run-start', deviceId: clave, appId: null, tipo: 'make' })
  avisaFlutter({ kind: 'run-started', deviceId: clave })
  const alSalir = (buf) => {
    for (const linea of buf.toString().split('\n')) {
      if (linea.trim()) avisaFlutter({ kind: 'run-log', deviceId: clave, texto: linea.trimEnd() })
    }
  }
  child.stdout.on('data', alSalir)
  child.stderr.on('data', alSalir)
  child.on('error', (err) => {
    avisaFlutter({ kind: 'run-error', deviceId: clave, error: String(err.message || err).slice(0, 300) })
    cierraCorrida(clave, 'error')
  })
  child.on('close', (code) => {
    const cc = corriendo.get(clave)
    if (cc && !cc.parando && code) {
      avisaFlutter({ kind: 'run-error', deviceId: clave, error: `make ${target} terminó con código ${code}` })
    }
    cierraCorrida(clave, 'cerrado')
  })
  return { ok: true, proyecto, target }
})

// ── Correr el proyecto: `flutter run --machine` ───────────────────────────────
// Un solo proceso a la vez: dos `flutter run` sobre el mismo dispositivo se
// pelean. Habla el dominio `app` del daemon por stdout/stdin, así que de aquí
// salen el progreso de compilación, los logs de la app y las respuestas a los
// hot reload; y hacia allá van las peticiones.
const corriendo = new Map() // deviceId → { child, appId, deviceId, proyecto, pendientes, seq, progreso, parando }

const avisaFlutter = (payload) => {
  if (win && !win.isDestroyed()) win.webContents.send('flutter:event', payload)
}

function cierraCorrida(deviceId, motivo) {
  const c = corriendo.get(deviceId)
  if (!c) return
  for (const [, pend] of c.pendientes) pend({ ok: false, error: 'La app se detuvo' })
  corriendo.delete(deviceId)
  avisaFlutter({ kind: 'run-stop', deviceId, motivo: motivo || null })
}

// Una corrida por dispositivo. `flutter run --machine` NO admite `-d all`
// —run.dart lo rechaza a propósito— así que correr en varios es un proceso por
// dispositivo, cada uno con su appId, igual que hacen los editores.
ipcMain.handle('flutter:run', async (_e, { cwd, deviceId, config, platform, deviceName } = {}) => {
  if (!cwd || !deviceId) return { ok: false, error: 'Falta el proyecto o el dispositivo' }
  if (corriendo.has(deviceId)) return { ok: false, error: 'Ya está corriendo en ese dispositivo' }
  // Dos corridas de la misma plataforma comparten el directorio de build del
  // proyecto y se pisan. Cruzadas (iOS + Android) conviven. Se corta aquí para
  // no gastar minutos de compilación descubriéndolo.
  const ocupa = plataformaOcupada(Object.fromEntries(corriendo), platform)
  if (ocupa) return { ok: false, mismaPlataforma: true, device: ocupa.device }
  const { esFlutter, proyecto } = resuelveProyectoFlutter(cwd)
  if (!esFlutter) return { ok: false, error: 'No hay un proyecto Flutter en esta carpeta' }
  const bin = await flutterCmd(proyecto)
  if (!bin) return { ok: false, error: 'No se encontró Flutter' }

  // la configuración elegida aporta flavor, dart-defines y entry point
  let extra = []
  if (config) {
    let cfgs = []
    try {
      cfgs = parseLaunchConfigs(fs.readFileSync(path.join(proyecto, '.vscode', 'launch.json'), 'utf8'))
    } catch {}
    const elegida = cfgs.find((c) => c.name === config)
    if (!elegida) return { ok: false, error: `No existe la configuración «${config}»` }
    extra = argsDeLaunchConfig(elegida, { workspaceFolder: proyecto })
  }

  const child = spawn(bin.cmd, [...bin.base, 'run', '--machine', '-d', deviceId, ...extra], {
    cwd: proyecto,
    env: sanitizeEnv(process.env, { home: app.getPath('home') }),
  })
  const c = { child, appId: null, deviceId, device: deviceName || deviceId, platform: platform || null, proyecto, pendientes: new Map(), seq: 0, progreso: {}, parando: false }
  corriendo.set(deviceId, c)

  let resto = ''
  const alLeer = (buf) => {
    resto += buf.toString()
    const lineas = resto.split('\n')
    resto = lineas.pop() // la última puede venir cortada
    for (const linea of lineas) {
      const msg = parseLineaDaemon(linea)
      if (!msg || !corriendo.has(deviceId)) continue
      if (msg.tipo === 'log') {
        avisaFlutter({ kind: 'run-log', deviceId, texto: msg.texto })
      } else if (msg.tipo === 'respuesta') {
        const pend = c.pendientes.get(msg.id)
        if (pend) {
          c.pendientes.delete(msg.id)
          pend(resultadoRecarga(msg.result, msg.error))
        }
      } else if (msg.evento === 'app.start') {
        c.appId = msg.params.appId || null
        avisaFlutter({ kind: 'run-start', deviceId, appId: c.appId })
      } else if (msg.evento === 'app.started') {
        avisaFlutter({ kind: 'run-started', deviceId })
      } else if (msg.evento === 'app.progress') {
        c.progreso = aplicaProgreso(c.progreso, msg.params)
        avisaFlutter({ kind: 'run-progress', deviceId, progreso: progresoVisible(c.progreso) })
      } else if (msg.evento === 'app.webLaunchUrl' || msg.evento === 'app.debugPort') {
        avisaFlutter({ kind: 'run-url', deviceId, url: msg.params.url || msg.params.wsUri || null })
      } else if (msg.evento === 'app.stop') {
        cierraCorrida(deviceId, 'app.stop')
      }
    }
  }
  child.stdout.on('data', alLeer)
  child.stderr.on('data', (b) => avisaFlutter({ kind: 'run-log', deviceId, texto: b.toString().trimEnd() }))
  child.on('error', (err) => {
    avisaFlutter({ kind: 'run-error', deviceId, error: String(err.message || err).slice(0, 300) })
    cierraCorrida(deviceId, 'error')
  })
  child.on('close', (code) => {
    const cc = corriendo.get(deviceId)
    if (cc && !cc.parando && code) {
      avisaFlutter({ kind: 'run-error', deviceId, error: `flutter run terminó con código ${code}` })
    }
    cierraCorrida(deviceId, 'cerrado')
  })
  return { ok: true, proyecto, deviceId, config: config || null }
})

// Hot reload (completa=false) y hot restart (completa=true): el mismo método del
// daemon con un flag distinto. Sin deviceId va a TODAS las corridas, que es el
// sentido de tener la app en dos sitios: ver el mismo cambio en los dos.
// El resultado es por dispositivo: un reload puede fallar en uno y no en otro.
function pideRecarga(c, completa) {
  if (!c.appId) return Promise.resolve({ deviceId: c.deviceId, ok: false, error: 'Todavía está compilando' })
  const id = ++c.seq
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      c.pendientes.delete(id)
      resolve({ deviceId: c.deviceId, ok: false, error: 'El hot reload no respondió' })
    }, 120000)
    c.pendientes.set(id, (r) => {
      clearTimeout(timer)
      resolve({ deviceId: c.deviceId, ...r })
    })
    try {
      c.child.stdin.write(peticionRecarga(id, c.appId, completa))
    } catch (err) {
      clearTimeout(timer)
      c.pendientes.delete(id)
      resolve({ deviceId: c.deviceId, ok: false, error: String(err.message || 'No se pudo escribirle al proceso') })
    }
  })
}

ipcMain.handle('flutter:reload', async (_e, { completa, deviceId } = {}) => {
  const objetivos = deviceId ? [corriendo.get(deviceId)].filter(Boolean) : [...corriendo.values()]
  if (!objetivos.length) return { ok: false, error: 'No hay ninguna app corriendo' }
  const rs = await Promise.all(objetivos.map((c) => pideRecarga(c, completa)))
  return { ok: rs.every((r) => r.ok), resultados: rs }
})

const mensajeDaemonStop = (id, appId) => `${JSON.stringify([{ id, method: 'app.stop', params: { appId } }])}\n`

// Detener. Dos rutas: con appId se pide app.stop y la app cierra ordenada; si
// todavía compila no hay appId —y es cuando más se quiere cancelar, un build de
// iOS son minutos— así que se mata el proceso. Sin deviceId, para todas.
function paraUna(c) {
  c.parando = true
  const ruta = comoCancelar(c.appId)
  if (ruta === 'app.stop') {
    try {
      c.child.stdin.write(mensajeDaemonStop(++c.seq, c.appId))
    } catch {}
    const child = c.child
    setTimeout(() => {
      try {
        if (child && !child.killed) child.kill('SIGTERM')
      } catch {}
    }, 6000)
  } else {
    try {
      c.child.kill('SIGTERM')
    } catch {}
  }
  return ruta
}

ipcMain.handle('flutter:stop', async (_e, { deviceId } = {}) => {
  const objetivos = deviceId ? [corriendo.get(deviceId)].filter(Boolean) : [...corriendo.values()]
  if (!objetivos.length) return { ok: true }
  return { ok: true, rutas: objetivos.map(paraUna) }
})

// Recarga automática tras un turno del agente. Recibe las rutas que tocó y
// decide qué hace falta: recompilar (nativo/pubspec), hot restart (estado global,
// jerarquías, main, initState) o hot reload. La decisión sale de las líneas
// cambiadas —se saca el diff de esos archivos— y no del archivo entero.
ipcMain.handle('flutter:autoReload', async (_e, { paths } = {}) => {
  if (!corriendo.size) return { ok: false, sinCorridas: true }
  const rutas = (Array.isArray(paths) ? paths : []).filter(Boolean)
  if (!rutas.length) return { ok: false, error: 'Sin archivos que mirar' }

  // el diff de los repos tocados, para ver QUÉ cambió y no solo dónde
  let diff = ''
  const roots = []
  for (const ruta of rutas) {
    let dir = ruta
    try {
      if (!fs.statSync(ruta).isDirectory()) dir = path.dirname(ruta)
    } catch {
      dir = path.dirname(ruta)
    }
    const r = await repoRoot(dir)
    if (r && !roots.includes(r)) roots.push(r)
  }
  for (const r of roots) {
    try {
      diff += (await diffDeRepo(r)).diff
    } catch {}
  }

  // las rutas se comparan relativas al repo: así «ios/Runner/Info.plist» pega
  const relativas = rutas.map((ruta) => {
    const root = roots.find((r) => ruta.startsWith(`${r}/`))
    return root ? ruta.slice(root.length + 1) : ruta
  })
  const decision = decideRecarga(relativas, diff)
  if (decision.accion === 'recompilar') return { ok: false, ...decision }
  const rs = await Promise.all([...corriendo.values()].map((c) => pideRecarga(c, decision.accion === 'restart')))
  return { ok: rs.every((r) => r.ok), ...decision, resultados: rs }
})

// «/correr …» desde el composer: interpreta la frase contra lo que hay conectado
// y devuelve qué haría, sin ejecutarlo. Decidir aquí evita duplicar en el
// renderer la lectura del launch.json y del listado.
ipcMain.handle('flutter:interpretaCorrer', async (_e, { cwd, texto } = {}) => {
  if (!cwd) return { ok: false, error: 'Sin proyecto seleccionado' }
  const { esFlutter, proyecto } = resuelveProyectoFlutter(cwd)
  if (!esFlutter) return { ok: false, error: 'No hay un proyecto Flutter en esta carpeta' }
  const bin = await flutterCmd(proyecto)
  if (!bin) return { ok: false, error: 'No se encontró Flutter' }
  let configs = []
  try {
    configs = parseLaunchConfigs(fs.readFileSync(path.join(proyecto, '.vscode', 'launch.json'), 'utf8'))
  } catch {}
  const correr = (args) =>
    execFileP(bin.cmd, [...bin.base, ...args], { cwd: proyecto, timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
  const [devs, emus] = await Promise.allSettled([correr(['devices', '--machine']), correr(['emulators'])])
  const devices = ordenaDispositivos(devs.status === 'fulfilled' ? jsonDeLaSalida(devs.value) : [])
  const emulators = marcaEmuladoresCorriendo(
    emus.status === 'fulfilled' ? parseEmuladores(emus.value) : [],
    await emuladoresArriba()
  )
  const { objetivo, config } = interpretaCorrer(texto, { devices, emulators, configs })
  return { ok: true, objetivo, config, devices, emulators, configs }
})

// ── Dispositivos en vivo ─────────────────────────────────────────────────────
// `flutter daemon` + device.enable avisa al enchufar y al desenchufar
// (device.added / device.removed), así que la lista se mantiene sola en vez de
// esperar un refresco a mano.
//
// Vive solo mientras el panel está abierto: es un proceso Dart, y tenerlo
// siempre arriba costaría memoria para nada — con el panel cerrado, al abrirlo ya
// se revalida el listado.
let vigia = null // { child, cwd }

async function paraVigia() {
  if (!vigia) return
  const child = vigia.child
  vigia = null
  try {
    child.kill('SIGTERM')
  } catch {}
}

// Reemite el listado completo, ya filtrado para el proyecto que se está viendo.
async function avisaListado(cwd) {
  if (!cacheMaquina) return
  const { proyecto } = resuelveProyectoFlutter(cwd)
  const plataformas = proyecto ? plataformasDe(proyecto) : []
  // un emulador que arranca aparece como dispositivo: hay que rehacer la marca
  cacheMaquina.emulators = marcaEmuladoresCorriendo(cacheMaquina.emulators, await emuladoresArriba())
  avisaFlutter({
    kind: 'devices',
    devices: filtraPorPlataforma(cacheMaquina.devices, plataformas),
    emulators: filtraPorPlataforma(cacheMaquina.emulators, plataformas),
  })
}

ipcMain.handle('flutter:watch', async (_e, { cwd, on } = {}) => {
  if (!on) {
    await paraVigia()
    return { ok: true, vigilando: false }
  }
  if (vigia) return { ok: true, vigilando: true }
  if (!cwd) return { ok: false, error: 'Sin proyecto seleccionado' }
  const { esFlutter, proyecto } = resuelveProyectoFlutter(cwd)
  if (!esFlutter) return { ok: false, error: 'No hay un proyecto Flutter en esta carpeta' }
  const bin = await flutterCmd(proyecto)
  if (!bin) return { ok: false, error: 'No se encontró Flutter' }

  const child = spawn(bin.cmd, [...bin.base, 'daemon'], {
    cwd: proyecto,
    env: sanitizeEnv(process.env, { home: app.getPath('home') }),
  })
  vigia = { child, cwd }
  let resto = ''
  child.stdout.on('data', (buf) => {
    resto += buf.toString()
    const lineas = resto.split('\n')
    resto = lineas.pop()
    for (const linea of lineas) {
      const msg = parseLineaDaemon(linea)
      if (!msg || msg.tipo !== 'evento' || !vigia) continue
      if (msg.evento === 'device.added') {
        const d = dispositivoDeDaemon(msg.params)
        if (!d || !cacheMaquina) continue
        if (!cacheMaquina.devices.some((x) => x.id === d.id)) cacheMaquina.devices = [...cacheMaquina.devices, d]
        avisaListado(vigia.cwd)
      } else if (msg.evento === 'device.removed') {
        const id = msg.params?.id
        if (!id || !cacheMaquina) continue
        cacheMaquina.devices = cacheMaquina.devices.filter((x) => x.id !== id)
        avisaListado(vigia.cwd)
      }
    }
  })
  child.on('error', () => paraVigia())
  child.on('close', () => {
    vigia = null
  })
  try {
    child.stdin.write(`${JSON.stringify([{ id: 1, method: 'device.enable' }])}\n`)
  } catch {}
  return { ok: true, vigilando: true }
})

// el proyecto que se está viendo cambia sin reiniciar el vigía: solo el filtro
ipcMain.handle('flutter:watchCwd', (_e, cwd) => {
  if (vigia && cwd) vigia.cwd = cwd
  return { ok: true }
})

// ── Proyectos npm: web y escritorio ─────────────────────────────────────────
// Sin dispositivos que elegir: el objetivo es un script del package.json. Y sin
// hot reload que pedir, porque Vite recarga solo al guardar; lo que queda útil es
// arrancar, reiniciar el servidor, detener, ver la salida y abrir la URL.
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock']

// El package.json puede estar en la raíz o un nivel abajo, igual que el pubspec.
function resuelveProyectoNpm(cwd) {
  const lee = (dir) => {
    try {
      return fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    } catch {
      return null
    }
  }
  const conScripts = (dir) => scriptsDelProyecto(lee(dir)).length > 0
  if (conScripts(cwd)) return cwd
  let hijos = []
  try {
    hijos = fs
      .readdirSync(cwd, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => path.join(cwd, d.name))
      .slice(0, 40)
  } catch {}
  return hijos.find(conScripts) || null
}

ipcMain.handle('npm:project', (_e, cwd) => {
  if (!cwd) return { esNpm: false, scripts: [] }
  const proyecto = resuelveProyectoNpm(cwd)
  if (!proyecto) return { esNpm: false, scripts: [] }
  let scripts = []
  try {
    scripts = scriptsDelProyecto(fs.readFileSync(path.join(proyecto, 'package.json'), 'utf8'))
  } catch {}
  const gestor = gestorDePaquetes(LOCKFILES.filter((f) => fs.existsSync(path.join(proyecto, f))))
  return { esNpm: true, proyecto, scripts, gestor }
})

const GESTOR_CANDIDATOS = {
  npm: ['/opt/homebrew/bin/npm', '/usr/local/bin/npm'],
  pnpm: ['/opt/homebrew/bin/pnpm', '/usr/local/bin/pnpm'],
  yarn: ['/opt/homebrew/bin/yarn', '/usr/local/bin/yarn'],
  bun: ['/opt/homebrew/bin/bun', '/usr/local/bin/bun'],
}

// «/correr dev» en un proyecto npm: empareja la frase contra los scripts.
ipcMain.handle('npm:interpreta', (_e, { cwd, texto } = {}) => {
  if (!cwd) return { ok: false, error: 'Sin proyecto seleccionado' }
  const proyecto = resuelveProyectoNpm(cwd)
  if (!proyecto) return { ok: false, error: 'No hay un package.json con scripts en esta carpeta' }
  let scripts = []
  try {
    scripts = scriptsDelProyecto(fs.readFileSync(path.join(proyecto, 'package.json'), 'utf8'))
  } catch {}
  return { ok: true, proyecto, scripts, ...interpretaScript(texto, scripts) }
})

ipcMain.handle('npm:run', async (_e, { cwd, script } = {}) => {
  if (!cwd || !script) return { ok: false, error: 'Falta el proyecto o el script' }
  const clave = `npm:${script}`
  if (corriendo.has(clave)) return { ok: false, error: 'Ese script ya está corriendo' }
  const proyecto = resuelveProyectoNpm(cwd)
  if (!proyecto) return { ok: false, error: 'No hay un package.json con scripts en esta carpeta' }
  const gestor = gestorDePaquetes(LOCKFILES.filter((f) => fs.existsSync(path.join(proyecto, f))))
  const bin =
    (GESTOR_CANDIDATOS[gestor] || []).find((p) => fs.existsSync(p)) || (await buscaEnShell(gestor)) || gestor

  const child = spawn(bin, argsDeScript(gestor, script), {
    cwd: proyecto,
    env: sanitizeEnv(process.env, { home: app.getPath('home') }),
  })
  const c = {
    child,
    tipo: 'npm',
    deviceId: clave,
    device: script,
    platform: null,
    appId: null,
    proyecto,
    pendientes: new Map(),
    seq: 0,
    progreso: {},
    parando: false,
  }
  corriendo.set(clave, c)
  avisaFlutter({ kind: 'run-start', deviceId: clave, appId: null, tipo: 'npm' })

  const alSalir = (buf) => {
    const texto = buf.toString()
    for (const linea of texto.split('\n')) {
      if (!linea.trim()) continue
      avisaFlutter({ kind: 'run-log', deviceId: clave, texto: linea.trimEnd() })
      // el servidor ya está sirviendo: se puede abrir
      const url = urlDeSalida(linea)
      if (url && !c.url) {
        c.url = url
        avisaFlutter({ kind: 'run-url', deviceId: clave, url })
        avisaFlutter({ kind: 'run-started', deviceId: clave })
      }
    }
  }
  child.stdout.on('data', alSalir)
  child.stderr.on('data', alSalir)
  child.on('error', (err) => {
    avisaFlutter({ kind: 'run-error', deviceId: clave, error: String(err.message || err).slice(0, 300) })
    cierraCorrida(clave, 'error')
  })
  child.on('close', (code) => {
    const cc = corriendo.get(clave)
    if (cc && !cc.parando && code) {
      avisaFlutter({ kind: 'run-error', deviceId: clave, error: `${gestor} run ${script} terminó con código ${code}` })
    }
    cierraCorrida(clave, 'cerrado')
  })
  // sin URL que detectar (Electron puro) se da por arrancado a los 3s
  setTimeout(() => {
    if (corriendo.has(clave) && !c.url) avisaFlutter({ kind: 'run-started', deviceId: clave })
  }, 3000)
  return { ok: true, proyecto, script, gestor }
})

// Al cerrar la app no se dejan `flutter run` huérfanos ocupando los dispositivos.
app.on('before-quit', () => {
  paraVigia()
  for (const c of corriendo.values()) {
    try {
      c.child.kill('SIGTERM')
    } catch {}
  }
})
// Raíz del repo que contiene una ruta (null si no hay repo).
async function repoRoot(dir) {
  try {
    const out = await execFileP('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 5000 })
    return out.trim() || null
  } catch {
    return null
  }
}

// Diff de un repo: cambios contra HEAD + los archivos nuevos sin trackear.
async function diffDeRepo(root) {
  let diff = ''
  try {
    diff = await execFileP('git', ['diff', 'HEAD'], { cwd: root, maxBuffer: 4 * 1024 * 1024 })
  } catch (err) {
    // un repo sin commits todavía no tiene HEAD: se queda sin diff y ya, pero
    // cualquier otro fallo de git sí importa y se propaga
    if (!/unknown revision|bad revision|ambiguous argument/i.test(String(err.message || ''))) throw err
  }
  let untracked = []
  try {
    const out = await execFileP('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root })
    untracked = out.split('\n').filter(Boolean)
  } catch {}
  return { root, diff, untracked }
}

// Diff de los cambios pendientes para la vista del agente.
//
// El diff se pide donde están los cambios, NO en la raíz del proyecto: cuando el
// proyecto apunta a una carpeta padre (p. ej. un workspace con varios repos
// dentro, elegido así para que los agentes tomen su contexto), esa raíz no es un
// repo y `git diff` fallaba con «Not a git repository». Así que se resuelve el
// repo de cada archivo que el agente editó, y solo si no hay ninguno se cae a la
// raíz del proyecto y, en último caso, a los repos de primer nivel con cambios.
ipcMain.handle('git:diff', async (_e, arg) => {
  const cwd = typeof arg === 'string' ? arg : arg?.cwd
  const editados = (Array.isArray(arg?.paths) ? arg.paths : []).filter((p) => typeof p === 'string' && p)
  if (!cwd) return { ok: false, error: 'Sin proyecto seleccionado' }

  const roots = []
  const add = (r) => {
    if (r && !roots.includes(r)) roots.push(r)
  }

  // 1) los repos de los archivos que el agente tocó en este turno
  for (const p of editados) {
    let dir = p
    try {
      if (!fs.statSync(p).isDirectory()) dir = path.dirname(p)
    } catch {
      dir = path.dirname(p) // el archivo pudo borrarse: su carpeta sigue sirviendo
    }
    add(await repoRoot(dir))
  }
  // 2) el proyecto, si es repo
  if (!roots.length) add(await repoRoot(cwd))
  // 3) carpeta padre sin repo: los repos de primer nivel que tengan cambios
  if (!roots.length) {
    let hijos = []
    try {
      hijos = fs
        .readdirSync(cwd, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => path.join(cwd, d.name))
    } catch {}
    for (const h of hijos.slice(0, 40)) {
      if (!fs.existsSync(path.join(h, '.git'))) continue
      const r = await repoRoot(h)
      if (!r) continue
      try {
        const est = await execFileP('git', ['-C', r, 'status', '--porcelain'], { timeout: 8000 })
        if (est.trim()) add(r)
      } catch {}
    }
  }
  if (!roots.length) {
    return {
      ok: false,
      error: `«${path.basename(cwd)}» no es un repo git y no se encontraron repos con cambios dentro. Sin git no hay diff que mostrar.`,
    }
  }

  try {
    const partes = await Promise.all(roots.map(diffDeRepo))
    const varios = partes.length > 1
    let diff = partes
      .filter((p) => p.diff.trim())
      .map((p) => (varios ? `=== ${path.basename(p.root)} ===\n${p.diff}` : p.diff))
      .join('\n')
    if (diff.length > 300000) diff = diff.slice(0, 300000) + '\n… (recortado)'
    const untracked = partes.flatMap((p) =>
      p.untracked.map((f) => (varios ? `${path.basename(p.root)}/${f}` : f))
    )
    return { ok: true, diff, untracked, repos: roots.map((r) => path.basename(r)) }
  } catch (err) {
    return { ok: false, error: String(err.message || 'git diff falló').slice(0, 300) }
  }
})

// Data URL de una imagen adjunta (miniaturas del chat). Solo sirve archivos
// del directorio de adjuntos de la app — nunca rutas arbitrarias.
ipcMain.handle('image:data', (_e, p) => {
  try {
    const attDir = path.join(app.getPath('userData'), 'attachments')
    const real = fs.realpathSync(p)
    if (!real.startsWith(attDir + path.sep)) return { ok: false, error: 'Fuera del directorio de adjuntos' }
    const st = fs.statSync(real)
    if (st.size > 12 * 1024 * 1024) return { ok: false, error: 'Imagen muy grande' }
    const ext = path.extname(real).toLowerCase().replace('.', '') || 'png'
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return { ok: true, data: `data:image/${mime};base64,${fs.readFileSync(real).toString('base64')}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
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
// CLAUDE.md del proyecto (#108): las instrucciones que los agentes YA leen,
// editables sin salir de la app. Se crea con un esqueleto si no existe.
ipcMain.handle('claudemd:open', (_e, cwd) => {
  const dir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home')
  const file = path.join(dir, 'CLAUDE.md')
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        `# Instrucciones del proyecto\n\n` +
          `Lo que escribas aquí lo leen TODOS los agentes al trabajar en este repo.\n\n` +
          `## Convenciones\n- …\n\n## Comandos útiles\n- Build: \`…\`\n- Tests: \`…\`\n\n## Ojo con\n- …\n`
      )
    }
    execFile('open', ['-t', file], (err) => {
      if (err) execFile('open', [file], () => {})
    })
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ¿el proyecto tiene CLAUDE.md? (para el indicador del menú)
ipcMain.handle('claudemd:has', (_e, cwd) => {
  try {
    return fs.existsSync(path.join(cwd, 'CLAUDE.md'))
  } catch {
    return false
  }
})

ipcMain.handle('board:open', (_e, cwd) => {
  const dir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home')
  const file = path.join(dir, 'SQUAD.md')
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, '# 🧠 Pizarra del squad\n\nMemoria común del equipo. Cada quien anota aquí lo importante.\n')
    }
    ensureSquadIgnored(dir) // memoria local: fuera de los commits
    // -t abre en el editor de texto por defecto (fiable para .md); fallback a open normal
    execFile('open', ['-t', file], (err) => {
      if (err) execFile('open', [file], () => {})
    })
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Correr un comando en la terminal del usuario. Nace de lo que el agente NO
// puede hacer: un `firebase login:add` abre un navegador para el OAuth y en
// headless no hay forma de completarlo.
//
// Se ejecuta en Terminal.app con `do script`, que es lo único scriptable de
// serie en macOS. Deliberadamente en una terminal VISIBLE y no en segundo
// plano: el comando queda a la vista, con su salida, y se puede cortar con
// Ctrl-C. Además se copia al portapapeles, que sirve de red si el usuario
// prefiere pegarlo en Warp o iTerm.
ipcMain.handle('terminal:run', async (_e, { cmd, cwd } = {}) => {
  const comando = String(cmd || '').trim()
  if (!comando) return { ok: false, error: 'Sin comando' }
  // ni saltos de línea ni encadenados a escondidas: lo que se ve es lo que corre
  if (/[\n\r]/.test(comando)) return { ok: false, error: 'Solo se puede correr una línea' }
  const dir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home')
  try {
    clipboard.writeText(comando)
  } catch {}
  // las comillas dobles y las barras hay que escaparlas para AppleScript
  const escapa = (x) => x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const linea = `cd ${JSON.stringify(dir)} && ${comando}`
  // NO se espera al osascript: medido, el `do script` corre el comando enseguida
  // pero la llamada puede quedarse colgada en el `activate` (y la primera vez,
  // en el permiso de automatización de macOS). Esperarla daría un «no se pudo»
  // sobre algo que ya se ejecutó.
  try {
    const hijo = spawn('/usr/bin/osascript', [
      '-e',
      `tell application "Terminal" to do script "${escapa(linea)}"`,
      '-e',
      'tell application "Terminal" to activate',
    ], { detached: true, stdio: 'ignore' })
    hijo.unref()
    return { ok: true }
  } catch (err) {
    // si ni siquiera arrancó, al menos queda copiado para pegarlo a mano
    return { ok: false, copiado: true, error: String(err.message || err).slice(0, 200) }
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
// Peso de una carpeta, sin recursión infinita ni sorpresas: si algo falla se
// devuelve lo contado hasta ahí, porque una limpieza que revienta es peor que
// una que se queda corta.
function pesoDe(dir) {
  let total = 0
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      try {
        total += e.isDirectory() ? pesoDe(p) : fs.statSync(p).size
      } catch {}
    }
  } catch {}
  return total
}

function pruneStorage() {
  const WEEK = 7 * 24 * 3600 * 1000
  // La caché de Chromium: lo que de verdad ocupa. Solo se limpia si se pasó del
  // tope — hacerlo siempre obligaría a volver a descargar todo en cada arranque.
  try {
    const base = app.getPath('userData')
    const peso = pesoDe(path.join(base, 'Cache')) + pesoDe(path.join(base, 'Code Cache'))
    if (tocaLimpiarCache(peso)) {
      console.log(`[oficina] caché en ${Math.round(peso / 1048576)} MB — limpiando`)
      session.defaultSession?.clearCache?.()
      session.defaultSession?.clearCodeCaches?.({})
    }
  } catch {}
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

// ── Auto-update ─────────────────────────────────────────────────────────────
// Descarga la versión nueva en segundo plano y la instala al reiniciar, en vez
// de dejarte un DMG que hay que arrastrar a mano. Solo es posible desde que la
// app va firmada y notarizada: macOS no deja reemplazar una app por otra que no
// pueda verificar, y por eso esto llevaba parado desde la v1.0.
//
// Si algo falla —sin red, sin metadatos en el release, una versión publicada a
// mano sin `latest-mac.yml`— se cae al aviso de siempre, que descarga el DMG y
// abre el instalador. Preferible a no enterarse de que hay versión nueva.
// Por qué se cayó el auto-update, en un archivo.
//
// Antes solo iba a la consola, así que en una app instalada —donde nadie mira
// la consola— el síntoma era este: sale el aviso de siempre ofreciendo el DMG y
// parece que la actualización automática «no existe». Sin el motivo no se puede
// distinguir «no hay versión nueva» de «la hay y falló», que es justo lo que
// hay que saber.
function anotaFalloUpdate(err) {
  const msg = err?.stack || err?.message || String(err)
  console.log('[oficina] auto-update no disponible:', msg)
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'auto-update.log'),
      `${new Date().toISOString()}  v${app.getVersion()}  ${msg}\n`
    )
  } catch {}
}

// El actualizador con la descarga ya lista, para poder aplicarla desde la app.
let updaterListo = null
let versionListaRef = ''

// Aplicar la actualización descargada. Devuelve el motivo si no pudo.
//
// El `quitAndInstall` estaba envuelto en un `catch {}` vacío: si fallaba, no
// pasaba nada y no quedaba rastro — el usuario pulsaba y la app seguía igual.
function aplicaUpdate(desde) {
  if (!updaterListo) return 'no hay ninguna actualización descargada'
  try {
    anotaFalloUpdate(`aplicando v${versionListaRef} desde ${desde}`)
    // isSilent false: si la instalación pide algo, que se vea
    updaterListo.quitAndInstall(false, true)
    return null
  } catch (err) {
    anotaFalloUpdate(err)
    return err?.message || String(err)
  }
}

ipcMain.handle('update:install', () => {
  const error = aplicaUpdate('botón')
  return error ? { ok: false, error } : { ok: true }
})

function iniciaAutoUpdate() {
  if (isDev) return false // el dev comparte userData con la app instalada
  let updater
  try {
    updater = require('electron-updater').autoUpdater
  } catch {
    return false
  }
  updater.autoDownload = true
  // Instalar sin avisar sería reiniciarle la app a alguien con un agente
  // trabajando: se descarga sola y se aplica cuando la persona decida.
  updater.autoInstallOnAppQuit = true
  updater.on('update-downloaded', (info) => {
    const v = info?.version || ''
    updaterListo = updater
    versionListaRef = v
    anotaFalloUpdate(`descargada v${v}, lista para instalar`)
    // Dentro de la app, y no solo en una notificación del sistema: si el clic
    // en la notificación no llega —se descarta, expira, o macOS no lo entrega—
    // no había NINGUNA otra forma de aplicarla, y la actualización se quedaba
    // descargada para siempre sin que el usuario supiera por qué.
    if (win && !win.isDestroyed()) win.webContents.send('update:ready', { version: v })
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: 'La Oficina',
      body: `v${v} lista para instalar. Clic para reiniciar y aplicarla.`,
    })
    n.on('click', () => aplicaUpdate('notificación'))
    n.show()
  })
  updater.on('error', (err) => {
    anotaFalloUpdate(err)
    checkForUpdates() // el camino de siempre
  })
  updater.checkForUpdates().catch((err) => {
    anotaFalloUpdate(err)
    checkForUpdates()
  })
  return true
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

// ── Deep links la-oficina:// (Atajos de macOS, Raycast, scripts) ─────────────
// la-oficina://ask?text=…&role=…  → lanza un prompt · la-oficina://standup
function handleDeepLink(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'la-oficina:') return
    win?.show()
    win?.focus()
    win?.webContents.send('claude:event', {
      kind: 'deep-link',
      action: u.hostname || u.pathname.replace(/^\/+/, ''),
      text: (u.searchParams.get('text') || '').slice(0, 4000),
      role: (u.searchParams.get('role') || '').slice(0, 40),
    })
  } catch {}
}
app.on('open-url', (e, url) => {
  e.preventDefault()
  // puede llegar antes de que la ventana exista (app recién lanzada por el link)
  if (win && !win.isDestroyed()) handleDeepLink(url)
  else app.whenReady().then(() => setTimeout(() => handleDeepLink(url), 2500))
})

// El tope de caché hay que fijarlo ANTES de que arranque la app: después,
// Chromium ya decidió su límite para esta sesión.
app.commandLine.appendSwitch('disk-cache-size', String(CACHE_MAX))

app.whenReady().then(() => {
  pruneStorage()
  createTray()
  try {
    app.setAsDefaultProtocolClient('la-oficina')
  } catch {}
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
  // auto-update si se puede; si no, el aviso de siempre
  setTimeout(() => {
    if (!iniciaAutoUpdate()) checkForUpdates()
  }, 5000) // sin estorbar el arranque
  if (!isDev) {
    protocol.handle('app', (req) => {
      let p = decodeURIComponent(new URL(req.url).pathname)
      if (p === '/' || p === '') p = '/index.html'
      let file = path.join(__dirname, '..', 'dist', p)
      // con asar activo, los assets binarios (modelos 3D, texturas) viven
      // desempaquetados en app.asar.unpacked: net.fetch no lee dentro del asar
      if (/\.(glb|gltf|jpg|png|svg|bin|hdr)$/i.test(p)) {
        const unpacked = file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
        if (fs.existsSync(unpacked)) file = unpacked
      }
      return net.fetch(pathToFileURL(file).toString())
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
    // Onboarding (#106): en vez de solo avisar, ofrecer instalarlo — se abre
    // la terminal con el comando oficial listo y se puede re-verificar sin
    // reiniciar la app.
    const offerInstall = () =>
      dialog
        .showMessageBox(win, {
          type: 'warning',
          title: 'La Oficina',
          message: 'No encontré el binario de Claude Code',
          detail:
            'La Oficina necesita el CLI de Claude Code (plan Pro o Max).\n\n' +
            'Busqué en ~/.local/bin, /usr/local/bin y /opt/homebrew/bin.',
          buttons: ['Instalar…', 'Ya lo instalé', 'Ahora no'],
          defaultId: 0,
          cancelId: 2,
        })
        .then(({ response }) => {
          if (response === 0) {
            // abre la terminal con el instalador oficial escrito y listo
            const cmd = 'curl -fsSL https://claude.ai/install.sh | bash'
            execFile('osascript', [
              '-e',
              `tell application "Terminal" to do script "${cmd}"`,
              '-e',
              'tell application "Terminal" to activate',
            ], (err) => {
              if (err) shell.openExternal('https://claude.ai/download')
            })
          } else if (response === 1) {
            // re-verificar sin reiniciar: si aparece, avisar que ya se puede usar
            const found = CLAUDE_CANDIDATES.find((p2) => fs.existsSync(p2))
            dialog.showMessageBox(win, {
              type: found ? 'info' : 'warning',
              message: found ? '¡Listo! Ya encontré Claude Code' : 'Sigo sin encontrarlo',
              detail: found
                ? `En ${found}. Reinicia La Oficina para empezar a usarlo (y recuerda iniciar sesión con \`claude\` si no lo has hecho).`
                : 'Abre una terminal, corre `claude` para verificar la instalación y el login, y vuelve a intentar.',
            })
          }
        })
    win.once('show', offerInstall)
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
