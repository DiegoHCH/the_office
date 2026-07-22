const { app, BrowserWindow, ipcMain, protocol, net, Notification } = require('electron')
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
    `Eres ${n}, revisor/a de Pull Requests del squad. Tu foco: revisar PRs y diffs con ojo crítico — correctitud, diseño, tests, riesgos y estilo — y dar feedback concreto y accionable. Eres dueño/a de TODO el flujo de PRs: si el proyecto tiene skills/slash-commands relacionados con PRs (p. ej. /g66-pr, /pre-pr, /review-pr, /merge-hu), úsalos cuando la tarea lo amerite. Preséntate como ${n} cuando te saluden.`,
  docs: (n) =>
    `Eres ${n}, technical writer del squad. Tu foco: documentación clara — READMEs, guías, ADRs, comentarios útiles. Preséntate como ${n} cuando te saluden.`,
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
]

const squadFile = (profile) => path.join(app.getPath('userData'), `squad-${profile}.json`)

// Roster del perfil: defaults + overrides guardados (nombre/enabled por rol).
function getSquad(profile) {
  let saved = {}
  try {
    saved = JSON.parse(fs.readFileSync(squadFile(profile), 'utf8'))
  } catch {}
  return DEFAULT_SQUAD.map((d) => ({ ...d, ...(saved[d.id] || {}) }))
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
      } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        emit({ kind: 'tool', role, name: ev.content_block.name })
      }
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
    const map = {}
    for (const r of roster) map[r.id] = { name: r.name, enabled: r.enabled, avatar: r.avatar || null }
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(squadFile(profile), JSON.stringify(map, null, 2))
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
  const persona = (ROLE_TEMPLATES[role] || ROLE_TEMPLATES.dev)(displayName)

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--allowedTools', writeMode ? WRITE_TOOLS : READ_TOOLS,
    '--append-system-prompt', persona,
  ]
  if (writeMode) args.push('--permission-mode', 'acceptEdits')
  if (model) args.push('--model', model)
  if (sid) args.push('--resume', sid)

  // Sin API key en el entorno → usa el login de la suscripción ($0 por token).
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
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
  child.stderr.on('data', (chunk) => {
    console.error(`[claude:stderr:${role}]`, chunk.toString())
  })
  child.on('error', (err) => {
    emit({ kind: 'error', role, message: `Error al ejecutar claude: ${err.message}` })
    children.delete(role)
  })
  child.on('close', (code) => {
    // una detención del usuario no es un error (SIGTERM sale con 143)
    if (code !== 0 && code !== null && !child.stoppedByUser) {
      emit({ kind: 'error', role, message: `claude terminó con código ${code} (mira la terminal)` })
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
              const j = JSON.parse(body)
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
const usageCache = {} // profile → { at, data }
ipcMain.handle('stats:refreshUsage', () => {
  for (const k of Object.keys(usageCache)) usageCache[k].at = 0
  return { ok: true }
})
ipcMain.handle('stats:get', async (_e, profile = 'work') => {
  const c = (usageCache[profile] ||= { at: 0, data: null })
  if (Date.now() - c.at > 5 * 60_000) {
    c.at = Date.now()
    fetchClaudeUsage(profile).then((d) => {
      c.data = d // null si no hay token → el renderer oculta la sección
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
  helpWin.on('closed', () => {
    helpWin = null
  })
  return { ok: true }
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

app.whenReady().then(() => {
  if (!isDev) {
    protocol.handle('app', (req) => {
      let p = decodeURIComponent(new URL(req.url).pathname)
      if (p === '/' || p === '') p = '/index.html'
      return net.fetch(pathToFileURL(path.join(__dirname, '..', 'dist', p)).toString())
    })
  }
  console.log('[oficina] usando binario claude en:', CLAUDE_BIN)
  createWindow()
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
