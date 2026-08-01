// Lógica pura del proceso principal (#116), extraída para poder probarla sin
// arrancar Electron. Aquí vive lo que más caro sale si se rompe en silencio:
// el saneado del entorno de los agentes, la exclusión de credenciales al
// exportar y la lectura de la respuesta de cuota.
//
// Nada de esto importa `electron`: main.js las llama pasándole lo que haga
// falta (home, rutas de perfil…), y los tests las llaman directo.

// ── Entorno de los agentes ───────────────────────────────────────────────────
// Sin API key en el entorno, Claude Code usa el login de la suscripción; si se
// cuela, cobra por token. El PATH del shell de login no llega a Electron, así
// que se añaden las rutas típicas para que encuentren gh, acli, node…
function sanitizeEnv(base, { home, profileDir, extraPath } = {}) {
  const env = { ...base }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  // `extraPath` va DELANTE: son las rutas del shell de login del usuario y el
  // SDK que fija el proyecto, y su orden es intencionado —los shims de rbenv o
  // nvm tienen que tapar a los binarios del sistema, no al revés—.
  const delante = (extraPath || []).filter(Boolean)
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', home ? `${home}/.local/bin` : null].filter(Boolean)
  env.PATH = [...new Set([...delante, ...(env.PATH || '').split(':').filter(Boolean), ...extra])].join(':')
  // un perfil (work/private) fija su CLAUDE_CONFIG_DIR; sin perfil se quita,
  // porque heredarlo del shell mezclaría las cuentas
  if (profileDir) env.CLAUDE_CONFIG_DIR = profileDir
  else delete env.CLAUDE_CONFIG_DIR
  return env
}

// ── Sesiones ─────────────────────────────────────────────────────────────────
// Cada personaje tiene contexto propio POR proyecto y POR cuenta: si la clave
// pierde una de las tres partes, dos agentes comparten sesión (o un mismo
// agente arrastra el contexto de otro repo).
const sessionKey = (role, profile, workdir) => `${role}::${profile}::${workdir}`

// ── Exportar configuración ───────────────────────────────────────────────────
// Un servidor MCP con headers o env lleva credenciales dentro (Jira, Slack…).
// Esos NO salen en el export: se listan aparte para que el usuario los
// reconecte a mano en la otra máquina.
function pickSafeMcp(mcpServers) {
  const safe = {}
  const skipped = []
  for (const [name, srv] of Object.entries(mcpServers || {})) {
    const secretos = Object.keys(srv?.headers || {}).length > 0 || Object.keys(srv?.env || {}).length > 0
    if (secretos) skipped.push(name)
    else safe[name] = srv
  }
  return { safe, skipped }
}

// ── Cuota de la suscripción ──────────────────────────────────────────────────
// Solo un 200 con datos reales cuenta como éxito. Un 401/5xx devolvía antes
// {session:null, weekly:null}, que pisaba el último dato bueno y hacía
// "desaparecer" el monitor; ahora devuelve null y la caché conserva lo anterior.
// El 429 es aparte: la API limita por hora y por IP, así que se respeta
// retry-after en vez de reintentar a ciegas.
function parseUsage(statusCode, headers, body) {
  if (statusCode === 429) {
    const ra = Number(headers?.['retry-after']) || 900
    return { rateLimited: true, retryAfter: Math.min(ra, 3600) }
  }
  if (statusCode !== 200) return null
  let j
  try {
    j = JSON.parse(body)
  } catch {
    return null
  }
  if (!j.five_hour && !j.seven_day) return null
  return {
    session: j.five_hour ? { pct: j.five_hour.utilization ?? 0, resetsAt: j.five_hour.resets_at } : null,
    weekly: j.seven_day ? { pct: j.seven_day.utilization ?? 0, resetsAt: j.seven_day.resets_at } : null,
  }
}

// ── Pizarra del squad ────────────────────────────────────────────────────────
// SQUAD.md es memoria local y no debe colarse en los commits. Devuelve el nuevo
// contenido del .gitignore, o null si ya estaba (para no reescribir el archivo).
function gitignoreConSquad(actual) {
  const cur = actual || ''
  if (cur.split('\n').some((l) => l.trim() === 'SQUAD.md')) return null
  return (cur && !cur.endsWith('\n') ? `${cur}\n` : cur) + 'SQUAD.md\n'
}

// ── Argumentos del CLI ───────────────────────────────────────────────────────
// Niveles de esfuerzo que acepta el CLI (`claude --effort`, verificado: un valor
// desconocido no falla, avisa y usa el default). Se valida antes de pasarlo para
// no depender de ese aviso: un flag ignorado en silencio es peor que no mandarlo,
// porque el usuario cree que eligió algo.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const effortValido = (e) => (EFFORTS.includes(e) ? e : null)

// Definición del subagente al que se delega. Existe por una razón concreta: un
// subagente arranca con el system prompt del CLI y NO hereda la persona del que
// lo lanza, así que contestaba en inglés aunque el usuario tenga español.
// Pedírselo al que reparte no bastaba —lo cumplía a medias—; esto sí, porque es
// el prompt propio del subagente. Verificado contra el binario.
const agentesDeEquipo = (idioma) =>
  JSON.stringify({
    companero: {
      description: 'Miembro del equipo al que se le asigna una parte del trabajo',
      prompt:
        `Eres un miembro del equipo de esta oficina y te han asignado una parte de un trabajo mayor. ` +
        `Responde SIEMPRE en ${idioma}, pase lo que pase, aunque el encargo te llegue en otro idioma. ` +
        `Tu respuesta la lee una persona en su propia pestaña, así que ve al grano y da conclusiones, no un diario de lo que hiciste.`,
    },
  })

// El Revisor PR corre con bypassPermissions: sus skills llaman conectores MCP
// que en headless no tienen prompt de aprobación. El resto va en acceptEdits.
function buildClaudeArgs({ prompt, allowed, persona, writeMode, isPR, model, sid, effort, idioma }) {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--allowedTools',
    allowed,
    '--append-system-prompt',
    persona,
    // Sin esto, el trabajo de los subagentes no llega al stream: se veía un chip
    // «Agent» y varios minutos de silencio absoluto hasta la respuesta final.
    '--forward-subagent-text',
  ]
  if (idioma) args.push('--agents', agentesDeEquipo(idioma))
  if (writeMode) args.push('--permission-mode', isPR ? 'bypassPermissions' : 'acceptEdits')
  if (model) args.push('--model', model)
  if (effortValido(effort)) args.push('--effort', effort)
  if (sid) args.push('--resume', sid)
  return args
}

// ── Subagentes ───────────────────────────────────────────────────────────────
// Un agente puede delegar con la herramienta `Agent`, y cada subagente trabaja
// con su PROPIO contexto: es la forma de repartir un encargo grande sin saturar
// el del principal. Con --forward-subagent-text su trabajo llega al stream.
//
// Cómo se distingue quién habla: todo mensaje trae `parent_tool_use_id` — null
// si es del principal, y el id del tool_use que lo lanzó si es de un subagente.
// Ese id es la clave estable para repartir mensajes por pestaña y personaje.
//
// Ojo con lo que NO llega: los deltas de streaming (`stream_event`) son siempre
// del principal, verificado contra el binario. El texto de un subagente llega en
// mensajes completos, así que su pestaña se llena por bloques y no letra a letra.
function subDeMensaje(msg) {
  const id = msg?.parent_tool_use_id
  if (!id) return null
  return { id, tipo: msg.subagent_type || null, desc: msg.task_description || null }
}


// ── Objetivos de Flutter: dispositivos y emuladores ──────────────────────────
// El proyecto puede correr en un móvil enchufado, en un emulador ya arrancado o
// en escritorio/web. `flutter devices --machine` da JSON limpio, pero
// `flutter emulators` NO admite --machine: solo una tabla de texto, y de ahí
// salen los emuladores que se pueden lanzar.

// ¿El proyecto es Flutter? Un pubspec.yaml que dependa del SDK de Flutter.
// Se mira el texto en crudo para no arrastrar un parser de YAML por esto.
function esProyectoFlutter(pubspec) {
  if (!pubspec) return false
  return /^\s*(sdk:\s*flutter|flutter:\s*$)/m.test(pubspec) || /^dependencies:[\s\S]*?^\s{2}flutter:/m.test(pubspec)
}

// Cuál es el proyecto Flutter, dado el proyecto elegido y sus subcarpetas.
//
// El proyecto puede apuntar a una carpeta padre —un workspace con varios repos
// dentro, elegido así para que los agentes tomen su contexto— y entonces el
// pubspec no está en la raíz sino un nivel más abajo. Mismo caso que el diff.
//
// `candidatos` son { dir, pubspec } ya leídos: la raíz primero y luego sus hijos.
function buscaProyectosFlutter(candidatos) {
  return (Array.isArray(candidatos) ? candidatos : []).filter((c) => esProyectoFlutter(c?.pubspec)).map((c) => c.dir)
}

// `flutter emulators --launch <id>` **sale con código 0 aunque falle**: con un id
// que no existe imprime «No emulator found that matches …» y devuelve 0 igual.
// Si se mira solo el exit code, la app diría que lanzó algo que nunca arrancó.
// En el camino bueno no imprime nada y vuelve en ~1s, sin esperar el arranque.
function resultadoLanzarEmulador(salida) {
  const txt = String(salida || '').trim()
  if (/no emulator found that matches/i.test(txt)) return { ok: false, error: 'No se encontró ese emulador' }
  const fallo = txt.split('\n').find((l) => /^(error|exception)\b|error:|failed to|could not|unable to/i.test(l.trim()))
  if (fallo) return { ok: false, error: fallo.trim().slice(0, 200) }
  return { ok: true }
}

// Tabla de `flutter emulators`:
//   Id                    • Name                  • Manufacturer • Platform
//   apple_ios_simulator   • iOS Simulator         • Apple        • ios
// Se ignoran cabecera, líneas de ayuda y todo lo que no traiga 4 columnas.
function parseEmuladores(salida) {
  const out = []
  for (const linea of String(salida || '').split('\n')) {
    if (!linea.includes('•')) continue
    const cols = linea.split('•').map((c) => c.trim())
    if (cols.length < 4) continue
    const [id, name, manufacturer, platform] = cols
    if (!id || id.toLowerCase() === 'id') continue // la cabecera
    out.push({ id, name: name || id, manufacturer, platform: platform.toLowerCase() })
  }
  return out
}

// Un dispositivo enchufado vale más que un emulador, y un emulador más que
// escritorio o web: así se ordena la lista, porque el orden es la
// recomendación. En este squad además importa de verdad — la app de b2c no
// corre en simuladores de iOS (MLKit no trae slice arm64-sim), así que ofrecer
// el simulador primero sería ofrecer lo que no funciona.
const ORDEN = { fisico: 0, emulador: 1, escritorio: 2, web: 3 }

function tipoDeDispositivo(d) {
  const plat = String(d.targetPlatform || '')
  if (/^web/.test(plat)) return 'web'
  if (/^(darwin|windows|linux)/.test(plat)) return 'escritorio'
  return d.emulator ? 'emulador' : 'fisico'
}

// Normaliza y ordena lo que devuelve `flutter devices --machine`.
function ordenaDispositivos(devices) {
  return (Array.isArray(devices) ? devices : [])
    .map((d) => ({
      id: d.id,
      name: d.name || d.id,
      platform: d.targetPlatform || '',
      sdk: d.sdk || '',
      soportado: d.isSupported !== false,
      tipo: tipoDeDispositivo(d),
      hotReload: d.capabilities?.hotReload !== false,
    }))
    .sort((a, b) => ORDEN[a.tipo] - ORDEN[b.tipo] || a.name.localeCompare(b.name))
}

// ── Protocolo de `flutter run --machine` ─────────────────────────────────────
// El proceso habla el dominio `app` del daemon de Flutter por stdout/stdin, el
// mismo que usan los editores. Las líneas del protocolo vienen envueltas en un
// array —[{"event":"app.start","params":{…}}]— y TODO lo demás es log normal de
// la app, que también hay que mostrar.
function parseLineaDaemon(linea) {
  const txt = String(linea == null ? '' : linea)
  const t = txt.trim()
  if (!t) return null
  if (!(t.startsWith('[{') && t.endsWith('}]'))) return { tipo: 'log', texto: txt }
  let arr
  try {
    arr = JSON.parse(t)
  } catch {
    return { tipo: 'log', texto: txt }
  }
  const m = Array.isArray(arr) ? arr[0] : null
  if (!m || typeof m !== 'object') return { tipo: 'log', texto: txt }
  if (m.event) return { tipo: 'evento', evento: m.event, params: m.params || {} }
  if (m.id !== undefined) return { tipo: 'respuesta', id: m.id, result: m.result, error: m.error }
  return { tipo: 'log', texto: txt }
}

// Una petición al proceso: se escribe en su stdin, una línea por mensaje.
const mensajeDaemon = (id, method, params) => `${JSON.stringify([{ id, method, params }])}\n`

// Hot reload y hot restart son el MISMO método con un flag distinto.
const peticionRecarga = (id, appId, completa) =>
  mensajeDaemon(id, 'app.restart', { appId, fullRestart: !!completa, pause: false, reason: 'manual' })

// Cómo se corta lo que está corriendo. `app.stop` necesita el appId, y el appId
// solo llega con el evento app.start: si se cancela mientras todavía compila
// —justo el caso más útil, un build de iOS son minutos— no hay appId y toca
// matar el proceso. Un botón, dos rutas.
const comoCancelar = (appId) => (appId ? 'app.stop' : 'matar')

// Resultado de un app.restart (hot reload o hot restart). Medido contra el
// protocolo real: responde {"code":0,"message":""} y un código distinto de 0 es
// un fallo de verdad —típicamente un error de compilación en lo que se acaba de
// editar—, así que el mensaje tiene que llegar a la vista o el usuario se queda
// mirando una app que no cambió sin saber por qué.
function resultadoRecarga(result, error) {
  if (error) return { ok: false, error: String(error).slice(0, 300) }
  if (result && typeof result === 'object' && 'code' in result) {
    if (result.code === 0) return { ok: true }
    return { ok: false, error: String(result.message || `código ${result.code}`).slice(0, 300) }
  }
  // app.stop responde `true` pelado, sin objeto
  if (result === true || result === undefined || result === null) return { ok: true }
  return { ok: true }
}

// El progreso viene con ids que se solapan y se cierran por separado, así que se
// lleva un mapa y lo que se muestra es el último que siga abierto.
function aplicaProgreso(mapa, params) {
  const out = { ...mapa }
  const id = String(params?.id ?? '')
  if (!id) return out
  if (params.finished) delete out[id]
  else out[id] = { mensaje: params.message || '', tipo: params.progressId || null }
  return out
}
const progresoVisible = (mapa) => {
  const claves = Object.keys(mapa || {})
  return claves.length ? mapa[claves[claves.length - 1]] : null
}

// ── Emuladores ya arrancados ─────────────────────────────────────────────────
// No hay id común entre el emulador y el dispositivo que produce: lanzar
// `apple_ios_simulator` aparece como «iPhone 13 mini». Para saber cuál está
// arriba se pregunta a las herramientas de cada plataforma:
//   iOS     → xcrun simctl list devices booted
//   Android → adb devices  +  adb -s <id> emu avd name  (ese nombre SÍ coincide)

// Ids de emulador en la salida de `adb devices`. Un teléfono por USB sale con su
// serial (36c56d94) y no debe confundirse con un emulador (emulator-5554).
function idsEmuladorAdb(salida) {
  return String(salida || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^emulator-\d+\s+device\b/.test(l))
    .map((l) => l.split(/\s+/)[0])
}

// Marca cada emulador con si está corriendo y, en Android, con qué dispositivo
// pararlo. `estado` es { ios: bool, android: { avdName: deviceId } }.
function marcaEmuladoresCorriendo(emuladores, estado) {
  const ios = !!estado?.ios
  const android = estado?.android || {}
  return (Array.isArray(emuladores) ? emuladores : []).map((e) => {
    if (e.platform === 'ios') return { ...e, corriendo: ios, deviceId: null }
    const encontrado = Object.keys(android).find((avd) => avd === e.id || avd === e.name)
    return { ...e, corriendo: !!encontrado, deviceId: encontrado ? android[encontrado] : null }
  })
}

// ── ¿Hot reload, hot restart o recompilar? ───────────────────────────────────
// No todo cambio se ve con un hot reload, y equivocarse es peor que no recargar:
// el usuario mira una app que no cambió sin saber por qué.
//
//   · nativo o pubspec  → no hay recarga posible, toca volver a compilar
//   · estado global, jerarquías de clase, enums, main(), initState → hot restart,
//     porque el reload re-ejecuta build() pero NO los inicializadores globales
//     ni initState de un State que ya existe
//   · el resto (cuerpos de método, widgets)  → hot reload
//
// Se mira SOLO lo que cambió (las líneas +/- del diff): buscar «class» o «enum»
// en el archivo entero daría restart casi siempre, porque casi todo archivo Dart
// declara clases.
const RUTAS_RECOMPILAR =
  /(^|\/)pubspec\.yaml$|(^|\/)(ios|android|macos|windows|linux)\/|\.(gradle|kts|plist|pbxproj|podspec)$|(^|\/)Podfile/

// Lo que un hot reload NO puede aplicar.
const CAMBIOS_RESTART = [
  [/^\s*(?:void\s+)?main\s*\(/, 'cambió main()'],
  [/^\s*enum\s+\w/, 'cambió un enum'],
  [/^\s*(?:abstract\s+|sealed\s+|mixin\s+)?class\s+\w+[^{]*\b(?:extends|implements|with)\b/, 'cambió la jerarquía de una clase'],
  [/^\s*typedef\s+\w/, 'cambió un typedef'],
  [/^\s*static\s+\w/, 'cambió un valor static'],
  // Declaración a nivel de archivo (sin indentar): su inicializador no se
  // re-ejecuta en un reload — el caso típico es un provider de Riverpod.
  // Ojo: tiene que ser declaración, no expresión. Un `const SizedBox(...)`
  // indentado dentro del árbol de widgets sí se recarga sin problema.
  [/^(?:const|final|var|late\s+final)\s+\w+/, 'cambió una variable global'],
  [/\binitState\s*\(/, 'cambió initState'],
]

// Líneas añadidas o quitadas de un diff unificado, sin las cabeceras.
function lineasCambiadas(diff) {
  return String(diff || '')
    .split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l.slice(1))
}

function decideRecarga(rutas, diff) {
  const paths = Array.isArray(rutas) ? rutas.filter(Boolean) : []
  const nativa = paths.find((p) => RUTAS_RECOMPILAR.test(p))
  if (nativa) return { accion: 'recompilar', motivo: `tocó ${nativa.split('/').pop()}` }
  for (const linea of lineasCambiadas(diff)) {
    for (const [re, motivo] of CAMBIOS_RESTART) if (re.test(linea)) return { accion: 'restart', motivo }
  }
  // sin diff que mirar no se adivina: el reload es lo barato y lo reversible
  return { accion: 'reload', motivo: null }
}

// ── Configuraciones de lanzamiento (.vscode/launch.json) ─────────────────────
// El proyecto define cómo se lanza: flavor, dart-defines, entry point. Son las
// mismas que ofrece el editor, y sin ellas «correr» solo sirve para el flavor
// por defecto — en un proyecto con ci/dev/prod y mocks, eso es casi inútil.
//
// El archivo es JSON CON COMENTARIOS y suele traer comas finales, así que
// JSON.parse a secas revienta. Se limpia respetando las cadenas: quitar «//» a
// lo bruto rompería cualquier "https://…" dentro de un valor.
function limpiaJsonc(txt) {
  let out = ''
  let cadena = false
  let escape = false
  let linea = false
  let bloque = false
  const s = String(txt || '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const sig = s[i + 1]
    if (linea) {
      if (c === '\n') {
        linea = false
        out += c
      }
      continue
    }
    if (bloque) {
      if (c === '*' && sig === '/') {
        bloque = false
        i++
      }
      continue
    }
    if (cadena) {
      out += c
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') cadena = false
      continue
    }
    if (c === '"') {
      cadena = true
      out += c
      continue
    }
    if (c === '/' && sig === '/') {
      linea = true
      continue
    }
    if (c === '/' && sig === '*') {
      bloque = true
      i++
      continue
    }
    out += c
  }
  // comas finales, también respetando cadenas
  let limpio = ''
  cadena = false
  escape = false
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    if (cadena) {
      limpio += c
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') cadena = false
      continue
    }
    if (c === '"') {
      cadena = true
      limpio += c
      continue
    }
    if (c === ',') {
      const resto = out.slice(i + 1)
      const sigNoBlanco = resto.match(/^\s*(.)/)
      if (sigNoBlanco && (sigNoBlanco[1] === '}' || sigNoBlanco[1] === ']')) continue
    }
    limpio += c
  }
  return limpio
}

// Configuraciones de Flutter/Dart que se pueden lanzar.
function parseLaunchConfigs(txt) {
  let j
  try {
    j = JSON.parse(limpiaJsonc(txt))
  } catch {
    return []
  }
  const lista = Array.isArray(j?.configurations) ? j.configurations : []
  return lista
    .filter((c) => c && c.type === 'dart' && (c.request || 'launch') === 'launch')
    .map((c) => ({
      name: String(c.name || 'sin nombre'),
      program: c.program || null,
      modo: c.flutterMode || 'debug',
      args: Array.isArray(c.args) ? c.args.map(String) : [],
    }))
}

// Argumentos para `flutter run` a partir de una configuración. Sustituye las
// variables del editor que sí se pueden resolver aquí.
function argsDeLaunchConfig(config, { workspaceFolder } = {}) {
  if (!config) return []
  const sustituye = (v) =>
    String(v)
      .replace(/\$\{workspaceFolder\}/g, workspaceFolder || '')
      .replace(/\$\{workspaceRoot\}/g, workspaceFolder || '')
  const out = []
  if (config.program) out.push('-t', sustituye(config.program))
  if (config.modo === 'profile') out.push('--profile')
  else if (config.modo === 'release') out.push('--release')
  for (const a of config.args || []) out.push(sustituye(a))
  return out
}

// Qué pidió el usuario con «/correr …». El texto puede nombrar la configuración,
// el dispositivo, o los dos, en cualquier orden y sin acertar el nombre exacto:
// «/correr ci mock chile en el iphone».
const normaliza = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // el usuario escribe en español y los dispositivos se llaman en inglés
    .replace(/\bsimulador\b/g, 'simulator')
    .replace(/\bemulador\b/g, 'emulator')
    .replace(/\btelefono\b/g, 'phone')

const PALABRAS_VACIAS = new Set(['en', 'el', 'la', 'los', 'las', 'de', 'del', 'con', 'un', 'una', 'mi', 'app'])

const palabrasDe = (texto) =>
  normaliza(texto)
    .split(/[^a-z0-9.+]+/)
    .filter((p) => p.length > 1 && !PALABRAS_VACIAS.has(p))

// Puntúa por palabras encontradas, exigiendo límite de palabra: si no, «phone»
// de «medium phone» encaja dentro de «iPhone» y se elige el dispositivo
// equivocado.
function puntua(texto, nombre) {
  const nom = normaliza(nombre)
  let punt = 0
  for (const p of palabrasDe(texto)) {
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    if (re.test(nom)) punt += p.length
  }
  return punt
}

function eligePorTexto(texto, candidatos, nombreDe = (x) => x) {
  let mejor = null
  let mejorPunt = 0
  for (const c of candidatos || []) {
    const punt = puntua(texto, nombreDe(c))
    if (punt > mejorPunt) {
      mejorPunt = punt
      mejor = c
    }
  }
  return mejor ? { item: mejor, punt: mejorPunt } : null
}

// Palabras con las que se puede pedir un objetivo sin saber su nombre: «corre el
// emulador android», «el físico ios». Sin esto, «emulador android» empataba con
// un Android físico —los dos dicen «android»— y no se podía distinguir.
const PALABRAS_TIPO = {
  fisico: 'fisico physical real enchufado',
  emulador: 'emulador emulator virtual',
  escritorio: 'escritorio desktop',
  web: 'web navegador browser',
}

const textoDe = (nombre, plataforma, id, tipo) => {
  const ios = String(plataforma || '').startsWith('ios')
  const partes = [nombre, plataforma, id, PALABRAS_TIPO[tipo] || '']
  if (ios) partes.push('ios apple')
  // «simulador» es el término de Apple: aplicarlo a todo emulador hacía que
  // «el simulador» empatara con un AVD de Android
  if (ios && tipo === 'emulador') partes.push('simulador simulator')
  return partes.join(' ')
}

// Interpreta «/correr …» para poder lanzar sin abrir el panel. Dispositivos y
// emuladores compiten en la MISMA puntuación: «medium phone» tiene que ganarle a
// «iPhone», que solo coincide en una palabra.
//
// Un empate significa que la frase no alcanza para decidir, y adivinar cuesta una
// compilación de minutos. Con una excepción: si empatan un dispositivo ya
// disponible y un emulador por lanzar de la misma clase —«el emulador android»
// con ese emulador ya arriba— no hay duda de la intención, y gana el que ya está
// listo, que ahorra el arranque.
function interpretaCorrer(texto, { devices = [], emulators = [], configs = [] } = {}) {
  const t = String(texto || '').trim()
  const candidatos = [
    ...devices.map((x) => ({ tipo: 'dispositivo', item: x, txt: textoDe(x.name, x.platform, x.id, x.tipo) })),
    ...emulators.map((x) => ({ tipo: 'emulador', item: x, txt: textoDe(x.name, x.platform, x.id, 'emulador') })),
  ].map((c) => ({ ...c, punt: puntua(t, c.txt) }))
  const conPunto = candidatos.filter((c) => c.punt > 0).sort((a, b) => b.punt - a.punt)
  let empatados = conPunto.filter((c) => c.punt === conPunto[0]?.punt)
  // un dispositivo listo le gana a un emulador por arrancar
  if (empatados.length > 1) {
    const listos = empatados.filter((c) => c.tipo === 'dispositivo')
    if (listos.length === 1) empatados = listos
  }
  const ambiguo = empatados.length > 1
  const objetivo = ambiguo ? null : empatados[0] || null

  const cs = configs
    .map((x) => ({ item: x, punt: puntua(t, x.name) }))
    .filter((c) => c.punt > 0)
    .sort((a, b) => b.punt - a.punt)
  const configAmbigua = cs.filter((c) => c.punt === cs[0]?.punt).length > 1

  return {
    objetivo,
    config: configAmbigua ? null : cs[0]?.item || null,
    ambiguo,
    configAmbigua,
    // para poder mostrar entre qué dudaba en vez de un error seco
    candidatos: (ambiguo ? empatados : conPunto).map((c) => ({ tipo: c.tipo, id: c.item.id, name: c.item.name })),
  }
}

// Dos corridas de la misma plataforma no funcionan: comparten el directorio de
// build del proyecto y se pisan. iPhone + Android sí conviven, porque cada uno
// escribe en su subdirectorio. Devuelve el dispositivo que ya la ocupa, o null.
const familiaDe = (plataforma) => String(plataforma || '').split('-')[0]

function plataformaOcupada(corridas, plataforma) {
  const fam = familiaDe(plataforma)
  if (!fam) return null
  for (const c of Object.values(corridas || {})) {
    if (c && familiaDe(c.platform) === fam) return c
  }
  return null
}

// ── En qué plataformas corre el proyecto ─────────────────────────────────────
// Un proyecto Flutter solo corre donde tiene su carpeta de plataforma: sin
// `web/` no hay Chrome, sin `macos/` no hay escritorio. Ofrecer un objetivo que
// el proyecto no soporta es regalar una compilación fallida — comprobado con
// `flutter run -d chrome` en un proyecto solo android+ios: muere al arrancar.
const DIR_DE_PLATAFORMA = { ios: 'ios', android: 'android', darwin: 'macos', web: 'web', windows: 'windows', linux: 'linux' }

// A qué familia pertenece el targetPlatform que reporta flutter.
function familiaPlataforma(plataforma) {
  const p = String(plataforma || '')
  if (p.startsWith('web')) return 'web'
  if (p.startsWith('darwin')) return 'darwin'
  if (p.startsWith('android')) return 'android'
  if (p.startsWith('ios')) return 'ios'
  if (p.startsWith('windows')) return 'windows'
  if (p.startsWith('linux')) return 'linux'
  return p.split('-')[0] || null
}

// Familias soportadas, a partir de las carpetas que existen en el proyecto.
function plataformasDelProyecto(dirsExistentes) {
  const hay = new Set(dirsExistentes || [])
  return Object.entries(DIR_DE_PLATAFORMA)
    .filter(([, dir]) => hay.has(dir))
    .map(([familia]) => familia)
}

// Deja solo los objetivos donde el proyecto puede correr. Sin plataformas
// detectadas no se filtra: mejor mostrar todo que dejar la lista vacía por un
// proyecto con una estructura que no reconocemos.
function filtraPorPlataforma(items, soportadas, campo = 'platform') {
  const set = new Set(soportadas || [])
  if (!set.size) return Array.isArray(items) ? items : []
  return (Array.isArray(items) ? items : []).filter((x) => set.has(familiaPlataforma(x?.[campo])))
}

// El daemon de dispositivos manda menos campos que `flutter devices --machine` y
// con otro nombre: `platform` en vez de `targetPlatform`, y sin sdk ni
// capabilities. Se normaliza a la misma forma que usa la lista.
function dispositivoDeDaemon(params) {
  if (!params?.id) return null
  const d = {
    id: params.id,
    targetPlatform: params.platform || '',
    name: params.name || params.id,
    emulator: !!params.emulator,
    isSupported: params.isSupported !== false,
    // el daemon no dice si soporta hot reload; se asume que sí y la corrida lo
    // desmentirá si no, que es mejor que ocultar el objetivo
    capabilities: { hotReload: true },
  }
  return ordenaDispositivos([d])[0] || null
}

// ── Proyectos npm: web y escritorio ─────────────────────────────────────────
// Aquí el objetivo no es un dispositivo, es un SCRIPT: `npm run dev` levanta un
// servidor de Vite (web) o Electron (escritorio) según lo que declare el
// proyecto. No hay hot reload que pedir —Vite recarga solo al guardar— así que la
// barra se reduce a arrancar, reiniciar el servidor, detener y ver la salida.

// Scripts que arrancan algo y se quedan corriendo, frente a los que compilan y
// terminan. Se ordenan por lo probable, sin esconder el resto: `dist:mac` no es
// para «correr», pero tampoco hay por qué prohibirlo.
const SCRIPTS_QUE_CORREN = /^(dev|start|serve|preview|watch|electron|storybook)(:|$)/
const SCRIPTS_QUE_TERMINAN = /^(build|test|lint|format|dist|guia|typecheck|tsc|prepare|postinstall)(:|$)/

function scriptsDelProyecto(pkgJson) {
  let j
  try {
    j = typeof pkgJson === 'string' ? JSON.parse(pkgJson) : pkgJson
  } catch {
    return []
  }
  const scripts = j?.scripts
  if (!scripts || typeof scripts !== 'object') return []
  return Object.entries(scripts)
    .map(([name, cmd]) => ({
      name,
      cmd: String(cmd || ''),
      corre: SCRIPTS_QUE_CORREN.test(name) && !SCRIPTS_QUE_TERMINAN.test(name),
    }))
    .sort((a, b) => (a.corre === b.corre ? a.name.localeCompare(b.name) : a.corre ? -1 : 1))
}

// Con qué gestor invocarlo: lo dice el lockfile, no la preferencia de quien mira.
function gestorDePaquetes(archivos) {
  const hay = new Set(archivos || [])
  if (hay.has('pnpm-lock.yaml')) return 'pnpm'
  if (hay.has('yarn.lock')) return 'yarn'
  if (hay.has('bun.lockb') || hay.has('bun.lock')) return 'bun'
  return 'npm'
}

// `yarn <script>` y el resto con `run`.
const argsDeScript = (gestor, script) => (gestor === 'yarn' ? [script] : ['run', script])

// La URL donde quedó servido, para poder abrirla. Vite, Next y CRA la imprimen
// con formatos distintos, así que se busca cualquier localhost con puerto.
function urlDeSalida(texto) {
  const m = String(texto || '').match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?[^\s)'"]*/)
  return m ? m[0] : null
}

// «/correr dev» en un proyecto npm: se empareja contra los nombres de los
// scripts con el mismo criterio que los dispositivos —incluida la regla de no
// adivinar ante un empate—. Los que se quedan corriendo pesan más: pedir
// «correr» apunta a `dev`, no a `dev:vite` solo porque comparta prefijo.
function interpretaScript(texto, scripts) {
  const lista = Array.isArray(scripts) ? scripts : []
  const pedido = normaliza(String(texto || '')).trim()
  const con = lista
    .map((sc) => {
      const base = puntua(texto, sc.name)
      // el bonus solo cuenta si hubo coincidencia: si no, cualquier frase
      // emparejaba con todos los scripts que se quedan corriendo
      if (!base) return { item: sc, punt: 0 }
      // y el nombre exacto manda: «dev» es dev, no dev:vite por compartir prefijo
      const exacto = pedido === normaliza(sc.name) ? 10 : 0
      return { item: sc, punt: base + exacto + (sc.corre ? 0.5 : 0) }
    })
    .filter((c) => c.punt > 0)
    .sort((a, b) => b.punt - a.punt)
  const empatados = con.filter((c) => c.punt === con[0]?.punt)
  const ambiguo = empatados.length > 1
  return {
    objetivo: ambiguo ? null : empatados[0]?.item || null,
    ambiguo,
    candidatos: (ambiguo ? empatados : con).map((c) => ({ name: c.item.name })),
  }
}

// ── Targets de Makefile ─────────────────────────────────────────────────────
// Un Makefile auto-documentado (`target: ## descripción`) es una lista de
// comandos con nombre, igual que los scripts de npm. Se lee del archivo, sin
// ejecutar `make help`: preguntarle a make obligaría a evaluar el Makefile, que
// puede tener side effects.
//
// Convención de argumentos, tomada del proyecto real:
//   build-preprod-apk: ## … Uso: make build-preprod-apk [ENABLE_NETWORK_LOGGING=true]
//   generate-mod:      ## … Uso: make generate-mod MOD=auth
// Entre corchetes = opcional; suelto = obligatorio, y sin él el target falla.
function parseMakefile(archivos) {
  const out = []
  for (const { nombre, texto } of archivos || []) {
    const modulo = /^[Mm]akefile$/.test(nombre || '') ? 'general' : String(nombre || '').replace(/\.mk$/, '')
    for (const linea of String(texto || '').split('\n')) {
      // el nombre puede llevar prerrequisitos antes del ##; `:=` no es un target
      const m = linea.match(/^([a-zA-Z0-9_.%/-]+)\s*:[^=#]*?##\s*(.*)$/)
      if (!m) continue
      const [, name, descRaw] = m
      if (name.startsWith('.')) continue // .PHONY y compañía
      const uso = (descRaw.match(/Uso:\s*(.+)$/) || [])[1] || ''
      const opcionales = [...uso.matchAll(/\[\s*([A-Z][A-Z0-9_]*)\s*=/g)].map((x) => x[1])
      const todos = [...uso.matchAll(/([A-Z][A-Z0-9_]*)\s*=/g)].map((x) => x[1])
      out.push({
        name,
        modulo,
        desc: descRaw.replace(/\s*Uso:.*$/, '').trim(),
        args: todos.filter((a) => !opcionales.includes(a)),
        argsOpt: opcionales,
      })
    }
  }
  return out
}

// Agrupados por módulo, que es como ya los organiza el proyecto: 127 targets en
// una lista plana no se leen.
function agrupaTargets(targets) {
  const mapa = new Map()
  for (const t of targets || []) {
    if (!mapa.has(t.modulo)) mapa.set(t.modulo, [])
    mapa.get(t.modulo).push(t)
  }
  return [...mapa.entries()].map(([modulo, items]) => ({ modulo, items }))
}

// El PATH tal como lo imprime el shell de login del usuario. La mayoría lo dan
// separado por «:», pero en fish $PATH es una lista y sale separado por
// espacios: sin distinguirlo, un usuario de fish no ganaba nada.
//
// El shell puede escupir ruido de su propio arranque, así que vale la última
// línea que parezca un PATH.
function parsePathDeShell(salida) {
  const linea =
    String(salida || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('/'))
      .pop() || ''
  // con «:» manda «:», que además admite carpetas con espacios; sin él, fish
  const trozos = linea.includes(':') ? linea.split(':') : linea.split(/\s+/)
  return [...new Set(trozos.map((d) => d.trim()).filter((d) => d.startsWith('/')))]
}

module.exports = {
  sanitizeEnv,
  sessionKey,
  pickSafeMcp,
  parseUsage,
  gitignoreConSquad,
  buildClaudeArgs,
  agentesDeEquipo,
  EFFORTS,
  effortValido,
  subDeMensaje,
  esProyectoFlutter,
  buscaProyectosFlutter,
  parseEmuladores,
  idsEmuladorAdb,
  marcaEmuladoresCorriendo,
  resultadoLanzarEmulador,
  parseLineaDaemon,
  mensajeDaemon,
  peticionRecarga,
  comoCancelar,
  resultadoRecarga,
  aplicaProgreso,
  progresoVisible,
  decideRecarga,
  limpiaJsonc,
  parseLaunchConfigs,
  argsDeLaunchConfig,
  interpretaCorrer,
  plataformaOcupada,
  plataformasDelProyecto,
  filtraPorPlataforma,
  dispositivoDeDaemon,
  scriptsDelProyecto,
  gestorDePaquetes,
  argsDeScript,
  urlDeSalida,
  interpretaScript,
  parsePathDeShell,
  parseMakefile,
  agrupaTargets,
  familiaPlataforma,
  familiaDe,
  eligePorTexto,
  puntua,
  lineasCambiadas,
  ordenaDispositivos,
  tipoDeDispositivo,
}
