const { contextBridge, ipcRenderer } = require('electron')

// Puente seguro entre el proceso principal (Node) y el renderer (React).
contextBridge.exposeInMainWorld('oficina', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  // Perfiles (work/private) y proyectos de ~/Workspace para los selectores.
  getConfig: () => ipcRenderer.invoke('config:get'),
  // Envía un prompt a Claude Code (headless). Respuestas llegan por onEvent.
  ask: (payload) => ipcRenderer.invoke('claude:ask', payload),
  // Empieza una conversación nueva (olvida el session_id actual).
  reset: () => ipcRenderer.invoke('claude:reset'),
  // Restaura una sesión guardada para continuarla (--resume).
  setSession: (data) => ipcRenderer.invoke('claude:setSession', data),
  // Monitor: recursos del sistema + % de uso de la suscripción de Claude.
  stats: () => ipcRenderer.invoke('stats:get'),
  // Preferencias: activar/desactivar notificaciones del sistema.
  setNotify: (v) => ipcRenderer.invoke('prefs:notify', v),
  // Configuración del squad (roster por perfil: nombres y activos).
  squad: {
    get: (profile) => ipcRenderer.invoke('squad:get', profile),
    save: (profile, roster) => ipcRenderer.invoke('squad:save', { profile, roster }),
  },
  // Historial de conversaciones.
  history: {
    save: (convo) => ipcRenderer.invoke('history:save', convo),
    list: () => ipcRenderer.invoke('history:list'),
    get: (id) => ipcRenderer.invoke('history:get', id),
    remove: (id) => ipcRenderer.invoke('history:delete', id),
  },
  // Suscripción a eventos del stream: init | text | tool | done | error.
  onEvent: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('claude:event', handler)
    return () => ipcRenderer.removeListener('claude:event', handler)
  },
})
