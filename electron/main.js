const { app, BrowserWindow, ipcMain, protocol, net } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
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

// Personalidad de cada miembro del squad (--append-system-prompt).
const ROLE_PROMPTS = {
  dev: 'Eres Luffy, dev principal del squad. Tu foco: implementar código, arreglar bugs y refactorizar. Preséntate como Luffy cuando te saluden.',
  research:
    'Eres Nami, investigadora del squad. Tu foco: investigar código y web, analizar, comparar y producir documentos/artifacts claros (archivos .md bien estructurados). Preséntate como Nami cuando te saluden.',
  design:
    'Eres Sanji, diseñador UI/UX del squad. Tu foco: diseño de interfaces, experiencia de usuario, estilos, accesibilidad y propuestas visuales concretas. Preséntate como Sanji cuando te saluden.',
  qa: 'Eres Zoro, QA del squad. Tu foco: calidad — escribir tests, ejecutarlos, reproducir bugs y reportar resultados con claridad. Preséntate como Zoro cuando te saluden.',
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

// Parser de una línea NDJSON del stream, ligado al rol que la produce.
function makeLineHandler(role, sessionKey) {
  return (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    if (msg.type === 'system' && msg.subtype === 'init') {
      if (msg.session_id) sessions.set(sessionKey, msg.session_id)
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
        if (block.type === 'tool_use') emit({ kind: 'tool', role, name: block.name })
      }
      return
    }

    if (msg.type === 'result') {
      if (msg.session_id) sessions.set(sessionKey, msg.session_id)
      console.log('[claude:result]', role, JSON.stringify({ cost: msg.total_cost_usd, session: msg.session_id }))
      emit({ kind: 'done', role, result: msg.result ?? '', cost: msg.total_cost_usd ?? null })
    }
  }
}

// Config para el renderer: perfiles, proyectos y modelos default.
ipcMain.handle('config:get', () => {
  const home = app.getPath('home')
  const profiles = Object.keys(PROFILE_DIRS).filter((p) => fs.existsSync(PROFILE_DIRS[p]()))
  const projectsByProfile = {}
  for (const p of profiles.length ? profiles : ['default']) {
    const rootName = PROJECT_ROOTS[p] || ''
    const root = path.join(home, rootName)
    const list = [{ name: `🗂 ${rootName || 'Home'}`, path: root }]
    try {
      fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .forEach((d) => list.push({ name: d.name, path: path.join(root, d.name) }))
    } catch {}
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
  const { prompt, profile = 'work', cwd, writeMode = false, model = '', role = 'dev' } =
    typeof payload === 'string' ? { prompt: payload } : payload

  if (children.has(role)) return { ok: false, error: `${role} ya está trabajando en algo` }

  const workdir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home')
  const sessionKey = `${role}::${profile}::${workdir}`
  const sid = sessions.get(sessionKey)

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--allowedTools', writeMode ? WRITE_TOOLS : READ_TOOLS,
    '--append-system-prompt', ROLE_PROMPTS[role] || ROLE_PROMPTS.dev,
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

  const handleLine = makeLineHandler(role, sessionKey)
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
    if (code !== 0 && code !== null) {
      emit({ kind: 'error', role, message: `claude terminó con código ${code} (mira la terminal)` })
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
