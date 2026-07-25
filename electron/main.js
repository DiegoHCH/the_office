const { app, BrowserWindow, ipcMain, protocol, net, Notification, dialog, shell } = require('electron')
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

// Squad por defecto: nombres genéricos — cada usuario los personaliza
// desde ⚙️ y ahí sí se guardan sus nombres en su perfil.
const DEFAULT_SQUAD = [
  { id: 'dev', name: 'Dev', enabled: true },
  { id: 'research', name: 'Research', enabled: true },
  { id: 'design', name: 'Diseño', enabled: true },
  { id: 'qa', name: 'QA', enabled: true },
  { id: 'pr', name: 'Revisor PR', enabled: false },
  { id: 'docs', name: 'Docs', enabled: false },
  { id: 'publish', name: 'Publicador', enabled: false },
]

const squadFile = (profile) => path.join(app.getPath('userData'), `squad-${profile}.json`)

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
  // Formato antiguo (mapa {id:{name,enabled,avatar}}): solo built-ins.
  if (saved && !Array.isArray(saved)) {
    return DEFAULT_SQUAD.map((d) => ({ ...d, ...(saved[d.id] || {}), custom: false }))
  }
  // Formato nuevo (array de roles). Los built-ins se re-agregan SIEMPRE (por si
  // una actualización trae uno nuevo) salvo los marcados como borrados (tombstone
  // `{id, deleted:true}`); los protegidos nunca se borran. + roles custom.
  if (Array.isArray(saved)) {
    const byId = Object.fromEntries(saved.map((r) => [r.id, r]))
    const deleted = new Set(saved.filter((r) => r.deleted && !PROTECTED_ROLES.has(r.id)).map((r) => r.id))
    const builtins = DEFAULT_SQUAD.filter((d) => !deleted.has(d.id)).map((d) => ({
      ...d,
      ...(byId[d.id] && !byId[d.id].deleted ? byId[d.id] : {}),
      custom: false,
    }))
    const customs = saved.filter((r) => r.custom && !r.deleted).map((r) => ({ ...r, custom: true }))
    return [...builtins, ...customs]
  }
  return DEFAULT_SQUAD.map((d) => ({ ...d, custom: false }))
}

let notifEnabled = true
ipcMain.handle('prefs:notify', (_e, v) => {
  notifEnabled = !!v
  return { ok: true }
})

// Notifica solo si la ventana no está al frente (tareas largas en background).
function notify(displayName, body) {
  if (!notifEnabled || !Notification.isSupported() || !win || win.isDestroyed() || win.isFocused()) return
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
// Robin (rol PR) además necesita las tools MCP de los conectores que usan los
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

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: '#0e1417',
    title: 'La Oficina',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

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
      emit({ kind: 'done', role, result: msg.result ?? '', cost: msg.total_cost_usd ?? null })
      notify(displayName, msg.result)
    }
  }
}

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

// Detiene la tarea en curso de un tripulante (mata su proceso claude).
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
    `\n\nARTIFACTS: si te piden un "artifact", una página web, un dashboard, un diagrama o algo visual, ` +
    `créalo como un archivo HTML y guárdalo con la herramienta Write en la carpeta: ${artDir} ` +
    `(nombre descriptivo terminado en .html). El CSS y el JS van INLINE (sin CDNs ni librerías externas). ` +
    `IMÁGENES: puedes y debes usar imágenes cuando aporten. Busca en la web imágenes relevantes con WebSearch/WebFetch ` +
    `y consigue la URL DIRECTA del archivo de imagen (que termine en .png/.jpg/.svg/.webp). ` +
    `Para máxima fiabilidad, si tienes Bash disponible, descárgalas con curl a una subcarpeta 'assets/' junto al HTML y refiérelas con ruta relativa; ` +
    `si no, úsalas por su URL directa en <img src>. Si no consigues una imagen fiable, usa un emoji, un SVG inline o un placeholder — nunca dejes imágenes rotas. ` +
    `No publiques a internet ni uses .md para esto; la app abrirá el HTML renderizado.`
  // Rol publicador (Franky): procedimiento concreto para publicar artifacts en GitHub Pages.
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

  // Robin (rol PR) ejecuta skills que llaman conectores MCP (Jira/Slack). En
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
    fs.writeFileSync(path.join(HIST_DIR, `${convo.id}.json`), JSON.stringify(convo, null, 2))
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

ipcMain.handle('history:delete', (_e, id) => {
  try {
    fs.unlinkSync(path.join(HIST_DIR, `${id}.json`))
    return { ok: true }
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
ipcMain.handle('help:open', () => {
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
})

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
        return { p, at: fs.statSync(p).mtimeMs }
      })
      .sort((a, b) => b.at - a.at)
    for (const { p } of convos.slice(100)) {
      try {
        fs.unlinkSync(p)
      } catch {}
    }
  } catch {}
}

app.whenReady().then(() => {
  pruneStorage()
  if (!isDev) {
    protocol.handle('app', (req) => {
      let p = decodeURIComponent(new URL(req.url).pathname)
      if (p === '/' || p === '') p = '/index.html'
      return net.fetch(pathToFileURL(path.join(__dirname, '..', 'dist', p)).toString())
    })
  }
  console.log('[oficina] usando binario claude en:', CLAUDE_BIN)
  createWindow()
  // Aviso claro al arrancar si no encontramos el binario — antes el fallo
  // aparecía como "spawn claude ENOENT" recién al enviar el primer mensaje.
  if (CLAUDE_BIN === 'claude') {
    dialog.showMessageBox(win, {
      type: 'warning',
      title: 'La Oficina',
      message: 'No encontré el binario de Claude Code',
      detail:
        'Busqué en ~/.local/bin, /usr/local/bin y /opt/homebrew/bin.\n\n' +
        'Instálalo con:\n  curl -fsSL https://claude.ai/install.sh | bash\n\n' +
        'inicia sesión con `claude` en la terminal y vuelve a abrir La Oficina.',
    })
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
app.on('window-all-closed', () => {
  killAll()
  if (process.platform !== 'darwin') app.quit()
})
