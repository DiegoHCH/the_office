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
function sanitizeEnv(base, { home, profileDir } = {}) {
  const env = { ...base }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', home ? `${home}/.local/bin` : null].filter(Boolean)
  env.PATH = [...new Set([...(env.PATH || '').split(':').filter(Boolean), ...extra])].join(':')
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
// El Revisor PR corre con bypassPermissions: sus skills llaman conectores MCP
// que en headless no tienen prompt de aprobación. El resto va en acceptEdits.
function buildClaudeArgs({ prompt, allowed, persona, writeMode, isPR, model, sid }) {
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
  ]
  if (writeMode) args.push('--permission-mode', isPR ? 'bypassPermissions' : 'acceptEdits')
  if (model) args.push('--model', model)
  if (sid) args.push('--resume', sid)
  return args
}

module.exports = { sanitizeEnv, sessionKey, pickSafeMcp, parseUsage, gitignoreConSquad, buildClaudeArgs }
