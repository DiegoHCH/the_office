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
  removeProject: (data) => ipcRenderer.invoke('projects:remove', data),
  onUpdateReady: (cb) => ipcRenderer.on('update:ready', (_e, d) => cb(d)),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  // Buscar versión nueva ahora, sin esperar a que la app pregunte sola.
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  // Badge del Dock con el nº de agentes trabajando.
  dockBadge: (n) => ipcRenderer.invoke('dock:badge', n),
  // Guarda una imagen adjunta y devuelve su ruta local.
  saveImage: (name, data) => ipcRenderer.invoke('image:save', { name, data }),
  // Data URL de una imagen adjunta (miniaturas del chat).
  imageData: (p) => ipcRenderer.invoke('image:data', p),
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
  // acepta la ruta del proyecto o { cwd, paths } con los archivos editados
  gitDiff: (arg) => ipcRenderer.invoke('git:diff', arg),
  // ¿hay un proyecto Flutter a la vista? (instantáneo, solo disco)
  flutterProject: (cwd) => ipcRenderer.invoke('flutter:project', cwd),
  // dónde puede correr el proyecto Flutter: dispositivos y emuladores
  flutterTargets: (cwd) => ipcRenderer.invoke('flutter:targets', cwd),
  // lanza un emulador; vuelve al disparar, no cuando ya arrancó
  flutterLaunchEmulator: (arg) => ipcRenderer.invoke('flutter:launchEmulator', arg),
  // cierra un emulador que ya está arriba
  flutterStopEmulator: (arg) => ipcRenderer.invoke('flutter:stopEmulator', arg),
  // correr el proyecto y controlarlo mientras corre
  flutterRun: (arg) => ipcRenderer.invoke('flutter:run', arg),
  flutterReload: (arg) => ipcRenderer.invoke('flutter:reload', arg),
  flutterStop: (arg) => ipcRenderer.invoke('flutter:stop', arg),
  // recarga automática tras un turno del agente: decide reload/restart/recompilar
  flutterAutoReload: (arg) => ipcRenderer.invoke('flutter:autoReload', arg),
  // «/correr …»: interpreta la frase contra lo que hay conectado
  flutterInterpretaCorrer: (arg) => ipcRenderer.invoke('flutter:interpretaCorrer', arg),
  // vigilar enchufar/desenchufar mientras el panel está abierto
  flutterWatch: (arg) => ipcRenderer.invoke('flutter:watch', arg),
  flutterWatchCwd: (cwd) => ipcRenderer.invoke('flutter:watchCwd', cwd),
  // proyectos npm (web y escritorio): el objetivo es un script, no un dispositivo
  npmProject: (cwd) => ipcRenderer.invoke('npm:project', cwd),
  npmRun: (arg) => ipcRenderer.invoke('npm:run', arg),
  npmInterpreta: (arg) => ipcRenderer.invoke('npm:interpreta', arg),
  // targets de Makefile, agrupados por módulo
  makeProject: (cwd) => ipcRenderer.invoke('make:project', cwd),
  makeRun: (arg) => ipcRenderer.invoke('make:run', arg),
  // correr un comando en la terminal del usuario (lo que el agente no puede)
  terminalRun: (arg) => ipcRenderer.invoke('terminal:run', arg),
  // Artifacts locales: carpeta configurable, listado y abrir en ventana.
  artifacts: {
    getDir: (profile) => ipcRenderer.invoke('artifacts:getDir', profile),
    pickDir: (profile) => ipcRenderer.invoke('artifacts:pickDir', profile),
    list: (profile) => ipcRenderer.invoke('artifacts:list', profile),
    open: (file, profile) => ipcRenderer.invoke('artifacts:open', file, profile),
    reveal: (file, profile) => ipcRenderer.invoke('artifacts:reveal', file, profile),
    zip: (file, profile) => ipcRenderer.invoke('artifacts:zip', file, profile),
    delete: (file, profile) => ipcRenderer.invoke('artifacts:delete', file, profile),
  },
  // Abre la guía de uso en su propia ventana (en el idioma de la interfaz).
  openHelp: (lang) => ipcRenderer.invoke('help:open', lang),
  // Idioma elegido: los agentes responden en él.
  setLang: (v) => ipcRenderer.invoke('prefs:lang', v),
  // Monitor: recursos del sistema + % de uso de la suscripción de Claude.
  stats: (profile) => ipcRenderer.invoke('stats:get', profile),
  refreshUsage: () => ipcRenderer.invoke('stats:refreshUsage'),
  // Preferencias: activar/desactivar notificaciones del sistema.
  setNotify: (v) => ipcRenderer.invoke('prefs:notify', v),
  notifyCustom: (title, body) => ipcRenderer.invoke('notify:custom', { title, body }),
  // Pizarra compartida: activar/desactivar y abrir SQUAD.md del proyecto.
  setBoard: (v) => ipcRenderer.invoke('prefs:board', v),
  openBoard: (cwd) => ipcRenderer.invoke('board:open', cwd),
  // CLAUDE.md del proyecto: abrir/crear y saber si existe.
  openClaudeMd: (cwd) => ipcRenderer.invoke('claudemd:open', cwd),
  hasClaudeMd: (cwd) => ipcRenderer.invoke('claudemd:has', cwd),
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
    // copiar la configuración de un perfil a otro, sin pasar por un archivo
    copyProfile: (arg) => ipcRenderer.invoke('config:copyProfile', arg),
    profileSummary: (prof) => ipcRenderer.invoke('config:profileSummary', prof),
    autoBackup: (extras) => ipcRenderer.invoke('config:autoBackup', extras),
    backups: () => ipcRenderer.invoke('config:backups'),
  },
  // Servidores MCP por perfil.
  mcp: {
    list: (profile) => ipcRenderer.invoke('mcp:list', profile),
    account: (profile) => ipcRenderer.invoke('mcp:account', profile),
    add: (profile, name, opts) => ipcRenderer.invoke('mcp:add', { profile, name, ...opts }), // opts: {url} | {cmd, env?}
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
    list: (profile) => ipcRenderer.invoke('history:list', profile),
    get: (id) => ipcRenderer.invoke('history:get', id),
    remove: (id) => ipcRenderer.invoke('history:delete', id),
    export: (id) => ipcRenderer.invoke('history:export', id),
    pin: (id, pinned) => ipcRenderer.invoke('history:pin', { id, pinned }),
    rename: (id, title) => ipcRenderer.invoke('history:rename', { id, title }),
    search: (q, profile) => ipcRenderer.invoke('history:search', q, profile),
  },
  // Suscripción a eventos del stream: init | text | tool | done | error.
  onEvent: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('claude:event', handler)
    return () => ipcRenderer.removeListener('claude:event', handler)
  },
  // eventos de la app que está corriendo: progreso, logs, arranque y parada
  onFlutterEvent: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('flutter:event', handler)
    return () => ipcRenderer.removeListener('flutter:event', handler)
  },
})
