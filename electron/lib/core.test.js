import { describe, expect, it } from 'vitest'
import core from './core.js'

const { sanitizeEnv, sessionKey, pickSafeMcp, parseUsage, gitignoreConSquad, buildClaudeArgs } = core
const { clavesDeSesion, quitaProyecto, agregaProyecto, componeReglas } = core
const { esProyectoFlutter, buscaProyectosFlutter, parseEmuladores, ordenaDispositivos } = core
const { resultadoLanzarEmulador, idsEmuladorAdb, marcaEmuladoresCorriendo } = core
const { parseLineaDaemon, mensajeDaemon, peticionRecarga, comoCancelar } = core
const { resultadoRecarga, aplicaProgreso, progresoVisible } = core
const { decideRecarga } = core
const { parseLaunchConfigs, argsDeLaunchConfig, interpretaCorrer, plataformaOcupada } = core
const { plataformasDelProyecto, filtraPorPlataforma, familiaPlataforma, dispositivoDeDaemon } = core
const { scriptsDelProyecto, gestorDePaquetes, argsDeScript, urlDeSalida, interpretaScript } = core
const { parseMakefile, agrupaTargets, parsePathDeShell } = core

describe('sanitizeEnv', () => {
  // lo más caro que puede romperse en silencio: si la API key sobrevive,
  // Claude Code cobra por token en vez de usar la suscripción del usuario
  it('quita las credenciales de API del entorno', () => {
    const env = sanitizeEnv({ ANTHROPIC_API_KEY: 'sk-ant-xxx', ANTHROPIC_AUTH_TOKEN: 'tok', OTRA: 'se-queda' })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.OTRA).toBe('se-queda')
  })

  it('no muta el entorno que recibe', () => {
    const original = { ANTHROPIC_API_KEY: 'sk-ant-xxx' }
    sanitizeEnv(original)
    expect(original.ANTHROPIC_API_KEY).toBe('sk-ant-xxx') // process.env intacto
  })

  it('añade las rutas de binarios sin perder las del shell', () => {
    const { PATH } = sanitizeEnv({ PATH: '/usr/bin:/bin' }, { home: '/Users/x' })
    expect(PATH.split(':')).toEqual(['/usr/bin', '/bin', '/opt/homebrew/bin', '/usr/local/bin', '/Users/x/.local/bin'])
  })

  it('las rutas extra van delante, para que los shims tapen al sistema', () => {
    // el PATH del shell de login del usuario: rbenv o nvm deben ganarle a
    // /usr/bin, o el agente usa el ruby y el node del sistema
    const { PATH } = sanitizeEnv(
      { PATH: '/usr/bin:/bin' },
      { home: '/Users/x', extraPath: ['/Users/x/.rbenv/shims', '/Users/x/.nvm/versions/node/v22/bin'] }
    )
    expect(PATH.split(':').slice(0, 3)).toEqual(['/Users/x/.rbenv/shims', '/Users/x/.nvm/versions/node/v22/bin', '/usr/bin'])
  })

  it('extraPath tampoco duplica lo que ya estaba', () => {
    const { PATH } = sanitizeEnv({ PATH: '/usr/bin:/opt/homebrew/bin' }, { extraPath: ['/opt/homebrew/bin'] })
    expect(PATH.split(':').filter((p) => p === '/opt/homebrew/bin')).toHaveLength(1)
  })

  it('sin extraPath se comporta igual que antes', () => {
    expect(sanitizeEnv({ PATH: '/usr/bin' }, { home: '/Users/x' }).PATH).toBe(
      '/usr/bin:/opt/homebrew/bin:/usr/local/bin:/Users/x/.local/bin'
    )
  })

  it('no duplica rutas que ya venían en el PATH', () => {
    const { PATH } = sanitizeEnv({ PATH: '/opt/homebrew/bin:/usr/bin' }, { home: '/Users/x' })
    expect(PATH.split(':').filter((p) => p === '/opt/homebrew/bin')).toHaveLength(1)
  })

  it('tolera un PATH vacío o ausente', () => {
    expect(sanitizeEnv({}).PATH).toBe('/opt/homebrew/bin:/usr/local/bin')
    expect(sanitizeEnv({ PATH: '' }).PATH).toBe('/opt/homebrew/bin:/usr/local/bin')
  })

  it('con perfil fija CLAUDE_CONFIG_DIR; sin perfil lo borra', () => {
    expect(sanitizeEnv({}, { profileDir: '/home/.claude-work' }).CLAUDE_CONFIG_DIR).toBe('/home/.claude-work')
    // heredarlo del shell mezclaría las cuentas work y private
    expect(sanitizeEnv({ CLAUDE_CONFIG_DIR: '/heredado' }, {}).CLAUDE_CONFIG_DIR).toBeUndefined()
  })
})

describe('sessionKey', () => {
  it('separa por rol, cuenta y proyecto', () => {
    expect(sessionKey('dev', 'work', '/repos/a')).toBe('dev::work::/repos/a')
  })

  it('dos agentes o dos proyectos nunca comparten clave', () => {
    const claves = new Set([
      sessionKey('dev', 'work', '/repos/a'),
      sessionKey('qa', 'work', '/repos/a'), // otro rol
      sessionKey('dev', 'private', '/repos/a'), // otra cuenta
      sessionKey('dev', 'work', '/repos/b'), // otro proyecto
    ])
    expect(claves.size).toBe(4)
  })
})

describe('pickSafeMcp', () => {
  it('deja fuera los servidores con credenciales y los reporta', () => {
    const { safe, skipped } = pickSafeMcp({
      playwright: { command: 'npx' },
      jira: { url: 'https://…', headers: { Authorization: 'Bearer secreto' } },
      banana: { command: 'npx', env: { GEMINI_API_KEY: 'clave' } },
    })
    expect(Object.keys(safe)).toEqual(['playwright'])
    expect(skipped).toEqual(['jira', 'banana'])
    // el secreto no puede aparecer por ningún lado en lo exportado
    expect(JSON.stringify(safe)).not.toContain('secreto')
    expect(JSON.stringify(safe)).not.toContain('clave')
  })

  it('headers o env vacíos no cuentan como credenciales', () => {
    const { safe, skipped } = pickSafeMcp({ x: { command: 'npx', headers: {}, env: {} } })
    expect(Object.keys(safe)).toEqual(['x'])
    expect(skipped).toEqual([])
  })

  it('tolera que no haya servidores', () => {
    expect(pickSafeMcp(undefined)).toEqual({ safe: {}, skipped: [] })
  })
})

describe('parseUsage', () => {
  it('lee la cuota de una respuesta buena', () => {
    const body = JSON.stringify({
      five_hour: { utilization: 42, resets_at: '2026-01-01T10:00:00Z' },
      seven_day: { utilization: 8, resets_at: '2026-01-05T10:00:00Z' },
    })
    expect(parseUsage(200, {}, body)).toEqual({
      session: { pct: 42, resetsAt: '2026-01-01T10:00:00Z' },
      weekly: { pct: 8, resetsAt: '2026-01-05T10:00:00Z' },
    })
  })

  it('el 429 respeta retry-after y lo tope a una hora', () => {
    expect(parseUsage(429, { 'retry-after': '3580' }, '')).toEqual({ rateLimited: true, retryAfter: 3580 })
    expect(parseUsage(429, { 'retry-after': '99999' }, '')).toEqual({ rateLimited: true, retryAfter: 3600 })
    expect(parseUsage(429, {}, '')).toEqual({ rateLimited: true, retryAfter: 900 }) // sin cabecera
  })

  it('un error de la API devuelve null, no datos vacíos', () => {
    // devolver {session:null,weekly:null} pisaba el último dato bueno y el
    // monitor "desaparecía" — por eso tiene que ser null y no un objeto
    expect(parseUsage(401, {}, '{"error":"expired"}')).toBeNull()
    expect(parseUsage(500, {}, 'boom')).toBeNull()
  })

  it('un 200 con JSON roto o sin cuotas también es null', () => {
    expect(parseUsage(200, {}, 'no-es-json')).toBeNull()
    expect(parseUsage(200, {}, '{}')).toBeNull()
  })

  it('acepta que falte una de las dos ventanas', () => {
    const r = parseUsage(200, {}, JSON.stringify({ five_hour: { utilization: 10, resets_at: 'x' } }))
    expect(r.session).toEqual({ pct: 10, resetsAt: 'x' })
    expect(r.weekly).toBeNull()
  })

  it('una utilización ausente cuenta como 0, no como undefined', () => {
    const r = parseUsage(200, {}, JSON.stringify({ five_hour: { resets_at: 'x' } }))
    expect(r.session.pct).toBe(0)
  })
})

describe('gitignoreConSquad', () => {
  it('añade SQUAD.md a un .gitignore que no lo tiene', () => {
    expect(gitignoreConSquad('node_modules\ndist\n')).toBe('node_modules\ndist\nSQUAD.md\n')
  })

  it('mete el salto de línea que falta antes de añadir', () => {
    expect(gitignoreConSquad('dist')).toBe('dist\nSQUAD.md\n')
  })

  it('sirve para un .gitignore inexistente o vacío', () => {
    expect(gitignoreConSquad('')).toBe('SQUAD.md\n')
    expect(gitignoreConSquad(undefined)).toBe('SQUAD.md\n')
  })

  it('devuelve null si ya estaba — para no reescribir el archivo', () => {
    expect(gitignoreConSquad('dist\nSQUAD.md\n')).toBeNull()
    expect(gitignoreConSquad('dist\n  SQUAD.md  \n')).toBeNull() // con espacios
  })

  it('no confunde una ruta que solo contiene el nombre', () => {
    expect(gitignoreConSquad('docs/SQUAD.md\n')).toBe('docs/SQUAD.md\nSQUAD.md\n')
  })
})

describe('buildClaudeArgs', () => {
  const base = { prompt: 'hola', allowed: 'Read,Grep', persona: 'Eres Nami' }

  it('siempre pide el stream en JSON con parciales', () => {
    const args = buildClaudeArgs(base)
    expect(args).toContain('--output-format')
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json')
    expect(args).toContain('--include-partial-messages')
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('Eres Nami')
  })

  it('en modo lectura no aparece ningún permiso de escritura', () => {
    expect(buildClaudeArgs(base)).not.toContain('--permission-mode')
  })

  it('el modo edición auto-acepta, y el Revisor PR va en bypass', () => {
    const edicion = buildClaudeArgs({ ...base, writeMode: true })
    expect(edicion[edicion.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
    const pr = buildClaudeArgs({ ...base, writeMode: true, isPR: true })
    expect(pr[pr.indexOf('--permission-mode') + 1]).toBe('bypassPermissions')
  })

  it('isPR sin modo edición no concede bypass', () => {
    expect(buildClaudeArgs({ ...base, isPR: true })).not.toContain('bypassPermissions')
  })

  it('retoma la sesión y fija el modelo solo si se los dan', () => {
    expect(buildClaudeArgs(base)).not.toContain('--resume')
    expect(buildClaudeArgs(base)).not.toContain('--model')
    const args = buildClaudeArgs({ ...base, model: 'claude-opus-5', sid: 'abc-123' })
    expect(args[args.indexOf('--resume') + 1]).toBe('abc-123')
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5')
  })
})

// ── Objetivos de Flutter ─────────────────────────────────────────────────────
describe('esProyectoFlutter', () => {
  it('reconoce un pubspec que depende del SDK de Flutter', () => {
    expect(esProyectoFlutter('name: app\ndependencies:\n  flutter:\n    sdk: flutter\n')).toBe(true)
  })

  it('no confunde un paquete Dart puro', () => {
    expect(esProyectoFlutter('name: cli\ndependencies:\n  args: ^2.0.0\n')).toBe(false)
  })

  it('tolera que no haya pubspec', () => {
    expect(esProyectoFlutter('')).toBe(false)
    expect(esProyectoFlutter(null)).toBe(false)
  })
})

describe('parseEmuladores', () => {
  // `flutter emulators` no admite --machine: solo esta tabla
  const SALIDA = `
3 available emulators:

Id                    • Name                  • Manufacturer • Platform

apple_ios_simulator   • iOS Simulator         • Apple        • ios
Medium_Phone_API_36.1 • Medium Phone API 36.1 • Generic       • android
Small_Phone           • Small Phone           • Generic       • android

To run an emulator, run 'flutter emulators --launch <emulator id>'.
`

  it('saca los emuladores y descarta cabecera y ayuda', () => {
    const em = parseEmuladores(SALIDA)
    expect(em.map((e) => e.id)).toEqual(['apple_ios_simulator', 'Medium_Phone_API_36.1', 'Small_Phone'])
    expect(em[0]).toMatchObject({ name: 'iOS Simulator', manufacturer: 'Apple', platform: 'ios' })
    expect(em[2].platform).toBe('android')
  })

  it('devuelve lista vacía si no hay emuladores o la salida no sirve', () => {
    expect(parseEmuladores('No emulators available.')).toEqual([])
    expect(parseEmuladores('')).toEqual([])
    expect(parseEmuladores(null)).toEqual([])
  })
})

describe('ordenaDispositivos', () => {
  // lo que devuelve de verdad `flutter devices --machine` en un Mac con un
  // iPhone enchufado, más un emulador de Android arrancado
  const DEVICES = [
    { id: 'chrome', name: 'Chrome', targetPlatform: 'web-javascript', emulator: false, isSupported: true },
    { id: 'macos', name: 'macOS', targetPlatform: 'darwin', emulator: false, isSupported: true },
    { id: 'emulator-5554', name: 'sdk gphone64', targetPlatform: 'android-arm64', emulator: true, isSupported: true },
    { id: '00008030-000C', name: 'iPhone', targetPlatform: 'ios', emulator: false, isSupported: true, sdk: 'iOS 26.5.2' },
  ]

  it('el móvil enchufado va primero, y web al final', () => {
    expect(ordenaDispositivos(DEVICES).map((d) => d.tipo)).toEqual(['fisico', 'emulador', 'escritorio', 'web'])
    expect(ordenaDispositivos(DEVICES)[0].name).toBe('iPhone')
  })

  it('clasifica y normaliza cada dispositivo', () => {
    const [iphone] = ordenaDispositivos(DEVICES)
    expect(iphone).toMatchObject({ id: '00008030-000C', platform: 'ios', sdk: 'iOS 26.5.2', tipo: 'fisico', soportado: true })
  })

  it('tolera entradas ausentes o vacías', () => {
    expect(ordenaDispositivos(null)).toEqual([])
    expect(ordenaDispositivos([])).toEqual([])
  })
})

describe('buscaProyectosFlutter', () => {
  const FLUT = 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n'

  it('encuentra el proyecto un nivel abajo cuando la raíz no es Flutter', () => {
    // el caso real: el proyecto apunta al workspace y la app está dentro
    expect(
      buscaProyectosFlutter([
        { dir: '/w', pubspec: null },
        { dir: '/w/ai-context', pubspec: null },
        { dir: '/w/front-mobile-b2c', pubspec: FLUT },
      ])
    ).toEqual(['/w/front-mobile-b2c'])
  })

  it('la raíz manda si ella misma es Flutter', () => {
    expect(buscaProyectosFlutter([{ dir: '/app', pubspec: FLUT }])[0]).toBe('/app')
  })

  it('devuelve todos si hay varios, en orden', () => {
    expect(
      buscaProyectosFlutter([
        { dir: '/w', pubspec: null },
        { dir: '/w/a', pubspec: FLUT },
        { dir: '/w/b', pubspec: FLUT },
      ])
    ).toEqual(['/w/a', '/w/b'])
  })

  it('sin ninguno devuelve lista vacía', () => {
    expect(buscaProyectosFlutter([{ dir: '/w', pubspec: 'name: x\n' }])).toEqual([])
    expect(buscaProyectosFlutter(null)).toEqual([])
  })
})

describe('resultadoLanzarEmulador', () => {
  // el comando sale con 0 aunque falle: si se mira el exit code, la app diría
  // que lanzó un emulador que nunca arrancó (medido contra flutter 3.44.6)
  it('un id que no existe es un fallo, aunque el comando devuelva 0', () => {
    expect(resultadoLanzarEmulador("No emulator found that matches 'no_existe'.")).toEqual({
      ok: false,
      error: 'No se encontró ese emulador',
    })
  })

  it('el camino bueno no imprime nada', () => {
    expect(resultadoLanzarEmulador('')).toEqual({ ok: true })
    expect(resultadoLanzarEmulador('   \n ')).toEqual({ ok: true })
  })

  it('reporta el primer error que traiga la salida', () => {
    expect(resultadoLanzarEmulador('Error: no space left on device').ok).toBe(false)
    expect(resultadoLanzarEmulador('algo\nUnable to boot the simulator').error).toMatch(/Unable to boot/)
  })

  it('no confunde texto informativo con un error', () => {
    expect(resultadoLanzarEmulador('Starting emulator...').ok).toBe(true)
  })
})

// ── Protocolo de `flutter run --machine` ─────────────────────────────────────
// Las líneas de estos tests están CAPTURADAS de una corrida real (flutter
// 3.44.6, objetivo Chrome): arranque, hot reload, hot restart y stop.
describe('parseLineaDaemon', () => {
  it('lee un evento con sus params', () => {
    const r = parseLineaDaemon(
      '[{"event":"app.start","params":{"appId":"7b3a6356","deviceId":"chrome","directory":"/tmp/demo"}}]'
    )
    expect(r).toMatchObject({ tipo: 'evento', evento: 'app.start' })
    expect(r.params.appId).toBe('7b3a6356')
  })

  it('lee la respuesta de un hot reload', () => {
    expect(parseLineaDaemon('[{"id":1,"result":{"code":0,"message":""}}]')).toEqual({
      tipo: 'respuesta',
      id: 1,
      result: { code: 0, message: '' },
      error: undefined,
    })
  })

  it('app.stop responde un booleano pelado', () => {
    expect(parseLineaDaemon('[{"id":3,"result":true}]')).toMatchObject({ tipo: 'respuesta', id: 3, result: true })
  })

  it('los logs de la app pasan como log, no se tiran', () => {
    // se intercalan con el protocolo y son lo que el usuario quiere leer
    expect(parseLineaDaemon('Launching lib/main.dart on Chrome in debug mode...')).toEqual({
      tipo: 'log',
      texto: 'Launching lib/main.dart on Chrome in debug mode...',
    })
    expect(parseLineaDaemon('Recompile complete. No client connected.').tipo).toBe('log')
  })

  it('un array que no parsea no revienta: cae a log', () => {
    expect(parseLineaDaemon('[{roto').tipo).toBe('log')
    expect(parseLineaDaemon('[{"sin":"evento ni id"}]').tipo).toBe('log')
  })

  it('las líneas vacías se ignoran', () => {
    expect(parseLineaDaemon('')).toBeNull()
    expect(parseLineaDaemon('   ')).toBeNull()
    expect(parseLineaDaemon(null)).toBeNull()
  })
})

describe('mensajeDaemon y peticionRecarga', () => {
  it('hot reload y hot restart son el mismo método con un flag', () => {
    expect(JSON.parse(peticionRecarga(1, 'abc', false))[0]).toEqual({
      id: 1,
      method: 'app.restart',
      params: { appId: 'abc', fullRestart: false, pause: false, reason: 'manual' },
    })
    expect(JSON.parse(peticionRecarga(2, 'abc', true))[0].params.fullRestart).toBe(true)
  })

  it('cada mensaje va en su propia línea', () => {
    expect(mensajeDaemon(9, 'app.stop', { appId: 'x' }).endsWith('\n')).toBe(true)
  })
})

describe('comoCancelar', () => {
  it('con appId se pide app.stop; sin appId hay que matar el proceso', () => {
    // el appId solo llega con app.start: cancelar mientras compila —el caso más
    // útil, un build de iOS son minutos— no tiene appId todavía
    expect(comoCancelar('7b3a6356')).toBe('app.stop')
    expect(comoCancelar(null)).toBe('matar')
    expect(comoCancelar(undefined)).toBe('matar')
  })
})

describe('resultadoRecarga', () => {
  it('code 0 es éxito', () => {
    expect(resultadoRecarga({ code: 0, message: '' })).toEqual({ ok: true })
  })

  it('un código distinto de 0 es fallo y el mensaje llega entero', () => {
    // el caso real: el agente dejó un error de compilación y el reload falla
    const r = resultadoRecarga({ code: 1, message: "lib/main.dart:12:3: Error: Expected ';'" })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Expected/)
  })

  it('el booleano de app.stop cuenta como éxito', () => {
    expect(resultadoRecarga(true)).toEqual({ ok: true })
  })

  it('un error del protocolo se propaga', () => {
    expect(resultadoRecarga(null, "app 'x' not found").ok).toBe(false)
  })
})

describe('aplicaProgreso', () => {
  // en la corrida real los ids se solapan: hot.reload (id 1) sigue abierto
  // mientras se abre y cierra otro (id 2)
  it('sigue varios progresos a la vez y muestra el último abierto', () => {
    let m = {}
    m = aplicaProgreso(m, { id: '1', progressId: 'hot.reload', message: 'Performing hot reload...' })
    m = aplicaProgreso(m, { id: '2', progressId: null, message: 'Waiting for connection...' })
    expect(progresoVisible(m).mensaje).toBe('Waiting for connection...')
    m = aplicaProgreso(m, { id: '2', progressId: null, finished: true })
    expect(progresoVisible(m).tipo).toBe('hot.reload')
    m = aplicaProgreso(m, { id: '1', progressId: 'hot.reload', finished: true })
    expect(progresoVisible(m)).toBeNull()
  })

  it('ignora un progreso sin id y no muta el mapa que recibe', () => {
    const antes = { 1: { mensaje: 'x', tipo: null } }
    expect(aplicaProgreso(antes, {})).toEqual(antes)
    aplicaProgreso(antes, { id: '1', finished: true })
    expect(antes['1']).toBeDefined()
  })
})

describe('idsEmuladorAdb', () => {
  // salida real: 36c56d94 es un teléfono por USB, no un emulador
  const SALIDA = `List of devices attached
36c56d94	device usb:0-1.3 product:peridot_global model:24069PC21G
emulator-5554	device
emulator-5556	offline
`
  it('saca solo los emuladores conectados', () => {
    expect(idsEmuladorAdb(SALIDA)).toEqual(['emulator-5554'])
  })

  it('no confunde un teléfono físico con un emulador', () => {
    expect(idsEmuladorAdb('36c56d94\tdevice')).toEqual([])
  })

  it('tolera salida vacía', () => {
    expect(idsEmuladorAdb('')).toEqual([])
    expect(idsEmuladorAdb(null)).toEqual([])
  })
})

describe('marcaEmuladoresCorriendo', () => {
  const EMUS = [
    { id: 'apple_ios_simulator', name: 'iOS Simulator', platform: 'ios' },
    { id: 'Medium_Phone_API_36.1', name: 'Medium Phone API 36.1', platform: 'android' },
    { id: 'Small_Phone', name: 'Small Phone', platform: 'android' },
  ]

  it('marca el simulador de iOS si hay alguno booteado', () => {
    const [ios] = marcaEmuladoresCorriendo(EMUS, { ios: true, android: {} })
    expect(ios.corriendo).toBe(true)
  })

  it('en Android distingue CUÁL avd está arriba y con qué pararlo', () => {
    const r = marcaEmuladoresCorriendo(EMUS, { ios: false, android: { Small_Phone: 'emulator-5554' } })
    expect(r[1]).toMatchObject({ id: 'Medium_Phone_API_36.1', corriendo: false, deviceId: null })
    expect(r[2]).toMatchObject({ id: 'Small_Phone', corriendo: true, deviceId: 'emulator-5554' })
  })

  it('sin nada corriendo no marca ninguno', () => {
    expect(marcaEmuladoresCorriendo(EMUS, { ios: false, android: {} }).some((e) => e.corriendo)).toBe(false)
    expect(marcaEmuladoresCorriendo(EMUS, null).some((e) => e.corriendo)).toBe(false)
  })

  it('tolera lista vacía', () => {
    expect(marcaEmuladoresCorriendo(null, { ios: true })).toEqual([])
  })
})

// ── Hot reload vs hot restart vs recompilar ──────────────────────────────────
describe('decideRecarga', () => {
  const diff = (...lineas) => ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', ...lineas].join('\n')

  it('un cambio normal de widget se ve con hot reload', () => {
    expect(decideRecarga(['lib/home.dart'], diff('-      child: Text("a"),', '+      child: Text("b"),'))).toEqual({
      accion: 'reload',
      motivo: null,
    })
  })

  it('nativo o pubspec no se recargan: hay que recompilar', () => {
    expect(decideRecarga(['pubspec.yaml'], diff('+  nueva_dep: ^1.0.0')).accion).toBe('recompilar')
    expect(decideRecarga(['ios/Runner/Info.plist'], '').accion).toBe('recompilar')
    expect(decideRecarga(['android/app/build.gradle'], '').accion).toBe('recompilar')
    expect(decideRecarga(['lib/a.dart', 'ios/Podfile'], diff('+  algo')).accion).toBe('recompilar')
  })

  it('lo que el reload no puede aplicar pide hot restart', () => {
    // el reload re-ejecuta build(), pero no los inicializadores globales
    expect(decideRecarga(['lib/main.dart'], diff('+void main() {')).motivo).toMatch(/main/)
    expect(decideRecarga(['lib/e.dart'], diff('+enum Estado { a, b }')).motivo).toMatch(/enum/)
    expect(decideRecarga(['lib/a.dart'], diff('+class Casa extends Widget {')).motivo).toMatch(/jerarquía/)
    expect(decideRecarga(['lib/a.dart'], diff('+  static const alto = 12;')).motivo).toMatch(/static/)
    expect(decideRecarga(['lib/a.dart'], diff('+  void initState() {')).motivo).toMatch(/initState/)
  })

  it('un provider global cambiado pide restart, no reload', () => {
    // caso típico en Riverpod: el inicializador no se re-ejecuta
    const r = decideRecarga(['lib/stocks_provider.dart'], diff('-final stocksProvider = Provider((ref) => 1);', '+final stocksProvider = Provider((ref) => 2);'))
    expect(r.accion).toBe('restart')
    expect(r.motivo).toMatch(/global/)
  })

  it('no confunde una variable local con una global', () => {
    // indentada = dentro de un método: el reload la aplica sin problema
    expect(decideRecarga(['lib/a.dart'], diff('+    final total = 3;')).accion).toBe('reload')
  })

  it('mira solo lo cambiado, no el archivo entero', () => {
    // la cabecera del diff nombra clases y no debe disparar restart
    expect(decideRecarga(['lib/a.dart'], diff('+      const SizedBox(height: 8),')).accion).toBe('reload')
  })

  it('sin diff cae a reload, que es lo barato y reversible', () => {
    expect(decideRecarga(['lib/a.dart'], '').accion).toBe('reload')
    expect(decideRecarga([], null).accion).toBe('reload')
  })
})

// ── Configuraciones de lanzamiento ───────────────────────────────────────────
// El fragmento es literal del launch.json de front-mobile-b2c: trae comentarios
// «//» en medio de un array y ${workspaceFolder}, que es lo que rompe un
// JSON.parse a secas.
describe('parseLaunchConfigs', () => {
  const REAL = `{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Global66 (ci)",
      "request": "launch",
      "type": "dart",
      "program": "lib/main.dart",
      "flutterMode": "debug",
      "args": [
        "--flavor",
        "ci",
        "--dart-define-from-file=config/ci.json",
        "--dart-define",
        "ENABLE_RIVERPOD_DEVTOOLS=true"
        // "--dart-define",
        // "ENABLE_NETWORK_LOGGING=true"
      ]
    },
    {
      "name": "Global66 (ci + Debug Dashboard)",
      "request": "launch",
      "type": "dart",
      "program": "lib/main.dart",
      "flutterMode": "debug",
      "args": [
        "--flavor",
        "ci",
        // Repo root para la tab Docs.
        "--dart-define",
        "PROJECT_ROOT=\${workspaceFolder}"
      ]
    },
    { "name": "un test", "request": "launch", "type": "node", "program": "x.js" }
  ]
}`

  it('lee las configuraciones aunque el archivo tenga comentarios', () => {
    const cs = parseLaunchConfigs(REAL)
    expect(cs.map((c) => c.name)).toEqual(['Global66 (ci)', 'Global66 (ci + Debug Dashboard)'])
  })

  it('deja fuera lo que no es Flutter/Dart', () => {
    expect(parseLaunchConfigs(REAL).some((c) => c.name === 'un test')).toBe(false)
  })

  it('los args comentados no se cuelan', () => {
    const [ci] = parseLaunchConfigs(REAL)
    expect(ci.args).toEqual([
      '--flavor',
      'ci',
      '--dart-define-from-file=config/ci.json',
      '--dart-define',
      'ENABLE_RIVERPOD_DEVTOOLS=true',
    ])
    expect(ci.args.join(' ')).not.toMatch(/NETWORK_LOGGING/)
  })

  it('un archivo roto o ausente no revienta', () => {
    expect(parseLaunchConfigs('{roto')).toEqual([])
    expect(parseLaunchConfigs('')).toEqual([])
    expect(parseLaunchConfigs(null)).toEqual([])
  })

  it('no destroza una URL dentro de una cadena', () => {
    // quitar «//» a lo bruto rompería esto
    const cs = parseLaunchConfigs(
      '{"configurations":[{"name":"x","type":"dart","args":["--dart-define","API=https://api.global66.com"]}]}'
    )
    expect(cs[0].args[1]).toBe('API=https://api.global66.com')
  })

  it('tolera comas finales', () => {
    const cs = parseLaunchConfigs('{"configurations":[{"name":"x","type":"dart","args":["a",],},],}')
    expect(cs[0].name).toBe('x')
    expect(cs[0].args).toEqual(['a'])
  })
})

describe('argsDeLaunchConfig', () => {
  it('arma los argumentos de flutter run con el entry point y el flavor', () => {
    const [ci] = parseLaunchConfigs(
      '{"configurations":[{"name":"ci","type":"dart","program":"lib/main.dart","flutterMode":"debug","args":["--flavor","ci"]}]}'
    )
    expect(argsDeLaunchConfig(ci, { workspaceFolder: '/w/app' })).toEqual(['-t', 'lib/main.dart', '--flavor', 'ci'])
  })

  it('sustituye ${workspaceFolder}', () => {
    const [c] = parseLaunchConfigs(
      '{"configurations":[{"name":"x","type":"dart","args":["--dart-define","PROJECT_ROOT=${workspaceFolder}"]}]}'
    )
    expect(argsDeLaunchConfig(c, { workspaceFolder: '/w/app' })).toEqual([
      '--dart-define',
      'PROJECT_ROOT=/w/app',
    ])
  })

  it('profile y release añaden su flag; debug no', () => {
    const arma = (modo) =>
      argsDeLaunchConfig({ name: 'x', program: null, modo, args: [] }, {})
    expect(arma('profile')).toEqual(['--profile'])
    expect(arma('release')).toEqual(['--release'])
    expect(arma('debug')).toEqual([])
  })

  it('sin configuración no aporta argumentos', () => {
    expect(argsDeLaunchConfig(null, {})).toEqual([])
  })
})

describe('interpretaCorrer', () => {
  const CTX = {
    devices: [
      { id: '00008030-000C', name: 'iPhone', platform: 'ios' },
      { id: 'macos', name: 'macOS', platform: 'darwin' },
    ],
    emulators: [
      { id: 'apple_ios_simulator', name: 'iOS Simulator', platform: 'ios' },
      { id: 'Medium_Phone_API_36.1', name: 'Medium Phone API 36.1', platform: 'android' },
    ],
    configs: [
      { name: 'Global66 (ci + mock PayIn Chile)' },
      { name: 'Global66 (prod)' },
      { name: 'Global66 (ci + Device Preview)' },
    ],
  }

  it('saca configuración y dispositivo de una frase suelta', () => {
    const r = interpretaCorrer('ci mock chile en el iphone', CTX)
    expect(r.config.name).toBe('Global66 (ci + mock PayIn Chile)')
    expect(r.objetivo).toMatchObject({ tipo: 'dispositivo' })
    expect(r.objetivo.item.name).toBe('iPhone')
  })

  it('«medium phone» no se confunde con «iPhone»', () => {
    // sin límite de palabra, «phone» encaja dentro de «iPhone» y elegía mal
    const r = interpretaCorrer('en medium phone', CTX)
    expect(r.objetivo.tipo).toBe('emulador')
    expect(r.objetivo.item.id).toBe('Medium_Phone_API_36.1')
  })

  it('entiende «simulador» aunque el dispositivo se llame «Simulator»', () => {
    expect(interpretaCorrer('en el simulador', CTX).objetivo.item.name).toBe('iOS Simulator')
  })

  it('solo la configuración, sin dispositivo, es válido', () => {
    const r = interpretaCorrer('prod', CTX)
    expect(r.config.name).toBe('Global66 (prod)')
    expect(r.objetivo).toBeNull()
  })

  it('las palabras de relleno no eligen nada', () => {
    for (const frase of ['en el de la app', '']) {
      const r = interpretaCorrer(frase, CTX)
      expect(r.objetivo).toBeNull()
      expect(r.config).toBeNull()
      expect(r.ambiguo).toBe(false)
    }
  })

  it('sin candidatos no revienta', () => {
    const r = interpretaCorrer('iphone', {})
    expect(r.objetivo).toBeNull()
    expect(r.candidatos).toEqual([])
  })
})

describe('interpretaCorrer: ambigüedad', () => {
  const CTX = {
    devices: [
      { id: 'a', name: 'iPhone', platform: 'ios' },
      { id: 'b', name: 'iPhone 15', platform: 'ios' },
    ],
    emulators: [
      { id: 'Small_Phone', name: 'Small Phone', platform: 'android' },
      { id: 'Medium_Phone_API_36.1', name: 'Medium Phone API 36.1', platform: 'android' },
    ],
    configs: [{ name: 'Global66 (ci)' }, { name: 'Global66 (prod)' }],
  }

  it('con dos candidatos igual de buenos no elige: avisa y lista entre cuáles dudaba', () => {
    // adivinar cuesta una compilación de minutos
    const r = interpretaCorrer('iphone', CTX)
    expect(r.ambiguo).toBe(true)
    expect(r.objetivo).toBeNull()
    expect(r.candidatos.map((c) => c.name)).toEqual(['iPhone', 'iPhone 15'])
  })

  it('«phone» empata entre los dos emuladores', () => {
    const r = interpretaCorrer('phone', CTX)
    expect(r.ambiguo).toBe(true)
    expect(r.candidatos).toHaveLength(2)
  })

  it('una palabra que desempata sí resuelve', () => {
    const r = interpretaCorrer('small phone', CTX)
    expect(r.ambiguo).toBe(false)
    expect(r.objetivo.item.id).toBe('Small_Phone')
  })

  it('una configuración ambigua tampoco se asume', () => {
    const r = interpretaCorrer('global66', CTX)
    expect(r.configAmbigua).toBe(true)
    expect(r.config).toBeNull()
  })
})

describe('plataformaOcupada', () => {
  // dos corridas de la misma plataforma comparten el directorio de build del
  // proyecto y se pisan; cruzadas (iOS + Android) conviven
  const CORRIENDO = { 'iphone-1': { device: 'iPhone', platform: 'ios' } }

  it('otra corrida de la misma plataforma bloquea', () => {
    expect(plataformaOcupada(CORRIENDO, 'ios')?.device).toBe('iPhone')
  })

  it('normaliza la familia: android-arm64 es android', () => {
    const c = { x: { device: 'Pixel', platform: 'android-arm64' } }
    expect(plataformaOcupada(c, 'android-x64')?.device).toBe('Pixel')
  })

  it('plataformas distintas conviven', () => {
    expect(plataformaOcupada(CORRIENDO, 'android-arm64')).toBeNull()
    expect(plataformaOcupada(CORRIENDO, 'darwin')).toBeNull()
  })

  it('sin corridas nunca bloquea', () => {
    expect(plataformaOcupada({}, 'ios')).toBeNull()
    expect(plataformaOcupada(null, 'ios')).toBeNull()
  })
})

// ── Pedir por tipo y plataforma, sin saber nombres ───────────────────────────
describe('interpretaCorrer: «el emulador android», «el físico ios»', () => {
  const CTX = {
    devices: [
      { id: '00008030', name: 'iPhone', platform: 'ios', tipo: 'fisico' },
      { id: '36c56d94', name: '24069PC21G', platform: 'android-arm64', tipo: 'fisico' },
      { id: 'macos', name: 'macOS', platform: 'darwin', tipo: 'escritorio' },
    ],
    emulators: [
      { id: 'apple_ios_simulator', name: 'iOS Simulator', platform: 'ios' },
      { id: 'Medium_Phone_API_36.1', name: 'Medium Phone API 36.1', platform: 'android' },
    ],
    configs: [{ name: 'Global66 (ci)' }, { name: 'Global66 (prod)' }],
  }
  const cual = (frase, ctx = CTX) => {
    const r = interpretaCorrer(frase, ctx)
    return r.objetivo ? `${r.objetivo.tipo}:${r.objetivo.item.id}` : r.ambiguo ? 'ambiguo' : 'nada'
  }

  it('distingue emulador de físico dentro de la misma plataforma', () => {
    // sin el tipo en la puntuación, «emulador android» empataba con el Android
    // físico: los dos dicen «android»
    expect(cual('el emulador android')).toBe('emulador:Medium_Phone_API_36.1')
    expect(cual('el fisico android')).toBe('dispositivo:36c56d94')
    expect(cual('el emulador ios')).toBe('emulador:apple_ios_simulator')
    expect(cual('el fisico ios')).toBe('dispositivo:00008030')
  })

  it('«simulador» es de Apple: no arrastra al emulador de Android', () => {
    expect(cual('el simulador')).toBe('emulador:apple_ios_simulator')
  })

  it('un nombre concreto sigue mandando', () => {
    expect(cual('iphone')).toBe('dispositivo:00008030')
    expect(cual('en escritorio')).toBe('dispositivo:macos')
  })

  it('el tipo se combina con la configuración', () => {
    const r = interpretaCorrer('prod en el fisico ios', CTX)
    expect(r.objetivo.item.id).toBe('00008030')
    expect(r.config.name).toBe('Global66 (prod)')
  })

  it('si el emulador pedido ya está arriba, gana ése y no se arranca otro', () => {
    const ctx = {
      ...CTX,
      devices: [...CTX.devices, { id: 'emulator-5554', name: 'sdk gphone64', platform: 'android-arm64', tipo: 'emulador' }],
    }
    expect(cual('el emulador android', ctx)).toBe('dispositivo:emulator-5554')
  })

  it('dos emuladores android por arrancar sí es ambiguo', () => {
    const ctx = {
      ...CTX,
      emulators: [
        { id: 'Small_Phone', name: 'Small Phone', platform: 'android' },
        { id: 'Medium_Phone_API_36.1', name: 'Medium Phone API 36.1', platform: 'android' },
      ],
    }
    expect(cual('el emulador android', ctx)).toBe('ambiguo')
  })
})

// ── Solo los objetivos donde el proyecto puede correr ────────────────────────
describe('plataformasDelProyecto y filtraPorPlataforma', () => {
  const DEVICES = [
    { name: 'iPhone', platform: 'ios' },
    { name: '24069PC21G', platform: 'android-arm64' },
    { name: 'macOS', platform: 'darwin' },
    { name: 'Chrome', platform: 'web-javascript' },
  ]
  const EMUS = [
    { name: 'iOS Simulator', platform: 'ios' },
    { name: 'Medium Phone', platform: 'android' },
  ]
  const nombres = (dirs, items = DEVICES) =>
    filtraPorPlataforma(items, plataformasDelProyecto(dirs)).map((x) => x.name)

  it('una app móvil no ofrece escritorio ni web', () => {
    // comprobado en el proyecto real: `flutter run -d chrome` sin carpeta web/
    // muere al arrancar, así que ofrecerlo es regalar una compilación fallida
    expect(nombres(['android', 'ios'])).toEqual(['iPhone', '24069PC21G'])
  })

  it('una app web solo ofrece web, y ningún emulador', () => {
    expect(nombres(['web'])).toEqual(['Chrome'])
    expect(nombres(['web'], EMUS)).toEqual([])
  })

  it('una app de escritorio solo ofrece escritorio', () => {
    expect(nombres(['macos'])).toEqual(['macOS'])
  })

  it('solo android deja fuera al iPhone y al simulador', () => {
    expect(nombres(['android'])).toEqual(['24069PC21G'])
    expect(nombres(['android'], EMUS)).toEqual(['Medium Phone'])
  })

  it('solo ios deja fuera al android', () => {
    expect(nombres(['ios'])).toEqual(['iPhone'])
    expect(nombres(['ios'], EMUS)).toEqual(['iOS Simulator'])
  })

  it('con todas las carpetas no filtra nada', () => {
    expect(nombres(['android', 'ios', 'web', 'macos'])).toHaveLength(4)
  })

  it('sin plataformas reconocidas no filtra: mejor mostrar todo que nada', () => {
    expect(nombres([])).toHaveLength(4)
  })

  it('la familia se saca del targetPlatform que reporta flutter', () => {
    expect(familiaPlataforma('android-arm64')).toBe('android')
    expect(familiaPlataforma('web-javascript')).toBe('web')
    expect(familiaPlataforma('darwin')).toBe('darwin')
    expect(familiaPlataforma('ios')).toBe('ios')
  })
})

describe('dispositivoDeDaemon', () => {
  // params literales de un `device.added` real (flutter daemon 0.6.1)
  it('normaliza un teléfono físico a la forma de la lista', () => {
    const d = dispositivoDeDaemon({
      id: '00008030-000C390C1AC0C02E',
      name: 'iPhone',
      platform: 'ios',
      emulator: false,
      ephemeral: true,
    })
    expect(d).toMatchObject({ id: '00008030-000C390C1AC0C02E', name: 'iPhone', platform: 'ios', tipo: 'fisico' })
  })

  it('un emulador arrancado se marca como emulador', () => {
    expect(dispositivoDeDaemon({ id: 'emulator-5554', name: 'sdk gphone64', platform: 'android-arm64', emulator: true }).tipo).toBe(
      'emulador'
    )
  })

  it('escritorio y web se clasifican igual que en la lista', () => {
    expect(dispositivoDeDaemon({ id: 'macos', name: 'macOS', platform: 'darwin' }).tipo).toBe('escritorio')
    expect(dispositivoDeDaemon({ id: 'chrome', name: 'Chrome', platform: 'web-javascript' }).tipo).toBe('web')
  })

  it('sin id no hay dispositivo', () => {
    expect(dispositivoDeDaemon({})).toBeNull()
    expect(dispositivoDeDaemon(null)).toBeNull()
  })
})

// ── Proyectos npm (web y escritorio) ─────────────────────────────────────────
describe('scriptsDelProyecto', () => {
  // los scripts reales de este mismo proyecto: web (vite) + escritorio (electron)
  const PKG = JSON.stringify({
    scripts: {
      dev: 'concurrently -k npm:dev:vite npm:dev:electron',
      'dev:vite': 'vite',
      build: 'vite build',
      preview: 'vite preview',
      start: 'NODE_ENV=production electron .',
      'dist:mac': 'vite build && electron-builder --mac dmg',
      test: 'vitest run',
      lint: 'eslint .',
    },
  })

  it('separa los que arrancan algo de los que compilan y terminan', () => {
    const s = scriptsDelProyecto(PKG)
    const corren = s.filter((x) => x.corre).map((x) => x.name)
    expect(corren).toEqual(['dev', 'dev:vite', 'preview', 'start'])
    expect(s.find((x) => x.name === 'build').corre).toBe(false)
    expect(s.find((x) => x.name === 'dist:mac').corre).toBe(false)
  })

  it('los que corren van primero, pero no se esconde ninguno', () => {
    const s = scriptsDelProyecto(PKG)
    expect(s[0].corre).toBe(true)
    expect(s).toHaveLength(8) // están todos
  })

  it('un package.json sin scripts o roto no revienta', () => {
    expect(scriptsDelProyecto('{"name":"x"}')).toEqual([])
    expect(scriptsDelProyecto('{roto')).toEqual([])
    expect(scriptsDelProyecto(null)).toEqual([])
  })
})

describe('gestorDePaquetes y argsDeScript', () => {
  it('lo decide el lockfile, no la preferencia', () => {
    expect(gestorDePaquetes(['package-lock.json'])).toBe('npm')
    expect(gestorDePaquetes(['pnpm-lock.yaml'])).toBe('pnpm')
    expect(gestorDePaquetes(['yarn.lock'])).toBe('yarn')
    expect(gestorDePaquetes(['bun.lockb'])).toBe('bun')
  })

  it('sin lockfile se asume npm', () => {
    expect(gestorDePaquetes([])).toBe('npm')
    expect(gestorDePaquetes(null)).toBe('npm')
  })

  it('yarn no lleva «run»', () => {
    expect(argsDeScript('npm', 'dev')).toEqual(['run', 'dev'])
    expect(argsDeScript('pnpm', 'dev')).toEqual(['run', 'dev'])
    expect(argsDeScript('yarn', 'dev')).toEqual(['dev'])
  })
})

describe('urlDeSalida', () => {
  it('encuentra la URL en la salida de Vite, Next y CRA', () => {
    expect(urlDeSalida('  ➜  Local:   http://localhost:5173/')).toBe('http://localhost:5173/')
    expect(urlDeSalida('- Local:        http://localhost:3000')).toBe('http://localhost:3000')
    expect(urlDeSalida('On Your Network: http://127.0.0.1:8080/app')).toBe('http://127.0.0.1:8080/app')
  })

  it('no confunde una URL cualquiera con el servidor local', () => {
    expect(urlDeSalida('see https://vitejs.dev for help')).toBeNull()
    expect(urlDeSalida('')).toBeNull()
    expect(urlDeSalida(null)).toBeNull()
  })
})

describe('interpretaScript', () => {
  const SC = [
    { name: 'dev', corre: true },
    { name: 'dev:vite', corre: true },
    { name: 'start', corre: true },
    { name: 'build', corre: false },
  ]
  const cual = (frase) => {
    const r = interpretaScript(frase, SC)
    return r.objetivo ? r.objetivo.name : r.ambiguo ? 'ambiguo' : 'nada'
  }

  it('empareja el script por su nombre', () => {
    expect(cual('start')).toBe('start')
    expect(cual('dev:vite')).toBe('dev:vite')
  })

  it('un script que se queda corriendo le gana al que solo comparte prefijo', () => {
    // «dev» debe apuntar a dev, no a dev:vite
    expect(cual('dev')).toBe('dev')
  })

  it('los que compilan y terminan también se pueden pedir por su nombre', () => {
    expect(cual('build')).toBe('build')
  })

  it('sin coincidencia no inventa', () => {
    expect(cual('lo que sea')).toBe('nada')
    expect(cual('')).toBe('nada')
  })

  it('sin scripts no revienta', () => {
    expect(interpretaScript('dev', null).objetivo).toBeNull()
  })
})

// ── Targets de Makefile ─────────────────────────────────────────────────────
// Líneas literales del Makefile de front-mobile-b2c.
describe('parseMakefile', () => {
  const ARCHIVOS = [
    {
      nombre: 'Makefile',
      texto: `.DEFAULT_GOAL := help
ENABLE_NETWORK_LOGGING ?=
help: ## Muestra esta ayuda.
	@awk '...'
`,
    },
    {
      nombre: 'dev.mk',
      texto: `generate: ## Genera el código de Riverpod/Freezed una sola vez.
generate-mod: ## Genera solo un módulo. Uso: make generate-mod MOD=auth (filtra lib/modules/{MOD}/**).
prepare: clean install ## (Reset) Limpia, instala, genera y analiza el proyecto.
_interno:
	@echo sin doble almohadilla
`,
    },
    {
      nombre: 'build.mk',
      texto: `build-preprod-apk: ## Genera APK de release. Uso: make build-preprod-apk [ENABLE_NETWORK_LOGGING=true]
`,
    },
  ]

  it('lee los targets documentados y los ubica en su módulo', () => {
    const ts = parseMakefile(ARCHIVOS)
    expect(ts.map((t) => t.name)).toEqual(['help', 'generate', 'generate-mod', 'prepare', 'build-preprod-apk'])
    expect(ts.find((t) => t.name === 'generate').modulo).toBe('dev')
    expect(ts.find((t) => t.name === 'help').modulo).toBe('general')
  })

  it('un target con prerrequisitos sigue siendo un target', () => {
    // `prepare: clean install ## …`
    expect(parseMakefile(ARCHIVOS).find((t) => t.name === 'prepare').desc).toMatch(/Limpia, instala/)
  })

  it('ignora asignaciones y lo que no está documentado', () => {
    const ts = parseMakefile(ARCHIVOS)
    expect(ts.some((t) => t.name === '.DEFAULT_GOAL')).toBe(false)
    expect(ts.some((t) => t.name === 'ENABLE_NETWORK_LOGGING')).toBe(false)
    expect(ts.some((t) => t.name === '_interno')).toBe(false)
  })

  it('distingue argumento obligatorio de opcional por los corchetes', () => {
    const ts = parseMakefile(ARCHIVOS)
    const mod = ts.find((t) => t.name === 'generate-mod')
    expect(mod.args).toEqual(['MOD'])
    expect(mod.argsOpt).toEqual([])
    const apk = ts.find((t) => t.name === 'build-preprod-apk')
    expect(apk.args).toEqual([]) // entre corchetes: no bloquea
    expect(apk.argsOpt).toEqual(['ENABLE_NETWORK_LOGGING'])
  })

  it('la descripción no arrastra el «Uso:»', () => {
    expect(parseMakefile(ARCHIVOS).find((t) => t.name === 'generate-mod').desc).toBe('Genera solo un módulo.')
  })

  it('sin archivos no revienta', () => {
    expect(parseMakefile([])).toEqual([])
    expect(parseMakefile(null)).toEqual([])
  })
})

describe('agrupaTargets', () => {
  it('agrupa por módulo conservando el orden de aparición', () => {
    const g = agrupaTargets(parseMakefile(ARCHIVOS_G))
    expect(g.map((x) => x.modulo)).toEqual(['dev', 'ios'])
    expect(g[0].items).toHaveLength(2)
  })
  const ARCHIVOS_G = [
    { nombre: 'dev.mk', texto: 'a: ## uno\nb: ## dos\n' },
    { nombre: 'ios.mk', texto: 'c: ## tres\n' },
  ]
})

describe('parsePathDeShell', () => {
  it('lee el formato normal, separado por «:»', () => {
    // salida real de zsh en esta máquina
    expect(parsePathDeShell('/Users/x/.rbenv/shims:/usr/bin:/bin')).toEqual([
      '/Users/x/.rbenv/shims',
      '/usr/bin',
      '/bin',
    ])
  })

  it('entiende fish, donde $PATH es una lista y sale con espacios', () => {
    expect(parsePathDeShell('/usr/local/bin /usr/bin /bin')).toEqual(['/usr/local/bin', '/usr/bin', '/bin'])
  })

  it('con «:» no parte por espacios: una carpeta puede llevarlos', () => {
    expect(parsePathDeShell('/Applications/Mi App/bin:/usr/bin')).toEqual(['/Applications/Mi App/bin', '/usr/bin'])
  })

  it('descarta el ruido de arranque del shell y se queda con la última línea', () => {
    expect(parsePathDeShell('bienvenido a mi shell\ncargando /etc/algo\n/usr/bin:/bin')).toEqual(['/usr/bin', '/bin'])
  })

  it('no duplica ni deja entradas relativas', () => {
    expect(parsePathDeShell('/usr/bin:/usr/bin:relativo:/bin')).toEqual(['/usr/bin', '/bin'])
  })

  it('sin salida devuelve lista vacía', () => {
    expect(parsePathDeShell('')).toEqual([])
    expect(parsePathDeShell(null)).toEqual([])
  })
})

// El nivel de esfuerzo (`claude --effort`). Un valor desconocido no rompe el
// CLI: avisa y usa el default. Por eso se valida antes — un flag ignorado en
// silencio es peor que no mandarlo, porque el usuario cree que eligió algo.
describe('effort', () => {
  const base = { prompt: 'x', allowed: 'Read', persona: 'p' }

  it('pasa --effort cuando el nivel es válido', () => {
    for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const args = buildClaudeArgs({ ...base, effort: e })
      expect(args[args.indexOf('--effort') + 1]).toBe(e)
    }
  })

  it('no lo pasa si no se eligió ninguno: manda el default del CLI', () => {
    expect(buildClaudeArgs({ ...base }).includes('--effort')).toBe(false)
    expect(buildClaudeArgs({ ...base, effort: '' }).includes('--effort')).toBe(false)
  })

  it('descarta un nivel inventado en vez de mandarlo y que lo ignoren', () => {
    expect(buildClaudeArgs({ ...base, effort: 'ultra' }).includes('--effort')).toBe(false)
    expect(core.effortValido('ultra')).toBe(null)
  })

  it('la lista del renderer y la del proceso principal no pueden divergir', async () => {
    // están duplicadas porque el renderer no puede importar CommonJS
    const { EFFORTS } = await import('../../src/lib/helpers.js')
    expect(EFFORTS).toEqual(core.EFFORTS)
  })
})

// Subagentes: quién habla y qué puesto ocupa. El subagente NO es el rol cuyo
// personaje toma prestado —es multifunción, sin su persona ni su sesión—; solo
// se le presta la silla para que su trabajo se vea en la oficina.
describe('subDeMensaje', () => {
  const { subDeMensaje } = core

  it('un mensaje del principal no es de nadie más', () => {
    expect(subDeMensaje({ parent_tool_use_id: null })).toBe(null)
    expect(subDeMensaje({})).toBe(null)
    expect(subDeMensaje(null)).toBe(null)
  })

  it('un mensaje de subagente trae su id, su tipo y el encargo', () => {
    expect(
      subDeMensaje({ parent_tool_use_id: 'toolu_9', subagent_type: 'general-purpose', task_description: 'comparar skills' })
    ).toEqual({ id: 'toolu_9', tipo: 'general-purpose', desc: 'comparar skills' })
  })

  it('sin --forward-subagent-text no vienen tipo ni encargo, pero el id basta', () => {
    expect(subDeMensaje({ parent_tool_use_id: 'toolu_9' })).toEqual({ id: 'toolu_9', tipo: null, desc: null })
  })
})



// El subagente al que se delega se define por CLI, con su propio prompt. Es lo
// único que le impone el idioma: no hereda la persona del que lo lanza, y
// pedírselo al que reparte solo se cumplía a medias.
describe('agentesDeEquipo', () => {
  const { agentesDeEquipo } = core

  it('lleva el idioma del usuario en el prompt del subagente', () => {
    const def = JSON.parse(agentesDeEquipo('Spanish'))
    expect(def.companero.prompt).toContain('Spanish')
    expect(JSON.parse(agentesDeEquipo('English')).companero.prompt).toContain('English')
  })

  it('se pasa como --agents, con JSON válido', () => {
    const args = buildClaudeArgs({ prompt: 'x', allowed: 'Read', persona: 'p', idioma: 'Spanish' })
    const json = args[args.indexOf('--agents') + 1]
    expect(() => JSON.parse(json)).not.toThrow()
    expect(Object.keys(JSON.parse(json))).toEqual(['companero'])
  })

  it('sin idioma no se pasa: mejor el default del CLI que un --agents a medias', () => {
    expect(buildClaudeArgs({ prompt: 'x', allowed: 'Read', persona: 'p' }).includes('--agents')).toBe(false)
  })
})

// El modelo y el esfuerzo propios de un agente son suyos, no del catálogo de
// roles: si el guardado del squad no los conserva, se pierden en silencio en el
// siguiente guardado y el usuario ve que su elección «no se aplicó».
describe('el roster conserva lo que es del rol', () => {
  // réplica del saneado de squad:save, para fijar qué campos sobreviven
  const guardado = (r) =>
    r.custom
      ? { id: r.id, name: r.name, enabled: !!r.enabled, avatar: r.avatar || null, custom: true, emoji: r.emoji || '🛠️', color: r.color || '#38bdf8', hair: r.hair || '#1f2937', focus: r.focus || '', kw: r.kw || '', model: r.model || null, effort: r.effort || null }
      : { id: r.id, name: r.name, enabled: !!r.enabled, avatar: r.avatar || null, custom: false, model: r.model || null, effort: r.effort || null }

  it('un built-in conserva su modelo y su esfuerzo', () => {
    const g = guardado({ id: 'qa', name: 'Nami', enabled: true, model: 'claude-haiku-4-5', effort: 'low' })
    expect(g.model).toBe('claude-haiku-4-5')
    expect(g.effort).toBe('low')
  })

  it('un rol personalizado también', () => {
    const g = guardado({ id: 'x', name: 'Ana', enabled: true, custom: true, model: 'claude-opus-5[1m]', effort: 'max' })
    expect(g.model).toBe('claude-opus-5[1m]')
    expect(g.effort).toBe('max')
  })

  it('sin elección propia queda null, que es «usa el global»', () => {
    const g = guardado({ id: 'dev', name: 'Luffy', enabled: true })
    expect(g.model).toBe(null)
    expect(g.effort).toBe(null)
  })
})

// La caché de Chromium crece sin tope: medido en una instalación real, 708 MB
// entre Cache y Code Cache cuando el historial entero ocupaba 108 KB.
describe('tocaLimpiarCache', () => {
  const { tocaLimpiarCache, CACHE_MAX } = core
  const MB = 1024 * 1024

  it('no limpia mientras esté por debajo del tope', () => {
    expect(tocaLimpiarCache(0)).toBe(false)
    expect(tocaLimpiarCache(CACHE_MAX)).toBe(false)
  })

  it('limpia al pasarse, que es lo que ya había ocurrido', () => {
    expect(tocaLimpiarCache(CACHE_MAX + 1)).toBe(true)
    expect(tocaLimpiarCache(708 * MB)).toBe(true)
  })

  it('un tamaño ilegible no dispara una limpieza a ciegas', () => {
    expect(tocaLimpiarCache(undefined)).toBe(false)
    expect(tocaLimpiarCache(null)).toBe(false)
  })
})

// Contención de rutas. Esta regla estuvo rota cuatro versiones sin hacer ruido:
// el renderer no decía de qué perfil era el documento, el main asumía «work», y
// a quien trabajaba en otro perfil no se le abría NADA —ni el archivo, ni la
// carpeta, ni el zip— sin un solo error por ningún lado.
describe('rutaContenida', () => {
  const { rutaContenida } = core
  const dir = '/Users/x/Artifacts/work'

  it('un archivo de dentro pasa', () => {
    expect(rutaContenida(dir, `${dir}/informe.html`)).toBe(true)
  })

  it('la propia carpeta pasa: «abrir la carpeta» es una acción válida', () => {
    expect(rutaContenida(dir, dir)).toBe(true)
  })

  it('el de OTRO perfil no pasa — el caso que se rompió', () => {
    expect(rutaContenida(dir, '/Users/x/Artifacts/private/informe.html')).toBe(false)
  })

  it('no basta con que el nombre empiece igual', () => {
    // «work-viejo» empieza por «work» y no está dentro de «work»
    expect(rutaContenida(dir, '/Users/x/Artifacts/work-viejo/informe.html')).toBe(false)
  })

  it('salirse con .. no cuela', () => {
    expect(rutaContenida(dir, `${dir}/../private/informe.html`)).toBe(false)
    expect(rutaContenida(dir, `${dir}/../../../etc/passwd`)).toBe(false)
  })

  it('sin datos, no pasa', () => {
    expect(rutaContenida(dir, '')).toBe(false)
    expect(rutaContenida('', '/x')).toBe(false)
    expect(rutaContenida(null, null)).toBe(false)
  })
})

describe('clavesDeSesion', () => {
  const home = '/home/yo'
  const existe = () => true

  it('cada rol se registra bajo SU proyecto, no bajo uno común', () => {
    // El fallo real: con una pestaña por proyecto, al cambiar de pestaña se
    // reenviaban también las sesiones de los que trabajan para otras. Con un
    // solo `cwd` todas caían en el proyecto de la pestaña que abrías, y como el
    // mapa se reconstruye entero, las buenas se perdían. El agente contestaba
    // luego sin contexto, o con el de otro proyecto, sin ningún aviso.
    const m = clavesDeSesion({
      sessions: { dev: 's1', qa: 's2' },
      profile: 'work',
      cwd: '/proyectos/uno',
      cwds: { qa: '/proyectos/dos' },
      home,
      existe,
    })
    expect(m.get('dev::work::/proyectos/uno')).toBe('s1')
    expect(m.get('qa::work::/proyectos/dos')).toBe('s2')
    expect(m.size).toBe(2)
  })

  it('sin `cwds` todos usan el proyecto común (comportamiento de siempre)', () => {
    const m = clavesDeSesion({ sessions: { dev: 's1', qa: 's2' }, profile: 'work', cwd: '/p/uno', home, existe })
    expect([...m.keys()]).toEqual(['dev::work::/p/uno', 'qa::work::/p/uno'])
  })

  it('un proyecto que ya no existe cae en el home, no en una ruta inventada', () => {
    const m = clavesDeSesion({
      sessions: { dev: 's1' },
      profile: 'work',
      cwd: '/borrado',
      home,
      existe: (d) => d !== '/borrado',
    })
    expect(m.get(`dev::work::${home}`)).toBe('s1')
  })

  it('las sesiones vacías no ocupan clave', () => {
    const m = clavesDeSesion({ sessions: { dev: 's1', qa: null, pr: '' }, profile: 'work', cwd: '/p', home, existe })
    expect(m.size).toBe(1)
  })
})

describe('quitar y agregar proyectos de la lista', () => {
  it('un proyecto DETECTADO se recuerda como oculto: no hay de dónde borrarlo', () => {
    // Los detectados son subcarpetas de la raíz del perfil y se recalculan
    // leyendo el disco en cada arranque. Sin lista de ocultos volvían siempre.
    const r = quitaProyecto({ custom: [], ocultos: [], path: '/w/copia-vieja', detectado: true })
    expect(r.ocultos).toEqual(['/w/copia-vieja'])
    expect(r.custom).toEqual([])
  })

  it('un proyecto añadido a mano se borra de su lista y NO se marca oculto', () => {
    // Ocultarlo además sería una trampa: al volver a añadirlo con el picker
    // seguiría sin aparecer, y eso es imposible de diagnosticar.
    const r = quitaProyecto({ custom: ['/fuera/repo'], ocultos: [], path: '/fuera/repo', detectado: false })
    expect(r.custom).toEqual([])
    expect(r.ocultos).toEqual([])
  })

  it('volver a agregar un proyecto oculto lo devuelve a la vista', () => {
    const r = agregaProyecto({ custom: [], ocultos: ['/w/proyecto'], path: '/w/proyecto' })
    expect(r.ocultos).toEqual([])
    expect(r.custom).toEqual(['/w/proyecto'])
  })

  it('agregar dos veces el mismo no lo duplica', () => {
    const r = agregaProyecto({ custom: ['/w/p'], ocultos: [], path: '/w/p' })
    expect(r.custom).toEqual(['/w/p'])
  })

  it('ocultar dos veces no duplica la entrada', () => {
    const r = quitaProyecto({ custom: [], ocultos: ['/w/p'], path: '/w/p', detectado: true })
    expect(r.ocultos).toEqual(['/w/p'])
  })
})


describe('componeReglas', () => {
  const cerca = { ruta: '/w/proy/CLAUDE.md', texto: 'reglas del proyecto' }
  const lejos = { ruta: '/w/CLAUDE.md', texto: 'protocolo del workspace' }

  it('emite de lo general a lo específico: el del proyecto va al FINAL', () => {
    // El orden es el arreglo entero. Claude Code carga los dos archivos pero los
    // aplica sin jerarquía —con uno pidiendo «LORO» y otro «TUCAN» la respuesta
    // sale «TUCAN LORO»— y pedir la prioridad en una frase se cumplía la mitad
    // de las veces. Repetirlos en orden, con el cercano al final, funcionó 3/3.
    const r = componeReglas([cerca, lejos])
    expect(r.indexOf('protocolo del workspace')).toBeLessThan(r.indexOf('reglas del proyecto'))
  })

  it('cada bloque dice de qué archivo viene', () => {
    // Sin la ruta, dos reglas que se contradicen son indistinguibles: no se
    // puede saber cuál es la del proyecto y cuál la heredada.
    expect(componeReglas([cerca])).toContain('/w/proy/CLAUDE.md')
  })

  it('sin CLAUDE.md en ninguna carpeta no aporta nada', () => {
    // Si no, se colaría una cabecera de «REGLAS DEL PROYECTO» sin reglas debajo,
    // que es peor que no decir nada: parece que el proyecto manda algo.
    expect(componeReglas([])).toBe('')
    expect(componeReglas([{ ruta: '/w/CLAUDE.md', texto: '   \n ' }])).toBe('')
  })

  it('al no caber todo, lo que se cae es lo de ARRIBA', () => {
    // Esto viaja en cada mensaje. Si hay que recortar, se sacrifica lo menos
    // específico: las reglas del proyecto son las que no pueden faltar.
    const r = componeReglas([{ ruta: '/w/p/CLAUDE.md', texto: 'P'.repeat(900) }, { ruta: '/w/CLAUDE.md', texto: 'W'.repeat(900) }], 1000)
    expect(r).toContain('P'.repeat(900))
    expect(r).not.toContain('W'.repeat(900))
  })

  it('lo recortado avisa y dice cómo leer el resto', () => {
    // Cortar en seco haría creer que ahí se acaban las reglas, y el agente
    // daría por buenas unas instrucciones a medias.
    const r = componeReglas([{ ruta: '/w/p/CLAUDE.md', texto: 'x'.repeat(5000) }], 1000)
    expect(r).toContain('recortado')
    expect(r).toContain('Read')
  })
})
