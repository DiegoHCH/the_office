// Helpers puros: formato, modelos, composer y extracción de opciones.
// Extraído de App.jsx (refactor #94) sin cambios de comportamiento.
import { t } from './i18n.js'

// ── Monitor: cuándo resetea la cuota ────────────────────────────────────────
export const fmtReset = (iso) => {
  const ms = new Date(iso) - Date.now()
  if (!iso || ms <= 0) return t('fmt.now')
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m % 60}m`
}


// Opciones del selector: las mismas que ofrece /model en la terminal.
export const MODEL_OPTIONS = {
  'claude-opus-5[1m]': 'Opus 5 · 1M',
  'claude-fable-5': 'Fable 5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5': 'Haiku 4.5',
}
// Etiquetas conocidas (superset): IDs heredados de configs viejas también
// muestran nombre bonito, aunque no se ofrezcan como opción.
export const MODEL_LABELS = {
  ...MODEL_OPTIONS,
  'claude-opus-5': 'Opus 5',
  'claude-fable-5[1m]': 'Fable 5 · 1M',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}
// "opus" en la terminal es Opus 5 con contexto 1M — mismo mapeo aquí.
export const MODEL_ALIASES = {
  opus: 'claude-opus-5[1m]',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5',
  fable1m: 'claude-fable-5[1m]',
}
// El default recomendado de la terminal (sin modelo en settings.json).
export const FALLBACK_MODEL = 'claude-opus-5[1m]'

// Etiqueta legible de un modelo: acepta IDs completos y alias, con o sin
// sufijo [1m] ("opus[1m]" — la forma que guarda /model de la terminal).
export function modelLabelOf(id) {
  if (!id) return ''
  if (MODEL_LABELS[id]) return MODEL_LABELS[id]
  const oneM = id.endsWith('[1m]')
  const base = oneM ? id.slice(0, -4) : id
  const full = MODEL_ALIASES[base] || base
  const label = (oneM && MODEL_LABELS[`${full}[1m]`]) || MODEL_LABELS[full]
  if (label) return oneM && !label.includes('1M') ? `${label} · 1M` : label
  return id.replace(/^claude-/, '')
}

// Ventana de contexto por modelo, para avisar antes de que Claude compacte
// solo. No es el acumulado de la conversación: lo que ocupa contexto es lo que
// se ENVÍA cada turno (entrada + caché), y eso es lo que se compara aquí.
const VENTANAS = { 'claude-haiku-4-5': 200_000, 'claude-haiku-4-5-20251001': 200_000 }
export const ventanaDe = (id) => VENTANAS[id] ?? (id?.includes('haiku') ? 200_000 : 1_000_000)

// Tokens realmente enviados en el último turno = ocupación del contexto.
export const contextoUsado = (u) =>
  (u?.input_tokens || 0) + (u?.cache_read_input_tokens || 0) + (u?.cache_creation_input_tokens || 0)

// El composer es un textarea que crece con el contenido (hasta el máximo del CSS).
export const autoGrow = (el) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// "2m 15s" / "45s" — cuánto lleva un agente en su turno.
export const fmtElapsed = (ms) => {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

// 950 → «950» · 12 400 → «12.4k» · 3 200 000 → «3.2M»
export const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
// total y desglose del usage que reporta Claude Code en el evento result
export const usageTotal = (u) =>
  (u?.input_tokens || 0) + (u?.output_tokens || 0) + (u?.cache_creation_input_tokens || 0) + (u?.cache_read_input_tokens || 0)
export const usageTitle = (u) =>
  `entrada ${fmtTokens(u?.input_tokens || 0)} · salida ${fmtTokens(u?.output_tokens || 0)} · caché ${fmtTokens(
    (u?.cache_creation_input_tokens || 0) + (u?.cache_read_input_tokens || 0)
  )}`

export const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ¿La línea es un ítem de menú? → devuelve su etiqueta (o null).
// Formatos: 1. / 2) / A. / - / • / **1.**  seguidos de contenido corto.
function optionLabel(line) {
  const m = line.match(/^(?:\*\*)?(?:\d{1,2}|[a-dA-D])(?:\*\*)?[.)]\s+(.+)$/) || line.match(/^[-•]\s+(.+)$/)
  if (!m) return null
  const label = m[1].replace(/\*\*/g, '').replace(/`/g, '').trim()
  return label.length >= 2 && label.length <= 80 ? label : null
}

// Extrae opciones "seleccionables" (para botones rápidos) SOLO si el mensaje
// termina en un menú: una lista contigua de 2–6 ítems al final, opcionalmente
// seguida de una pregunta corta de cierre. Una lista informativa a mitad del
// texto (viñetas de un resumen, pasos ya hechos…) no genera botones.
export function extractOptions(text) {
  if (!text) return []
  const lines = text.split('\n').map((l) => l.trim())
  let i = lines.length - 1
  while (i >= 0 && !lines[i]) i-- // ignora líneas vacías finales
  // se tolera una única pregunta corta después de la lista ("¿Cuál elijo?")
  if (i >= 0 && !optionLabel(lines[i]) && lines[i].endsWith('?') && lines[i].length <= 60) i--
  while (i >= 0 && !lines[i]) i--
  const opts = []
  for (; i >= 0; i--) {
    const label = lines[i] && optionLabel(lines[i])
    if (!label) break // fin del bloque contiguo
    opts.unshift(label)
  }
  return opts.length >= 2 && opts.length <= 6 ? opts : []
}

// ── ¿Este bloque de código es un comando para la terminal? ──────────────────
// Se usa para ofrecer «correr en la terminal» junto a lo que el agente dice que
// no puede hacer él (logins OAuth, comandos interactivos). Conservador a
// propósito: es mejor no ofrecer el botón que ofrecerlo sobre un fragmento de
// Dart o un JSON.
const COMANDOS = /^(npm|npx|yarn|pnpm|bun|node|git|gh|make|flutter|fvm|dart|pod|bundle|brew|firebase|fastlane|adb|xcrun|xcodebuild|gradlew|\.\/gradlew|curl|open|cd|export|source|chmod|ssh|docker|python3?|pip3?|ruby|gem|rbenv|nvm|code)\b/
const LENGUAJES_SHELL = new Set(['bash', 'sh', 'zsh', 'shell', 'console', 'terminal'])

export function esComandoDeShell(texto, lang) {
  // `t` a secas pisaría la función de traducción importada arriba
  const txt = String(texto || '').trim()
  if (!txt) return false
  const lineas = txt.split('\n').filter((l) => l.trim())
  // varias líneas ya no es «un comando»: es un script, y ahí conviene mirarlo
  if (lineas.length > 3) return false
  // señales de que es código y no shell
  if (/[{};]\s*$/.test(txt) || /=>|function\s|class\s|import\s+\{/.test(txt)) return false
  if (LENGUAJES_SHELL.has(String(lang || '').toLowerCase())) return true
  // sin lenguaje declarado hay que ser más estricto: solo si arranca por un
  // comando conocido, y en una sola línea
  return lineas.length === 1 && COMANDOS.test(lineas[0].trim().replace(/^\$\s*/, ''))
}

// El texto listo para pegar: sin el «$ » que a veces acompaña a los ejemplos.
export const limpiaComando = (texto) =>
  String(texto || '')
    .split('\n')
    .map((l) => l.replace(/^\s*\$\s+/, ''))
    .join('\n')
    .trim()

// ── Ritmo de la escena 3D ────────────────────────────────────────────────────
// Cuántos frames por segundo pedirle a la escena según lo que esté pasando. El
// ritmo de pantalla se reserva para cuando hay trabajo de verdad: en reposo la
// oficina sigue viva (el clip Idle en bucle, los paseos, las partículas) y no se
// puede congelar, pero se ve bien a 20fps — el cine son 24.
//
// Devuelve 0 para «sin ticker»: ahí el Canvas va con frameloop='always' y lo
// marca la pantalla. Y OJO: nada de esto lo frena Chromium por nosotros, porque
// backgroundThrottling está desactivado para que la escena no se congele en
// background. Este número es el único freno que hay.
export const fpsEscena = ({ visible, trabajando }) => (!visible ? 4 : trabajando ? 0 : 20)

// ¿Hay que montar el ticker? Sin foco solo mientras quede movimiento por
// terminar, para que no queden caminatas a medias — y cuando termina, se apaga.
export const tickerActivo = ({ visible, trabajando, hayMovimiento }) =>
  fpsEscena({ visible, trabajando }) > 0 && (visible || hayMovimiento)
