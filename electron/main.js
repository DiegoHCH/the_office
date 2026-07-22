const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const isDev = process.env.NODE_ENV === 'development'

// Ruta absoluta del binario: Electron NO hereda el PATH del shell interactivo.
const CLAUDE_CANDIDATES = [
  path.join(app.getPath('home'), '.local', 'bin', 'claude'),
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
]
const CLAUDE_BIN = CLAUDE_CANDIDATES.find((p) => fs.existsSync(p)) || 'claude'

let win = null
let child = null // proceso claude en curso (uno a la vez)
let sessionId = null // para multi-turno con --resume
let sessionKey = null // perfil+cwd de la sesión actual (si cambia, conversación nueva)

// Herramientas por modo. Lectura: investigar sin tocar nada.
// Escritura: puede editar archivos y correr comandos (con acceptEdits).
const READ_TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch'
const WRITE_TOOLS = `${READ_TOOLS},Edit,Write,NotebookEdit,Bash`

// Perfiles = mismos alias que en zsh: claude-work / claude-private
// (cada CLAUDE_CONFIG_DIR tiene su propio login y sesiones).
const PROFILE_DIRS = {
  work: () => path.join(app.getPath('home'), '.claude-work'),
  private: () => path.join(app.getPath('home'), '.claude-private'),
}

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
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  win.on('closed', () => {
    win = null
  })
}

const emit = (payload) => {
  if (win && !win.isDestroyed()) win.webContents.send('claude:event', payload)
}

// Procesa una línea NDJSON del stream de claude y la traduce a eventos simples.
function handleLine(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return // línea no-JSON (ruido), ignorar
  }

  if (msg.type === 'system' && msg.subtype === 'init') {
    sessionId = msg.session_id || sessionId
    emit({ kind: 'init', sessionId })
    return
  }

  // streaming token a token (--include-partial-messages)
  if (msg.type === 'stream_event' && msg.event) {
    const ev = msg.event
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      emit({ kind: 'text', text: ev.delta.text })
    } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      emit({ kind: 'tool', name: ev.content_block.name })
    }
    return
  }

  // fallback: mensajes assistant completos (por si no llegan deltas de texto)
  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content) {
      if (block.type === 'tool_use') emit({ kind: 'tool', name: block.name })
    }
    return
  }

  if (msg.type === 'result') {
    sessionId = msg.session_id || sessionId
    // total_cost_usd debe reflejar la suscripción — se loguea para verificar
    console.log('[claude:result]', JSON.stringify({ cost: msg.total_cost_usd, session: sessionId }))
    emit({ kind: 'done', result: msg.result ?? '', cost: msg.total_cost_usd ?? null })
  }
}

// Carpeta de proyectos por perfil: work → ~/Workspace, private → ~/personal.
const PROJECT_ROOTS = { work: 'Workspace', private: 'personal' }

// Config para el renderer: perfiles disponibles y sus proyectos.
ipcMain.handle('config:get', () => {
  const home = app.getPath('home')
  const profiles = Object.keys(PROFILE_DIRS).filter((p) => fs.existsSync(PROFILE_DIRS[p]()))
  const projectsByProfile = {}
  for (const p of profiles.length ? profiles : ['default']) {
    const rootName = PROJECT_ROOTS[p] || ''
    const root = path.join(home, rootName)
    // La raíz va primero y es el default: en work se lanza claude desde
    // ~/Workspace para que cargue el protocolo ai-context (global-b2c, etc.).
    const list = [{ name: `🗂 ${rootName || 'Home'}`, path: root }]
    try {
      fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .forEach((d) => list.push({ name: d.name, path: path.join(root, d.name) }))
    } catch {}
    projectsByProfile[p] = list
  }
  // modelo default de cada perfil (settings.json del CLAUDE_CONFIG_DIR)
  const defaultModels = {}
  for (const p of profiles) {
    try {
      defaultModels[p] = JSON.parse(
        fs.readFileSync(path.join(PROFILE_DIRS[p](), 'settings.json'), 'utf8')
      ).model || null
    } catch {
      defaultModels[p] = null
    }
  }
  return { profiles: profiles.length ? profiles : ['default'], projectsByProfile, defaultModels }
})

ipcMain.handle('claude:reset', () => {
  sessionId = null
  sessionKey = null
  return { ok: true }
})

ipcMain.handle('claude:ask', (_e, payload) => {
  if (child) return { ok: false, error: 'Claude ya está procesando un mensaje' }

  const { prompt, profile = 'work', cwd, writeMode = false, model = '' } =
    typeof payload === 'string' ? { prompt: payload } : payload
  const workdir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home')

  // cambiar de perfil o de proyecto = conversación nueva (las sesiones no cruzan)
  const key = `${profile}::${workdir}`
  if (key !== sessionKey) {
    sessionId = null
    sessionKey = key
  }

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--allowedTools', writeMode ? WRITE_TOOLS : READ_TOOLS,
  ]
  if (writeMode) args.push('--permission-mode', 'acceptEdits')
  if (model) args.push('--model', model)
  if (sessionId) args.push('--resume', sessionId)

  // Sin API key en el entorno → usa el login de la suscripción ($0 por token).
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  // perfil work/private = mismo mecanismo que los alias de zsh
  if (PROFILE_DIRS[profile]) env.CLAUDE_CONFIG_DIR = PROFILE_DIRS[profile]()
  else delete env.CLAUDE_CONFIG_DIR

  try {
    child = spawn(CLAUDE_BIN, args, { cwd: workdir, env })
  } catch (err) {
    child = null
    return { ok: false, error: `No pude lanzar claude: ${err.message}` }
  }

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
    console.error('[claude:stderr]', chunk.toString())
  })
  child.on('error', (err) => {
    emit({ kind: 'error', message: `Error al ejecutar claude: ${err.message}` })
    child = null
  })
  child.on('close', (code) => {
    if (code !== 0 && code !== null) {
      emit({ kind: 'error', message: `claude terminó con código ${code} (mira la terminal)` })
    }
    child = null
  })

  return { ok: true }
})

ipcMain.handle('app:version', () => app.getVersion())

app.whenReady().then(() => {
  console.log('[oficina] usando binario claude en:', CLAUDE_BIN)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  child?.kill()
})

app.on('window-all-closed', () => {
  child?.kill()
  child = null
  if (process.platform !== 'darwin') app.quit()
})
