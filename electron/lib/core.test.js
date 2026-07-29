import { describe, expect, it } from 'vitest'
import core from './core.js'

const { sanitizeEnv, sessionKey, pickSafeMcp, parseUsage, gitignoreConSquad, buildClaudeArgs } = core
const { esProyectoFlutter, buscaProyectosFlutter, parseEmuladores, ordenaDispositivos } = core
const { resultadoLanzarEmulador, idsEmuladorAdb, marcaEmuladoresCorriendo } = core
const { parseLineaDaemon, mensajeDaemon, peticionRecarga, comoCancelar } = core
const { resultadoRecarga, aplicaProgreso, progresoVisible } = core

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
