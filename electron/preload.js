const { contextBridge, ipcRenderer } = require('electron')

// Puente seguro entre el proceso principal (Node) y el renderer (React).
// En la Fase 2 aquí exponemos claude.ask() y la suscripción a eventos de streaming.
contextBridge.exposeInMainWorld('oficina', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  // Fase 2:
  // ask: (prompt) => ipcRenderer.invoke('claude:ask', prompt),
  // onEvent: (cb) => {
  //   const handler = (_e, data) => cb(data)
  //   ipcRenderer.on('claude:event', handler)
  //   return () => ipcRenderer.removeListener('claude:event', handler)
  // },
})
