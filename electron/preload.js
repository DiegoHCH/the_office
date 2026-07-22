const { contextBridge, ipcRenderer } = require('electron')

// Puente seguro entre el proceso principal (Node) y el renderer (React).
contextBridge.exposeInMainWorld('oficina', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  // Envía un prompt a Claude Code (headless). Respuestas llegan por onEvent.
  ask: (prompt) => ipcRenderer.invoke('claude:ask', prompt),
  // Suscripción a eventos del stream: init | text | tool | done | error.
  onEvent: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('claude:event', handler)
    return () => ipcRenderer.removeListener('claude:event', handler)
  },
})
