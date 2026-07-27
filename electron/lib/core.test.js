import { describe, expect, it } from 'vitest'
import core from './core.js'

const { sanitizeEnv, sessionKey, pickSafeMcp, parseUsage, gitignoreConSquad, buildClaudeArgs } = core

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
