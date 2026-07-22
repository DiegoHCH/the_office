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

ipcMain.handle('claude:ask', (_e, prompt) => {
  if (child) return { ok: false, error: 'Claude ya está procesando un mensaje' }

  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
  if (sessionId) args.push('--resume', sessionId)

  // Sin API key en el entorno → usa el login de la suscripción ($0 por token).
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN

  try {
    child = spawn(CLAUDE_BIN, args, { cwd: app.getPath('home'), env })
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
