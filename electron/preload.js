const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Puente seguro entre el proceso principal (Node) y el renderer (React).
contextBridge.exposeInMainWorld('oficina', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  // Perfiles (work/private) y proyectos de ~/Workspace para los selectores.
  getConfig: () => ipcRenderer.invoke('config:get'),
  // Envía un prompt a Claude Code (headless). Respuestas llegan por onEvent.
  ask: (payload) => ipcRenderer.invoke('claude:ask', payload),
  // Detiene la tarea en curso de un agente.
  stop: (role) => ipcRenderer.invoke('claude:stop', role),
  // Empieza una conversación nueva (olvida el session_id actual).
  reset: () => ipcRenderer.invoke('claude:reset'),
  // Restaura una sesión guardada para continuarla (--resume).
  setSession: (data) => ipcRenderer.invoke('claude:setSession', data),
  // Abre la terminal (Warp o la predeterminada) en la carpeta indicada.
  openTerminal: (cwd) => ipcRenderer.invoke('terminal:open', cwd),
  // Agrega un proyecto al perfil desde un picker de carpeta (persistido).
  addProject: (profile) => ipcRenderer.invoke('projects:add', profile),
  // Badge del Dock con el nº de agentes trabajando.
  dockBadge: (n) => ipcRenderer.invoke('dock:badge', n),
  // Guarda una imagen adjunta y devuelve su ruta local.
  saveImage: (name, data) => ipcRenderer.invoke('image:save', { name, data }),
  // Ruta absoluta de un File arrastrado (Electron 32+: vía webUtils).
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return null
    }
  },
  // ¿la ruta es archivo o carpeta? (para el chip y el prompt)
  pathInfo: (p) => ipcRenderer.invoke('path:info', p),
  // Diff del proyecto (cambios de los agentes en modo edición).
  gitDiff: (cwd) => ipcRenderer.invoke('git:diff', cwd),
  // Artifacts locales: carpeta configurable, listado y abrir en ventana.
  artifacts: {
    getDir: () => ipcRenderer.invoke('artifacts:getDir'),
    pickDir: () => ipcRenderer.invoke('artifacts:pickDir'),
    list: () => ipcRenderer.invoke('artifacts:list'),
    open: (file) => ipcRenderer.invoke('artifacts:open', file),
    reveal: (file) => ipcRenderer.invoke('artifacts:reveal', file),
    zip: (file) => ipcRenderer.invoke('artifacts:zip', file),
  },
  // Abre la guía de uso en su propia ventana.
  openHelp: () => ipcRenderer.invoke('help:open'),
  // Monitor: recursos del sistema + % de uso de la suscripción de Claude.
  stats: (profile) => ipcRenderer.invoke('stats:get', profile),
  refreshUsage: () => ipcRenderer.invoke('stats:refreshUsage'),
  // Preferencias: activar/desactivar notificaciones del sistema.
  setNotify: (v) => ipcRenderer.invoke('prefs:notify', v),
  // Pizarra compartida: activar/desactivar y abrir SQUAD.md del proyecto.
  setBoard: (v) => ipcRenderer.invoke('prefs:board', v),
  openBoard: (cwd) => ipcRenderer.invoke('board:open', cwd),
  // Abre/crea el .md de personalidad de un personaje (por perfil).
  openPersona: (profile, role, name) => ipcRenderer.invoke('persona:open', { profile, role, name }),
  // Skills de Claude Code por perfil (catálogo instalable).
  skills: {
    list: (profile) => ipcRenderer.invoke('skills:list', profile),
    install: (profile, id, repo) => ipcRenderer.invoke('skills:install', { profile, id, repo }),
    remove: (profile, id) => ipcRenderer.invoke('skills:remove', { profile, id }),
    scan: (source) => ipcRenderer.invoke('skills:scan', source),
    create: (profile, name, description) => ipcRenderer.invoke('skills:create', { profile, name, description }),
  },
  // Plugins de Claude Code por perfil (marketplaces del CLI).
  plugins: {
    list: (profile) => ipcRenderer.invoke('plugins:list', profile),
    marketplaces: (profile) => ipcRenderer.invoke('plugins:marketplaces', profile),
    addMarketplace: (profile, source) => ipcRenderer.invoke('plugins:addMarketplace', { profile, source }),
    removeMarketplace: (profile, name) => ipcRenderer.invoke('plugins:removeMarketplace', { profile, name }),
    install: (profile, id) => ipcRenderer.invoke('plugins:install', { profile, id }),
    uninstall: (profile, id) => ipcRenderer.invoke('plugins:uninstall', { profile, id }),
  },
  // Exportar/importar configuración (squad + plantillas + personas).
  config: {
    export: (extras) => ipcRenderer.invoke('config:export', extras),
    import: () => ipcRenderer.invoke('config:import'),
  },
  // Servidores MCP por perfil.
  mcp: {
    list: (profile) => ipcRenderer.invoke('mcp:list', profile),
    add: (profile, name, opts) => ipcRenderer.invoke('mcp:add', { profile, name, ...opts }),
    remove: (profile, name) => ipcRenderer.invoke('mcp:remove', { profile, name }),
  },
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
    export: (id) => ipcRenderer.invoke('history:export', id),
    pin: (id, pinned) => ipcRenderer.invoke('history:pin', { id, pinned }),
  },
  // Suscripción a eventos del stream: init | text | tool | done | error.
  onEvent: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('claude:event', handler)
    return () => ipcRenderer.removeListener('claude:event', handler)
  },
})
