import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Office, { THEMES } from './Office.jsx'
import { popSound, dingSound, buzzSound, setSoundEnabled } from './sound.js'
import { getAvatarThumb, NONHUMAN_AVATARS } from './scene/avatarThumbs.js'

// ── Monitor de recursos (esquina superior izquierda de la escena) ───────────
const fmtReset = (iso) => {
  const ms = new Date(iso) - Date.now()
  if (!iso || ms <= 0) return 'ya'
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m % 60}m`
}

// Logo de Apple (sistema) y spark de Claude, como SVG inline.
const AppleIcon = () => (
  <svg viewBox="0 0 384 512" width="11" height="11" fill="#e9f1ee">
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.7-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
  </svg>
)
const ClaudeIcon = () => {
  const spokes = [8, 41, 74, 106, 139, 172, 205, 238, 272, 305, 338].map((deg, i) => {
    const a = (deg * Math.PI) / 180
    const len = 8.6 + (i % 3) * 0.7
    return <line key={deg} x1="12" y1="12" x2={12 + Math.cos(a) * len} y2={12 + Math.sin(a) * len} />
  })
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" stroke="#da7756" strokeWidth="3" strokeLinecap="round">
      {spokes}
    </svg>
  )
}

function Bar({ pct }) {
  const p = Math.min(100, Math.max(0, pct || 0))
  return (
    <div className="mon-bar">
      <div className={p > 80 ? 'hot' : ''} style={{ width: `${p}%` }} />
    </div>
  )
}

function SysMonitor({ modelLabel, profile }) {
  const [s, setS] = useState(null)
  useEffect(() => {
    let on = true
    const tick = async () => {
      const d = await window.oficina?.stats?.(profile)
      if (on && d) setS(d)
    }
    tick()
    const iv = setInterval(tick, 3000)
    // al volver a la ventana, refrescar el % (por si la sesión se reinició fuera)
    const onFocus = () => {
      window.oficina?.refreshUsage?.()
      tick()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      on = false
      clearInterval(iv)
      window.removeEventListener('focus', onFocus)
    }
  }, [profile])
  if (!s) return null
  const gb = (b) => (b / 1073741824).toFixed(1)
  const ramPct = (s.ramUsed / s.ramTotal) * 100
  // dos burbujas independientes apiladas: sistema arriba, claude debajo
  return (
    <div className="sysmon-stack">
      <div className="sysmon">
        <div className="mon-title">
          <AppleIcon /> sistema
        </div>
        <div className="mon-row">
          <span>CPU</span>
          <Bar pct={s.cpu} />
          <b>{s.cpu}%</b>
        </div>
        <div className="mon-row">
          <span>RAM</span>
          <Bar pct={ramPct} />
          <b>
            {gb(s.ramUsed)}/{gb(s.ramTotal)}G
          </b>
        </div>
        <div className="mon-row">
          <span>App</span>
          <span className="mon-app">{s.appMB} MB</span>
        </div>
      </div>
      {/* la burbuja de claude existe siempre: si el uso aún no llegó (API
          rate-limited, sin red, primer arranque) muestra el modelo y un aviso
          en vez de desaparecer en silencio */}
      <div className="sysmon">
        <div className="mon-title">
          <ClaudeIcon /> claude
        </div>
        {modelLabel && (
          <div className="mon-row">
            <span>Modelo</span>
            <span className="mon-model">{modelLabel}</span>
          </div>
        )}
        {!(s.claude && (s.claude.session || s.claude.weekly)) && (
          <div className="mon-sub mon-nodata">uso no disponible · reintentando…</div>
        )}
        {s.claude?.session && (
          <>
            <div className="mon-row">
              <span>Sesión</span>
              <Bar pct={s.claude.session.pct} />
              <b>{Math.round(s.claude.session.pct)}%</b>
            </div>
            <div className="mon-sub">resetea en {fmtReset(s.claude.session.resetsAt)}</div>
          </>
        )}
        {s.claude?.weekly && (
          <>
            <div className="mon-row">
              <span>Semana</span>
              <Bar pct={s.claude.weekly.pct} />
              <b>{Math.round(s.claude.weekly.pct)}%</b>
            </div>
            <div className="mon-sub">resetea en {fmtReset(s.claude.weekly.resetsAt)}</div>
          </>
        )}
      </div>
    </div>
  )
}

// Miniatura 3D de un avatar (se genera una vez y queda en caché).
function AvatarThumb({ file }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let on = true
    getAvatarThumb(file).then((u) => on && setSrc(u))
    return () => {
      on = false
    }
  }, [file])
  return src ? <img src={src} alt="" draggable={false} /> : <div className="thumb-loading">⏳</div>
}

// ── Catálogo de roles (visual + keywords). Nombres/activos vienen de la config ⚙️ ──
export const ROLE_META = {
  dev: {
    label: 'Dev',
    emoji: '⌨️',
    color: '#2dd4bf',
    hair: '#1f2937',
    url: '/models/pj/Casual_Male.gltf',
    kw: /arregla|implementa|refactoriza|codigo|\bbug\b/,
  },
  research: {
    label: 'Research',
    emoji: '🔍',
    color: '#6366f1',
    hair: '#f97316',
    url: '/models/pj/Casual_Female.gltf',
    kw: /investig|busca|analiza|compara|artifact|documenta/,
  },
  design: {
    label: 'UI/UX',
    emoji: '🎨',
    color: '#f472b6',
    hair: '#eab308',
    url: '/models/pj/Casual2_Male.gltf',
    kw: /disen|\bui\b|\bux\b|figma|pantalla|mockup|interfaz|estilo|layout|tipografia/,
  },
  qa: {
    label: 'QA',
    emoji: '🧪',
    color: '#f5a524',
    hair: '#3a8f5f',
    url: '/models/pj/Casual3_Male.gltf',
    kw: /\btest\b|\btests\b|prueba|regresion|\bqa\b|coverage|e2e|unitari/,
  },
  pr: {
    label: 'Revisor PR',
    emoji: '🔎',
    color: '#8b5cf6',
    hair: '#16181d', // Robin: pelinegra
    url: '/models/pj/Suit_Female.gltf',
    kw: /\bpr\b|\bprs\b|pull request|review|\bdiff\b|merge|mergea|pre-pr|g66-pr|review-pr|merge-hu/,
  },
  docs: {
    label: 'Docs',
    emoji: '📝',
    color: '#34d399',
    hair: '#8a5a33',
    url: '/models/pj/Doctor_Male_Young.gltf',
    kw: /\bdocs?\b|documentacion|readme|guia|manual|\badr\b/,
  },
  publish: {
    label: 'Publicador',
    emoji: '🚀',
    color: '#0ea5e9',
    hair: '#38bdf8', // Franky: pelo azul
    url: '/models/pj/BlueSoldier_Male.gltf',
    kw: /publica|publicar|pages|github pages|despliega|deploy|hostea|sube.*(artifact|web|pagina)/,
  },
}

const MAX_ACTIVE = 6

// Roles predefinidos que NO se pueden eliminar (sync con main.js). Los demás
// built-ins (UI/UX, QA, Docs) y todos los custom sí se pueden borrar.
const PROTECTED_ROLES = new Set(['dev', 'research', 'pr', 'publish'])
const canDelete = (r) => r.custom || !PROTECTED_ROLES.has(r.id)

// Regex de ruteo a partir de palabras clave separadas por coma/espacio.
const safeRegex = (s) => {
  const parts = String(s || '')
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return parts.length ? new RegExp(parts.join('|'), 'i') : null
}

// Meta visual/ruteo de un rol: los predefinidos usan ROLE_META; los personalizados
// llevan su meta inline (emoji/color/avatar/keywords) guardada en el propio rol.
export const metaOf = (r) =>
  ROLE_META[r.id] || {
    label: r.name || 'Rol',
    emoji: r.emoji || '🛠️',
    color: r.color || '#38bdf8',
    hair: r.hair || '#1f2937',
    url: `/models/pj/${r.avatar || 'Casual_Male.gltf'}`,
    kw: r.kw ? safeRegex(r.kw) : null,
  }

// Todos los personajes del pack (se excluyen accesorios y mascotas).
const AVATARS = [
  'Casual_Male.gltf', 'Casual_Female.gltf', 'Casual2_Male.gltf', 'Casual2_Female.gltf',
  'Casual3_Male.gltf', 'Casual3_Female.gltf', 'Casual_Bald.gltf',
  'Suit_Male.gltf', 'Suit_Female.gltf', 'Worker_Male.gltf', 'Worker_Female.gltf',
  'Chef_Male.gltf', 'Chef_Female.gltf',
  'Doctor_Male_Young.gltf', 'Doctor_Female_Young.gltf', 'Doctor_Male_Old.gltf', 'Doctor_Female_Old.gltf',
  'OldClassy_Male.gltf', 'OldClassy_Female.gltf',
  'Cowboy_Male.gltf', 'Cowboy_Female.gltf', 'Kimono_Male.gltf', 'Kimono_Female.gltf',
  'Ninja_Male.gltf', 'Ninja_Female.gltf', 'Ninja_Sand.gltf', 'Ninja_Sand_Female.gltf',
  'Pirate_Male.gltf', 'Pirate_Female.gltf', 'Viking_Male.gltf', 'Viking_Female.gltf',
  'Knight_Male.gltf', 'Knight_Golden_Male.gltf', 'Knight_Golden_Female.gltf',
  'Soldier_Male.gltf', 'Soldier_Female.gltf', 'BlueSoldier_Male.gltf', 'BlueSoldier_Female.gltf',
  'Elf.gltf', 'Witch.gltf', 'Wizard.gltf', 'Goblin_Male.gltf', 'Goblin_Female.gltf',
  'Zombie_Male.gltf', 'Zombie_Female.gltf', 'BaseCharacter.gltf',
]
// "nami-lo-que-me-gusta.html" → "Nami lo que me gusta"
const prettyArtifact = (f = '') => {
  const s = f.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : f
}
const avatarLabel = (f) =>
  f.replace('.gltf', '').replace(/_/g, ' ').replace('Female', '♀').replace('Male', '♂')

// Cómo se muestra cada herramienta de Claude en pantalla.
const TOOL_INFO = {
  Read: ['📖', 'leyendo archivos'],
  Glob: ['🔍', 'buscando archivos'],
  Grep: ['🔍', 'buscando en el código'],
  WebSearch: ['🌐', 'buscando en la web'],
  WebFetch: ['🌐', 'consultando la web'],
  Bash: ['💻', 'ejecutando comandos'],
  Edit: ['✍️', 'editando código'],
  Write: ['✍️', 'escribiendo archivos'],
  Task: ['🤖', 'delegando a un agente'],
}
const toolInfo = (name) => TOOL_INFO[name] || ['🔧', `usando ${name}`]

// Opciones del selector: las mismas que ofrece /model en la terminal.
const MODEL_OPTIONS = {
  'claude-opus-5[1m]': 'Opus 5 · 1M',
  'claude-fable-5': 'Fable 5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5': 'Haiku 4.5',
}
// Etiquetas conocidas (superset): IDs heredados de configs viejas también
// muestran nombre bonito, aunque no se ofrezcan como opción.
const MODEL_LABELS = {
  ...MODEL_OPTIONS,
  'claude-opus-5': 'Opus 5',
  'claude-fable-5[1m]': 'Fable 5 · 1M',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}
// "opus" en la terminal es Opus 5 con contexto 1M — mismo mapeo aquí.
const MODEL_ALIASES = {
  opus: 'claude-opus-5[1m]',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5',
  fable1m: 'claude-fable-5[1m]',
}
// El default recomendado de la terminal (sin modelo en settings.json).
const FALLBACK_MODEL = 'claude-opus-5[1m]'

// Etiqueta legible de un modelo: acepta IDs completos y alias, con o sin
// sufijo [1m] ("opus[1m]" — la forma que guarda /model de la terminal).
function modelLabelOf(id) {
  if (!id) return ''
  if (MODEL_LABELS[id]) return MODEL_LABELS[id]
  const oneM = id.endsWith('[1m]')
  const base = oneM ? id.slice(0, -4) : id
  const full = MODEL_ALIASES[base] || base
  const label = (oneM && MODEL_LABELS[`${full}[1m]`]) || MODEL_LABELS[full]
  if (label) return oneM && !label.includes('1M') ? `${label} · 1M` : label
  return id.replace(/^claude-/, '')
}

// El composer es un textarea que crece con el contenido (hasta el máximo del CSS).
const autoGrow = (el) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
function extractOptions(text) {
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

const STANDUP_PROMPT = `Reunión de standup del squad. Responde BREVE (máximo 5 líneas, con viñetas), en tu personaje:
1) ¿En qué trabajamos la última vez?
2) ¿Quedó algo pendiente o bloqueado?
3) ¿Qué sugieres hacer hoy?
Si no tienes contexto previo conmigo en este proyecto, dilo en una línea y sugiere en qué puedes ayudar según tu rol. No uses herramientas salvo que sea imprescindible.`

// A qué miembro va el mensaje: nombre al inicio / @nombre / keywords / principal.
function routeMessage(text, squad, principal) {
  const t = norm(text)
  for (const m of squad) {
    const n = escRe(norm(m.name))
    if (new RegExp(`^${n}\\b`).test(t) || t.includes(`@${norm(m.name)}`)) return m.id
  }
  for (const m of squad) if (m.id !== principal && m.kw?.test(t)) return m.id
  return principal
}

// ¿El mensaje pide pasarle el resultado a otro miembro? ("...y pásaselo a Luffy",
// "Nami -> Luffy: ...", "para que Zoro lo pruebe")
function detectHandoff(text, squad, fromId) {
  const t = norm(text)
  const verb = /(pasal|pasasel|pasa el resultado|entregal|entregasel|entrega el resultado|dasel|dale el resultado|para que|y que)/.test(t)
  for (const m of squad) {
    if (m.id === fromId) continue
    const n = escRe(norm(m.name))
    if (new RegExp(`(?:->|→)\\s*${n}\\b`).test(t)) return m.id
    if (verb && new RegExp(`\\b(?:a|para(?:\\s+que)?|que)\\s+${n}\\b`).test(t)) return m.id
  }
  return null
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('esperándote')
  const [roleStates, setRoleStates] = useState({})
  const [tool, setTool] = useState(null)
  const [input, setInput] = useState('')
  const [cfg, setCfg] = useState(null)
  const [profile, setProfile] = useState('work')
  const [project, setProject] = useState('')
  const [writeMode, setWriteMode] = useState(true)
  const [model, setModel] = useState(FALLBACK_MODEL)
  const [histOpen, setHistOpen] = useState(false)
  const [histList, setHistList] = useState([])
  const [artsOpen, setArtsOpen] = useState(false)
  const [artsList, setArtsList] = useState([])
  const [artsDir, setArtsDir] = useState('')
  const [sound, setSound] = useState(() => localStorage.getItem('oficina-sound') !== '0')
  const [theme, setTheme] = useState('clasico') // se carga por perfil al iniciar/cambiar
  const themeLoaded = useRef(false) // evita machacar el guardado antes de hidratar
  const [board, setBoard] = useState(() => localStorage.getItem('oficina-board') !== '0')
  const [roster, setRoster] = useState([]) // config completa (6 roles)
  const [agentsOpen, setAgentsOpen] = useState(false) // panel 👥 Agentes (squad)
  const [prefsOpen, setPrefsOpen] = useState(false) // panel ⚙️ Configuración
  const [draft, setDraft] = useState([]) // copia editable del roster en el panel Agentes
  const [avatarPicker, setAvatarPicker] = useState(null) // miembro eligiendo personaje
  const [addingRole, setAddingRole] = useState(false) // form "agregar rol" abierto
  const NEW_ROLE = { name: '', focus: '', emoji: '🛠️', color: '#38bdf8', kw: '', avatar: '' }
  const [nr, setNr] = useState(NEW_ROLE) // borrador del rol nuevo
  const [toast, setToast] = useState(null)
  const [appVersion, setAppVersion] = useState('') // pie del menú de Configuración
  const [doneChip, setDoneChip] = useState(null) // "✅ X respondió" transitorio
  const doneChipTimer = useRef(null)
  const [deliverTargets, setDeliverTargets] = useState({}) // a quién camina cada entrega
  const [attachments, setAttachments] = useState([]) // imágenes pegadas/arrastradas
  const [refs, setRefs] = useState([]) // carpetas/archivos del disco arrastrados
  const handoffsRef = useRef([]) // [{from, to, original, result?}]
  const lastJobRef = useRef({}) // role → último job despachado (para Reintentar)
  const queuesRef = useRef({}) // role → [jobs] pendientes cuando está ocupado
  const pendingArtifactRef = useRef({}) // role → true si generó un artifact en este turno
  const toastTimer = useRef(null)
  const sessionsRef = useRef({})
  const convIdRef = useRef(null)
  const logRef = useRef(null)
  const inputRef = useRef(null)

  // squad activo (máx MAX_ACTIVE) con su meta visual; el primero es el principal
  const squad = useMemo(
    () =>
      roster
        .filter((r) => r.enabled)
        .slice(0, MAX_ACTIVE)
        .map((r) => {
          const meta = metaOf(r)
          const url = r.avatar ? `/models/pj/${r.avatar}` : meta.url
          return {
            id: r.id,
            name: r.name,
            ...meta,
            url,
            // los humanos llevan piel natural; goblins/zombies/robot no
            human: !NONHUMAN_AVATARS.has(url.split('/').pop()),
          }
        }),
    [roster]
  )
  const principal = squad[0]?.id || 'dev'
  const principalRef = useRef(principal)
  const squadRef = useRef(squad)
  useEffect(() => {
    principalRef.current = principal
    squadRef.current = squad
  }, [principal, squad])
  const memberOf = (id) => squad.find((m) => m.id === id) || { name: id, emoji: '🤖', color: '#93a6a1', label: id }

  const projects = cfg?.projectsByProfile?.[profile] || []
  const running = Object.keys(roleStates)
  // 'delivering' es la caminata de entrega (cosmética): la respuesta ya llegó,
  // así que no bloquea la UI — historial, config y selectores siguen usables.
  const busy = running.some((r) => roleStates[r] !== 'delivering')
  const setRS = (role, st) =>
    setRoleStates((s) => {
      const copy = { ...s }
      if (st === 'idle') delete copy[role]
      else copy[role] = st
      return copy
    })

  useEffect(() => {
    setSoundEnabled(sound)
    localStorage.setItem('oficina-sound', sound ? '1' : '0')
    window.oficina?.setNotify?.(sound) // también los avisos del sistema
  }, [sound])

  // el tema se guarda POR PERFIL (cada cuenta puede tener el suyo), solo tras hidratar
  useEffect(() => {
    if (!themeLoaded.current) return
    localStorage.setItem(`oficina-theme-${profile}`, theme)
  }, [theme, profile])

  useEffect(() => {
    localStorage.setItem('oficina-board', board ? '1' : '0')
    window.oficina?.setBoard?.(board)
  }, [board])

  const loadSquad = async (p) => {
    const r = (await window.oficina?.squad?.get(p)) || []
    setRoster(r)
  }

  useEffect(() => {
    window.oficina?.artifacts?.getDir?.().then(setArtsDir)
    window.oficina?.getVersion?.().then((v) => setAppVersion(v || ''))
  }, [])

  const refreshArtifacts = async () => setArtsList((await window.oficina?.artifacts?.list?.()) || [])
  // cierra todos los paneles laterales (cada toggle abre el suyo encima)
  const closePanels = () => {
    setHistOpen(false)
    setArtsOpen(false)
    setAgentsOpen(false)
    setPrefsOpen(false)
    setAvatarPicker(null)
  }
  const toggleArts = async () => {
    if (!artsOpen) await refreshArtifacts()
    const next = !artsOpen
    closePanels()
    setArtsOpen(next)
  }
  const pickArtsDir = async () => {
    const res = await window.oficina?.artifacts?.pickDir?.()
    if (res?.ok) {
      setArtsDir(res.dir)
      showToast('📁 carpeta de artifacts actualizada')
    }
  }

  useEffect(() => {
    window.oficina?.getConfig?.().then((c) => {
      setCfg(c)
      const first = c.profiles[0]
      setProfile(first)
      setProject(c.projectsByProfile[first]?.[0]?.path || '')
      setModel(c.defaultModels?.[first] || FALLBACK_MODEL)
      themeLoaded.current = true
      setTheme(localStorage.getItem(`oficina-theme-${first}`) || 'clasico')
      loadSquad(first)
    })
  }, [])

  // Si cambias el modelo por defecto desde la terminal (`/model` en Claude Code),
  // la app lo adopta al volver el foco a su ventana — salvo que aquí hayas
  // elegido otro modelo a mano (tu elección manual gana).
  useEffect(() => {
    const onFocus = async () => {
      const c = await window.oficina?.getConfig?.()
      if (!c) return
      const oldDefault = cfg?.defaultModels?.[profile]
      const newDefault = c.defaultModels?.[profile]
      setCfg(c)
      const followingDefault = oldDefault ? model === oldDefault : model === FALLBACK_MODEL
      if (newDefault && newDefault !== oldDefault && followingDefault) {
        setModel(newDefault)
        showToast(`modelo → ${newDefault} (cambiado desde la terminal)`)
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [cfg, profile, model])

  useEffect(() => {
    if (!window.oficina?.onEvent) return
    return window.oficina.onEvent((e) => {
      const who = e.role || principalRef.current
      const isP = who === principalRef.current
      if (e.kind === 'init') {
        if (e.sessionId) sessionsRef.current[who] = e.sessionId
        if (isP) setStatus('pensando…')
      } else if (e.kind === 'tool') {
        setTool({ role: who, name: e.name, detail: e.detail || null })
        // ¿creó un artifact HTML? marcar para adjuntarlo a su respuesta al terminar
        if (e.name === 'Write' && /\.html?$/i.test(e.detail || '')) {
          pendingArtifactRef.current[who] = true
          setTimeout(refreshArtifacts, 400)
        }
        setRS(who, 'working')
        if (isP) setStatus(`${toolInfo(e.name)[1]}${e.detail ? ` · ${e.detail}` : ''}…`)
      } else if (e.kind === 'text') {
        setTool((t) => (t?.role === who ? null : t))
        setRS(who, 'talking')
        if (isP) setStatus('respondiendo…')
        setMessages((ms) => {
          const idx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && m.streaming)
          if (idx >= 0) {
            const copy = [...ms]
            copy[idx] = { ...copy[idx], text: copy[idx].text + e.text }
            return copy
          }
          return [...ms, { role: 'assistant', who, text: e.text, streaming: true }]
        })
      } else if (e.kind === 'done') {
        setMessages((ms) => {
          const idx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && m.streaming)
          if (idx >= 0) {
            const copy = [...ms]
            copy[idx] = { ...copy[idx], streaming: false }
            return copy
          }
          return e.result ? [...ms, { role: 'assistant', who, text: e.result }] : ms
        })
        // si generó un artifact este turno, adjuntar su enlace al mensaje del agente
        if (pendingArtifactRef.current[who]) {
          delete pendingArtifactRef.current[who]
          window.oficina?.artifacts?.list?.().then((list) => {
            const art = list?.[0]
            if (!art) return
            setMessages((ms) => {
              const idx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && !m.artifact)
              return idx < 0 ? ms : ms.map((m, i) => (i === idx ? { ...m, artifact: art } : m))
            })
          })
        }
        // ¿hay un handoff pendiente de este rol? guardar su resultado
        const entry = handoffsRef.current.find((h) => h.from === who && h.result == null)
        if (entry) entry.result = (e.result || '').slice(0, 6000) || '(sin salida)'
        // el principal solo camina cuando entrega a un compañero; los demás siempre
        setRS(who, isP && !entry ? 'idle' : 'delivering')
        // si entrega a un compañero, camina hacia ÉL (no hacia el principal)
        if (entry) setDeliverTargets((d) => ({ ...d, [who]: entry.to }))
        setTool((t) => (t?.role === who ? null : t))
        dingSound()
        window.oficina?.refreshUsage?.() // el % de uso quedó desactualizado tras el turno
        // chip transitorio anunciando la respuesta final
        const doneName = squadRef.current.find((m) => m.id === who)?.name || who
        setDoneChip(`✅ ${doneName} respondió`)
        clearTimeout(doneChipTimer.current)
        doneChipTimer.current = setTimeout(() => setDoneChip(null), 3500)
        if (isP) setStatus('esperándote')
      } else if (e.kind === 'stopped') {
        // tarea cancelada: quita la respuesta a medias y marca tu mensaje como cancelado
        setMessages((ms) => {
          const aIdx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && m.streaming)
          let out = aIdx < 0 ? ms : ms.filter((_, i) => i !== aIdx)
          const uIdx = out.findLastIndex((m) => m.role === 'user' && m.to === who && !m.cancelled)
          if (uIdx >= 0) out = out.map((m, i) => (i === uIdx ? { ...m, cancelled: true } : m))
          return out
        })
        handoffsRef.current = handoffsRef.current.filter((h) => !(h.from === who && h.result == null))
        setRS(who, 'idle')
        setTool((t) => (t?.role === who ? null : t))
        buzzSound()
        const name = squadRef.current.find((m) => m.id === who)?.name || who
        setToast(`⏹ ${name}: tarea cancelada`)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 3500)
        if (isP) setStatus('esperándote')
      } else if (e.kind === 'error') {
        // el stderr (si vino) se muestra como bloque de código en el mensaje
        const text = e.detail ? `⚠️ ${e.message}\n\n\`\`\`\n${e.detail}\n\`\`\`` : `⚠️ ${e.message}`
        setMessages((ms) => [...ms, { role: 'assistant', who, text, error: true }])
        setRS(who, 'idle')
        setTool((t) => (t?.role === who ? null : t))
        buzzSound()
        if (isP) setStatus('esperándote')
      }
    })
  }, [])

  // Auto-scroll del chat SOLO si ya estabas pegado al fondo: si subiste a
  // releer, el streaming no te arrastra de vuelta. Volver abajo re-engancha.
  const atBottomRef = useRef(true)
  const onLogScroll = () => {
    const el = logRef.current
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }
  useEffect(() => {
    if (atBottomRef.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages])

  // Watchdog: una entrega normal (caminar, entregar, volver) toma <20s. Si la
  // escena 3D se atasca por cualquier razón y onTourDone nunca llega, el rol
  // no puede quedarse en 'delivering' indefinidamente — a los 30s se libera.
  useEffect(() => {
    const delivering = running.filter((r) => roleStates[r] === 'delivering')
    if (!delivering.length) return
    const t = setTimeout(() => {
      delivering.forEach((r) => setRS(r, 'idle'))
      setDeliverTargets((d) => {
        const copy = { ...d }
        delivering.forEach((r) => delete copy[r])
        return copy
      })
    }, 30_000)
    return () => clearTimeout(t)
  }, [roleStates])

  // Despachador de handoffs: cuando el destinatario está libre, le llega el
  // trabajo del compañero (su sesión arranca con el resultado como contexto).
  useEffect(() => {
    const ready = handoffsRef.current.filter((h) => h.result != null)
    for (const h of ready) {
      if (roleStates[h.to]) continue // ocupado: la entrega espera su turno
      handoffsRef.current = handoffsRef.current.filter((x) => x !== h)
      const from = memberOf(h.from)
      const to = memberOf(h.to)
      setMessages((ms) => [...ms, { role: 'system', text: `🤝 ${from.name} le pasa el trabajo a ${to.name}` }])
      setRS(h.to, 'listening')
      popSound()
      window.oficina
        ?.ask({
          prompt: `${from.name} (${from.label}) del squad te entrega el resultado de su trabajo para que tú continúes con tu parte.\n\nInstrucción original del usuario: "${h.original}"\n\nResultado de ${from.name}:\n"""\n${h.result}\n"""\n\nContinúa a partir de esto según tu rol.`,
          profile,
          cwd: project,
          writeMode,
          model,
          role: h.to,
        })
        .then((res) => {
          if (!res?.ok) {
            setRS(h.to, 'idle')
            showToast(`⚠️ ${res?.error || 'no se pudo entregar'}`)
          }
        })
    }
  }, [roleStates, profile, project, writeMode, model, squad])

  // Procesador de cola: cuando un tripulante queda libre, toma su siguiente
  // mensaje en cola (como la consola: se procesa al terminar el turno actual).
  useEffect(() => {
    for (const role of Object.keys(queuesRef.current)) {
      const q = queuesRef.current[role]
      if (q?.length && !roleStates[role]) {
        dispatchJob(q.shift())
      }
    }
  }, [roleStates, profile, project, writeMode, model])

  // Atajos: ⌘K nueva · ⌘1-⌘6 miembro del squad · ⌘Y historial · Esc cierra paneles
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // por capas: primero el submenu de Agentes; Configuración queda debajo
        if (agentsOpen) closeAgents()
        else closePanels()
        return
      }
      if (!e.metaKey) return
      if (e.key === 'k') {
        e.preventDefault()
        newChat()
      } else if (e.key === 'y') {
        e.preventDefault()
        toggleHist()
      } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= squad.length) {
        // un atajo por miembro activo (hasta MAX_ACTIVE)
        e.preventDefault()
        const m = squad[Number(e.key) - 1]
        if (!m) return
        setInput((v) => `${m.name}, ${v.replace(/^\S+,\s*/, '')}`)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // histOpen: toggleHist lo lee antes de abrir · agentsOpen: Esc por capas
  }, [squad, histOpen, agentsOpen])

  // ── Imágenes adjuntas (pegar ⌘V o arrastrar) ─────────────────────────────
  const addImageFile = async (file) => {
    if (!file || !file.type?.startsWith('image/')) return
    const buf = new Uint8Array(await file.arrayBuffer())
    const res = await window.oficina?.saveImage?.(file.name || 'imagen.png', buf)
    if (res?.ok) {
      setAttachments((a) => [...a, { path: res.path, name: file.name || res.path.split('/').pop() }])
      popSound()
    }
  }
  const handlePaste = (e) => {
    for (const item of e.clipboardData?.items || []) {
      if (item.type?.startsWith('image/')) {
        e.preventDefault()
        addImageFile(item.getAsFile())
      }
    }
  }
  const handleDrop = async (e) => {
    e.preventDefault()
    for (const f of e.dataTransfer?.files || []) {
      if (f.type?.startsWith('image/')) {
        addImageFile(f)
        continue
      }
      // carpeta o archivo del disco → lo pasamos por ruta (el agente lo lee)
      const p = window.oficina?.pathForFile?.(f)
      if (!p) continue
      const info = await window.oficina?.pathInfo?.(p)
      if (!info?.ok) continue
      setRefs((r) => (r.some((x) => x.path === p) ? r : [...r, info]))
      popSound()
    }
  }

  // aviso transitorio: aparece y se desvanece solo (no ensucia el chat)
  const showToast = (text, ms = 3500) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }

  // Descarta todo lo pendiente de la conversación actual: mensajes en cola y
  // handoffs a medias no deben dispararse dentro de la conversación siguiente.
  const clearConversation = () => {
    setMessages([])
    convIdRef.current = null
    sessionsRef.current = {}
    queuesRef.current = {}
    handoffsRef.current = []
    window.oficina?.reset?.()
  }

  const newChat = () => {
    clearConversation()
    showToast('conversación nueva ✨')
  }

  const changeProfile = (e) => {
    const p = e.target.value
    setProfile(p)
    setProject(cfg?.projectsByProfile?.[p]?.[0]?.path || '')
    setModel(cfg?.defaultModels?.[p] || FALLBACK_MODEL)
    setTheme(localStorage.getItem(`oficina-theme-${p}`) || 'clasico') // tema por cuenta
    clearConversation()
    window.oficina?.refreshUsage?.() // refrescar el % de uso al cambiar de cuenta
    loadSquad(p) // cada cuenta tiene su squad
  }
  const changeProject = (e) => {
    setProject(e.target.value)
    clearConversation()
  }

  // ── Submenu 👥 Agentes: se abre ENCIMA de Configuración (que queda debajo
  // y sigue abierta al cerrarlo) ────────────────────────────────────────────
  const openAgents = () => {
    setDraft(roster.map((r) => ({ ...r })))
    setAvatarPicker(null)
    setAgentsOpen(true)
  }
  const closeAgents = () => {
    setAgentsOpen(false)
    setAvatarPicker(null)
  }
  // ── Panel ⚙️ Configuración (preferencias + acceso a Agentes) ─────────────
  const openPrefs = () => {
    const wasOpen = prefsOpen
    closePanels()
    if (!wasOpen) setPrefsOpen(true)
  }
  const draftEnabled = draft.filter((r) => r.enabled).length
  const toggleMember = (id) =>
    setDraft((d) =>
      d.map((r) => {
        if (r.id !== id) return r
        if (r.enabled && draftEnabled <= 1) return r // mínimo 1
        if (!r.enabled && draftEnabled >= MAX_ACTIVE) return r // máximo MAX_ACTIVE
        return { ...r, enabled: !r.enabled }
      })
    )
  const renameMember = (id, name) => setDraft((d) => d.map((r) => (r.id === id ? { ...r, name } : r)))
  const setMemberAvatar = (id, avatar) => setDraft((d) => d.map((r) => (r.id === id ? { ...r, avatar: avatar || null } : r)))
  // avatar efectivo de un miembro (elegido o el default de su rol)
  const effectiveAvatar = (r) => r.avatar || metaOf(r).url.split('/').pop()
  // modelos ya ocupados por OTROS miembros activos (no se pueden repetir)
  const takenAvatars = (selfId) =>
    new Set(draft.filter((r) => r.enabled && r.id !== selfId).map((r) => effectiveAvatar(r)))
  // Crea un rol personalizado (deshabilitado; el usuario lo activa y guarda).
  const addRole = () => {
    const name = nr.name.trim()
    if (!name) {
      showToast('⚠️ ponle un nombre al rol')
      return
    }
    const avatar = nr.avatar || AVATARS.find((a) => !draft.some((r) => effectiveAvatar(r) === a)) || AVATARS[0]
    const role = {
      id: `custom-${Date.now()}`,
      name,
      enabled: false,
      custom: true,
      avatar,
      focus: nr.focus.trim(),
      emoji: (nr.emoji || '🛠️').slice(0, 2),
      color: nr.color || '#38bdf8',
      hair: '#1f2937',
      kw: nr.kw.trim(),
    }
    setDraft((d) => [...d, role])
    setNr(NEW_ROLE)
    setAddingRole(false)
    showToast(`rol "${name}" creado — actívalo y guardá`)
  }
  const deleteRole = (id) => setDraft((d) => d.filter((r) => !(r.id === id && canDelete(r))))

  const saveSquad = async () => {
    const clean = draft.map((r) => ({ ...r, name: r.name.trim() || metaOf(r).label }))
    // sin personajes duplicados entre los activos
    const active = clean.filter((r) => r.enabled)
    if (new Set(active.map(effectiveAvatar)).size !== active.length) {
      showToast('⚠️ dos miembros tienen el mismo personaje — elige otro')
      return
    }
    await window.oficina?.squad?.save(profile, clean)
    setRoster(clean)
    setAgentsOpen(false)
    showToast(
      `squad actualizado: ${clean
        .filter((r) => r.enabled)
        .slice(0, MAX_ACTIVE)
        .map((r) => `${metaOf(r).emoji} ${r.name}`)
        .join(' · ')}`
    )
  }

  // ── Historial ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (busy || !messages.length || !convIdRef.current) return
    const title = messages.find((m) => m.role === 'user')?.text.slice(0, 60) || 'conversación'
    window.oficina?.history?.save({
      id: convIdRef.current,
      title,
      profile,
      project,
      model,
      sessions: { ...sessionsRef.current },
      updatedAt: Date.now(),
      messages: messages.map(({ role, text, who, to, artifact, atts }) => ({ role, text, who, to, artifact, atts })),
    })
  }, [busy, messages, profile, project, model])

  const toggleHist = async () => {
    if (!histOpen) setHistList((await window.oficina?.history?.list()) || [])
    const next = !histOpen
    closePanels()
    setHistOpen(next)
  }

  const loadConvo = async (id) => {
    if (busy) return
    const c = await window.oficina?.history?.get(id)
    if (!c) return
    convIdRef.current = c.id
    if (c.profile && cfg?.profiles?.includes(c.profile)) {
      setProfile(c.profile)
      loadSquad(c.profile)
    }
    if (c.project) setProject(c.project)
    if (c.model) setModel(c.model)
    const saved = c.sessions || (c.sessionId ? { dev: c.sessionId } : {})
    sessionsRef.current = { ...saved }
    setMessages(c.messages || [])
    await window.oficina?.setSession?.({ sessions: saved, profile: c.profile, cwd: c.project })
    setHistOpen(false)
    showToast(Object.keys(saved).length ? 'retomada — recordamos todo 🧠' : 'conversación cargada')
  }

  const deleteConvo = async (e, id) => {
    e.stopPropagation()
    await window.oficina?.history?.remove(id)
    if (id === convIdRef.current) newChat()
    setHistList((await window.oficina?.history?.list()) || [])
  }

  // ── Comandos locales ─────────────────────────────────────────────────────
  const handleLocalCommand = (text) => {
    const [cmd, ...rest] = text.split(/\s+/)
    if (cmd === '/model') {
      const arg = rest[0]?.toLowerCase()
      if (!arg) {
        showToast(`modelo actual: ${modelLabelOf(model)} · usa /model opus | fable | sonnet | haiku`)
        return true
      }
      const resolved = MODEL_ALIASES[arg] ?? arg
      setModel(resolved)
      showToast(`modelo → ${modelLabelOf(resolved)}`)
      return true
    }
    if (cmd === '/clear' || cmd === '/nueva') {
      newChat()
      return true
    }
    if (cmd === '/squad') {
      showToast(squad.map((m) => `${m.emoji} ${m.name} — ${m.label}`).join('  ·  '))
      return true
    }
    if (cmd === '/standup') {
      const free = squad.filter((m) => !roleStates[m.id])
      if (!free.length) {
        showToast('todo el squad está ocupado — intenta en un momento')
        return true
      }
      if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
      setMessages((ms) => [...ms, { role: 'system', text: `📋 Standup diario — reporta el squad (${free.map((m) => m.name).join(', ')})` }])
      popSound()
      // cada uno retoma su última sesión en este proyecto y reporta (en paralelo)
      free.forEach((m, i) => {
        setTimeout(() => {
          setRS(m.id, 'listening')
          window.oficina
            ?.ask({ prompt: STANDUP_PROMPT, profile, cwd: project, writeMode: false, model, role: m.id, standup: true })
            .then((res) => {
              if (!res?.ok) setRS(m.id, 'idle')
            })
        }, i * 600)
      })
      return true
    }
    return false
  }

  // Lanza un job a su tripulante (o lo ENCOLA si está ocupado — como la consola).
  const enqueueJob = (job) => {
    setMessages((ms) => [...ms, { role: 'user', text: job.display, to: job.target, atts: job.atts, jobId: job.id, queued: true }])
    ;(queuesRef.current[job.target] ||= []).push(job)
    showToast(`⏳ en cola para ${memberOf(job.target).name}`)
  }
  const dispatchJob = async (job) => {
    lastJobRef.current[job.target] = job // para el botón Reintentar tras un error
    if (job.handoffTo) handoffsRef.current.push({ from: job.target, to: job.handoffTo, original: job.text, result: null })
    setMessages((ms) => {
      const has = ms.some((m) => m.jobId === job.id)
      const cleared = ms.map((m) => (m.jobId === job.id ? { ...m, queued: false } : m))
      return has ? cleared : [...cleared, { role: 'user', text: job.display, to: job.target, atts: job.atts, jobId: job.id }]
    })
    setRS(job.target, 'listening')
    popSound()
    if (job.target === principal) setStatus('pensando…')
    const res = await window.oficina.ask({ prompt: job.prompt, profile, cwd: project, writeMode, model, role: job.target, standup: job.standup })
    if (!res?.ok) {
      setMessages((ms) => [...ms, { role: 'assistant', who: job.target, text: `⚠️ ${res?.error || 'error desconocido'}` }])
      setRS(job.target, 'idle')
      if (job.target === principal) setStatus('esperándote')
    }
  }
  // sitúa un job: si el tripulante está libre y sin cola → va; si no → encola
  const routeJob = (job) => {
    atBottomRef.current = true // enviar algo re-engancha el auto-scroll
    const busyOrQueued = !!roleStates[job.target] || (queuesRef.current[job.target]?.length > 0)
    if (busyOrQueued) enqueueJob(job)
    else dispatchJob(job)
  }

  // Reintenta el último job de un rol (tras un error).
  const retryJob = (who) => {
    const job = lastJobRef.current[who]
    if (job) routeJob({ ...job, id: crypto.randomUUID() })
  }

  // Respuesta rápida: envía una opción elegida al tripulante (encola si ocupado).
  const quickReply = (option, target) => {
    if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
    routeJob({ id: crypto.randomUUID(), target, text: option, display: option, prompt: option, atts: [] })
  }

  const send = (ev) => {
    ev.preventDefault()
    const text = input.trim()
    if (!text && !attachments.length && !refs.length) return
    if (text.startsWith('/') && handleLocalCommand(text)) {
      setInput('')
      return
    }
    if (!window.oficina?.ask) {
      showToast('sin Electron — corre npm run dev')
      return
    }
    const target = routeMessage(text, squad, principal)
    if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
    const handoffTo = detectHandoff(text, squad, target)
    // adjuntos: imágenes (Read) y carpetas/archivos del disco (Glob/Read)
    const atts = attachments
    const rfs = refs
    let prompt = text || (rfs.length ? 'Haz un breve resumen de los documentos.' : 'Describe y analiza las imágenes adjuntas.')
    if (rfs.length) {
      const list = rfs.map((r) => `- ${r.isDir ? '📁 carpeta' : '📄 archivo'}: ${r.path}`).join('\n')
      prompt = `Tengo estos elementos en mi disco (léelos con Glob para listar y Read para su contenido; en carpetas revisa los documentos que haya):\n${list}\n\n${prompt}`
    }
    if (atts.length) {
      prompt = `He adjuntado ${atts.length} imagen(es). Léelas con la herramienta Read:\n${atts.map((a) => `- ${a.path}`).join('\n')}\n\n${prompt}`
    }
    routeJob({
      id: crypto.randomUUID(),
      target,
      text,
      display: text || (rfs.length ? '📁' : '🖼'),
      prompt,
      handoffTo,
      atts: [...atts.map((a) => a.name), ...rfs.map((r) => r.name)],
    })
    setInput('')
    setAttachments([])
    setRefs([])
    if (inputRef.current) inputRef.current.style.height = 'auto' // vuelve a 1 línea
  }

  return (
    <div className="app" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      <header className="hud">
        <span className="dot" />
        <b>LA OFICINA</b>
        <select className="sel" value={profile} onChange={changeProfile} disabled={busy} title="Perfil de Claude">
          {(cfg?.profiles || []).map((p) => (
            <option key={p} value={p}>
              {p === 'work' ? '💼 work' : p === 'private' ? '🔒 private' : '🧑 mi cuenta'}
            </option>
          ))}
        </select>
        <select className="sel" value={project} onChange={changeProject} disabled={busy} title="Proyecto (cwd)">
          {projects.map((p) => (
            <option key={p.path} value={p.path}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className="newchat" onClick={toggleArts} title="Artifacts creados por el squad">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
          </svg>
          Artifacts
        </button>
        <button type="button" className="newchat" onClick={toggleHist} disabled={busy} title="Historial (⌘Y)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          Historial
        </button>
        <button type="button" className="newchat" onClick={newChat} disabled={busy} title="Conversación nueva (⌘K)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            <line x1="12" y1="8" x2="12" y2="14" />
            <line x1="9" y1="11" x2="15" y2="11" />
          </svg>
          Nueva Conversación
        </button>
        <button type="button" className="gear" onClick={openPrefs} disabled={busy} title="Modelo, permisos, notificaciones y agentes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Configuración
        </button>
      </header>

      <div className="stage">
        <SysMonitor profile={profile} modelLabel={modelLabelOf(model)} />
        <Office
          roleStates={roleStates}
          status={status}
          squad={squad}
          theme={theme}
          tool={tool}
          deliverTargets={deliverTargets}
          onTourDone={(r) => {
            setRS(r, 'idle')
            setDeliverTargets((d) => {
              const copy = { ...d }
              delete copy[r]
              return copy
            })
          }}
        />

        {prefsOpen && (
          <div className="drawer">
            <div className="drawer-head">
              <b>⚙️ Configuración</b>
              <button onClick={() => setPrefsOpen(false)}>✕</button>
            </div>

            {/* navegación: filas de menú (ícono · label · chevron) */}
            <div className="menu-group">
              <button type="button" className="menu-item" onClick={openAgents}>
                <span className="mi-icon">👥</span>
                <span className="mi-label">Agentes</span>
                <span className="mi-hint">{squad.length} activos</span>
                <span className="mi-chev">›</span>
              </button>
              <button type="button" className="menu-item" onClick={() => window.oficina?.openHelp?.()}>
                <span className="mi-icon">📖</span>
                <span className="mi-label">Guía de uso</span>
                <span className="mi-chev">›</span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={async () => {
                  const res = await window.oficina?.openTerminal?.(project)
                  showToast(res?.ok ? `🖥 abriendo ${res.app}…` : '⚠️ no pude abrir la terminal')
                }}
              >
                <span className="mi-icon">🖥</span>
                <span className="mi-label">Abrir terminal en el proyecto</span>
                <span className="mi-chev">›</span>
              </button>
            </div>

            {/* preferencias — aplican al instante */}
            <div className="menu-sec">Preferencias</div>
            <div className="menu-group">
            <div className="pref-row">
              <span className="pref-label">Modelo:</span>
              <select className="sel pref-sel" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
                {[...new Set([model, ...Object.keys(MODEL_OPTIONS)])].map((id) => (
                  <option key={id} value={id}>
                    {modelLabelOf(id)}
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">Permiso:</span>
              <select
                className="sel pref-sel"
                value={writeMode ? 'write' : 'read'}
                onChange={(e) => setWriteMode(e.target.value === 'write')}
                disabled={busy}
              >
                <option value="write">✏️ edición — puede modificar y correr comandos</option>
                <option value="read">🔒 lectura — solo investigar</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">Tema:</span>
              <select className="sel pref-sel" value={theme} onChange={(e) => setTheme(e.target.value)}>
                {Object.entries(THEMES).map(([id, t]) => (
                  <option key={id} value={id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">Artifacts:</span>
              <button type="button" className="pref-toggle" onClick={pickArtsDir} title={artsDir}>
                📁 …{artsDir.slice(-30) || 'carpeta por defecto'}
              </button>
            </div>
            <div className="pref-row">
              <span className="pref-label">Pizarra:</span>
              <button
                type="button"
                className={board ? 'pref-toggle on' : 'pref-toggle'}
                onClick={() => setBoard((b) => !b)}
                title="Memoria común del squad en SQUAD.md (leen y anotan lo importante)"
              >
                {board ? '🧠 SQUAD.md activa' : '🧠 desactivada'}
              </button>
              <button
                type="button"
                className="newchat"
                style={{ flex: 'none' }}
                onClick={async () => {
                  const res = await window.oficina?.openBoard?.(project)
                  showToast(res?.ok ? '🧠 abriendo SQUAD.md…' : '⚠️ reinicia la app (npm run dev)')
                }}
                title="Ver/editar SQUAD.md del proyecto"
              >
                abrir
              </button>
            </div>
            <div className="pref-row">
              <span className="pref-label">Notificaciones:</span>
              <button
                type="button"
                className={sound ? 'pref-toggle on' : 'pref-toggle'}
                onClick={() => setSound((s) => !s)}
                title={sound ? 'Apagar sonidos y avisos' : 'Encender sonidos y avisos'}
              >
                {sound ? '🔔 encendidas' : '🔕 apagadas'}
              </button>
            </div>
            </div>

            <div className="menu-foot">La Oficina{appVersion ? ` · v${appVersion}` : ''}</div>
          </div>
        )}

        {agentsOpen && (
          <div className="drawer over">
            <div className="drawer-head">
              <b>👥 Agentes</b>
              <button onClick={closeAgents} title="Volver a Configuración">✕</button>
            </div>
            <div className="drawer-sep agents-sub">Squad · hasta {MAX_ACTIVE} activos · el 1º es el principal ({profile})</div>
            {draft.map((r) => (
              <div key={r.id} className={r.enabled ? 'squad-row' : 'squad-row off'}>
                <div className="squad-row-top">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => toggleMember(r.id)}
                    title={r.enabled ? 'Desactivar' : 'Activar'}
                  />
                  <span className="squad-emoji">{metaOf(r).emoji}</span>
                  <input
                    className="squad-name"
                    value={r.name}
                    maxLength={16}
                    onChange={(e) => renameMember(r.id, e.target.value)}
                    style={{ borderColor: r.enabled ? metaOf(r).color : undefined }}
                  />
                  <span className="squad-label">{r.custom ? 'personalizado' : metaOf(r).label}</span>
                  {canDelete(r) && (
                    <button
                      type="button"
                      className="squad-del"
                      onClick={() => deleteRole(r.id)}
                      title={r.custom ? 'Eliminar este rol personalizado' : 'Eliminar este rol'}
                    >
                      🗑️
                    </button>
                  )}
                </div>
                {r.enabled && (
                  <div className="squad-actions">
                    <button
                      type="button"
                      className={avatarPicker === r.id ? 'squad-avatar-btn open' : 'squad-avatar-btn'}
                      onClick={() => setAvatarPicker((p) => (p === r.id ? null : r.id))}
                    >
                      🧍 {avatarLabel(effectiveAvatar(r))}
                    </button>
                    <button
                      type="button"
                      className="squad-avatar-btn"
                      onClick={() => window.oficina?.openPersona?.(profile, r.id, r.name)}
                      title="Editar la personalidad de este personaje (.md)"
                    >
                      ✏️ personalidad
                    </button>
                  </div>
                )}
              </div>
            ))}
            {addingRole ? (
              <div className="add-role">
                <input
                  className="add-role-in"
                  placeholder="Nombre (ej: Traductor)"
                  value={nr.name}
                  maxLength={16}
                  onChange={(e) => setNr((v) => ({ ...v, name: e.target.value }))}
                />
                <input
                  className="add-role-in"
                  placeholder="Foco / especialidad (ej: traducir textos ES↔EN)"
                  value={nr.focus}
                  onChange={(e) => setNr((v) => ({ ...v, focus: e.target.value }))}
                />
                <input
                  className="add-role-in"
                  placeholder="Palabras clave de ruteo (traduce, translate)"
                  value={nr.kw}
                  onChange={(e) => setNr((v) => ({ ...v, kw: e.target.value }))}
                />
                <div className="add-role-row">
                  <input
                    className="add-role-emoji"
                    placeholder="🛠️"
                    value={nr.emoji}
                    maxLength={2}
                    onChange={(e) => setNr((v) => ({ ...v, emoji: e.target.value }))}
                  />
                  <input
                    type="color"
                    className="add-role-color"
                    value={nr.color}
                    onChange={(e) => setNr((v) => ({ ...v, color: e.target.value }))}
                    title="Color del nametag/globo"
                  />
                  <select
                    className="add-role-avatar"
                    value={nr.avatar}
                    onChange={(e) => setNr((v) => ({ ...v, avatar: e.target.value }))}
                    title="Personaje 3D"
                  >
                    <option value="">Personaje (auto)</option>
                    {AVATARS.map((a) => (
                      <option key={a} value={a}>
                        {avatarLabel(a)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="add-role-actions">
                  <button type="button" className="add-role-ok" onClick={addRole}>
                    Crear rol
                  </button>
                  <button type="button" className="add-role-cancel" onClick={() => (setAddingRole(false), setNr(NEW_ROLE))}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button className="squad-add" type="button" onClick={() => setAddingRole(true)}>
                ➕ Agregar rol
              </button>
            )}
            <button className="squad-save" onClick={saveSquad}>
              Guardar squad ({draftEnabled}/{MAX_ACTIVE})
            </button>
          </div>
        )}

        {agentsOpen &&
          avatarPicker &&
          (() => {
            const r = draft.find((x) => x.id === avatarPicker)
            if (!r) return null
            const taken = takenAvatars(r.id)
            const current = effectiveAvatar(r)
            return (
              <div className="drawer right">
                <div className="drawer-head">
                  <b>🧍 Personaje de {r.name}</b>
                  <button onClick={() => setAvatarPicker(null)}>✕</button>
                </div>
                <div className="avatar-grid">
                  {AVATARS.map((a) => {
                    const isTaken = taken.has(a)
                    const sel = current === a
                    return (
                      <div
                        key={a}
                        className={`avatar-card${sel ? ' sel' : ''}${isTaken ? ' taken' : ''}`}
                        onClick={() => !isTaken && setMemberAvatar(r.id, a)}
                        title={isTaken ? 'En uso por otro miembro' : avatarLabel(a)}
                      >
                        <AvatarThumb file={a} />
                        <div className="avatar-name">
                          {avatarLabel(a)}
                          {isTaken ? ' 🔒' : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

        {artsOpen && (
          <div className="drawer">
            <div className="drawer-head">
              <b>🔗 Artifacts</b>
              <button onClick={() => setArtsOpen(false)}>✕</button>
            </div>
            {artsList.length === 0 && <div className="hist-empty">aún no hay artifacts · pídele uno a un agente</div>}
            {artsList.map((a) => (
              <div key={a.path} className="hist-item art-item">
                <div onClick={() => window.oficina?.artifacts?.open?.(a.path)} style={{ cursor: 'pointer' }}>
                  <div className="hist-title">🔗 {prettyArtifact(a.name)}</div>
                  <div className="hist-meta">
                    {a.at ? new Date(a.at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </div>
                <div className="art-actions">
                  <button onClick={() => window.oficina?.artifacts?.reveal?.(a.path)} title="Revelar en Finder">📂</button>
                  <button
                    onClick={async () => {
                      const r = await window.oficina?.artifacts?.zip?.(a.path)
                      showToast(r?.ok ? '📦 zip exportado' : '⚠️ exportación cancelada')
                    }}
                    title="Exportar como .zip (con imágenes) para compartir"
                  >
                    📦
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {histOpen && (
          <div className="drawer">
            <div className="drawer-head">
              <b>Historial</b>
              <button onClick={() => setHistOpen(false)}>✕</button>
            </div>
            {histList.length === 0 && <div className="hist-empty">sin conversaciones guardadas</div>}
            {histList.map((h) => (
              <div key={h.id} className="hist-item" onClick={() => loadConvo(h.id)}>
                <div className="hist-title">{h.title}</div>
                <div className="hist-meta">
                  {h.profile === 'work' ? '💼' : '🔒'} {h.project?.split('/').pop()} · {h.count} msgs ·{' '}
                  {h.updatedAt
                    ? new Date(h.updatedAt).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : ''}
                </div>
                <button className="hist-del" title="Borrar" onClick={(e) => deleteConvo(e, h.id)}>
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}

        {toast && (
          <div className="toast" key={toast}>
            {toast}
          </div>
        )}

        {/* chips para detener a quien esté trabajando */}
        {running.filter((r) => roleStates[r] !== 'delivering').length > 0 && (
          <div className="stopbar">
            {running
              .filter((r) => roleStates[r] !== 'delivering')
              .map((r) => (
                <button key={r} className="stopchip" onClick={() => window.oficina?.stop?.(r)} title={`Detener a ${memberOf(r).name}`}>
                  ⏹ {memberOf(r).name}
                </button>
              ))}
          </div>
        )}

        {doneChip && (
          <div className="toolchip" key={doneChip}>
            {doneChip}
          </div>
        )}

        {messages.length > 0 && (
          <div className="chat" ref={logRef} onScroll={onLogScroll}>
            {messages.map((m, i) => {
              // botones de respuesta rápida: solo en el último mensaje del asistente,
              // ya terminado, si detecto un menú de opciones y nadie está ocupado
              const isLastAssistant =
                m.role === 'assistant' && !m.streaming && i === messages.length - 1 && !busy
              const options = isLastAssistant ? extractOptions(m.text) : []
              return (
              <div key={i} className={`msg ${m.role}`}>
                {m.role === 'assistant' && m.who && (
                  <div className="who" style={{ color: memberOf(m.who).color }}>
                    {memberOf(m.who).emoji} {memberOf(m.who).name}
                  </div>
                )}
                {m.role === 'user' && m.to && m.to !== principal && <div className="who to">→ {memberOf(m.to).name}</div>}
                {m.role === 'user' && m.queued && <div className="who to">⏳ en cola</div>}
                {m.role === 'user' && m.cancelled && <div className="who to">⏹ cancelado</div>}
                {m.role === 'user' && m.atts?.length > 0 && (
                  <div className="msg-atts">{m.atts.map((n, j) => <span key={j}>🖼 {n}</span>)}</div>
                )}
                {m.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown> : m.text}
                {m.streaming ? '▍' : ''}
                {m.artifact && (
                  <button className="artifact-btn" onClick={() => window.oficina?.artifacts?.open?.(m.artifact.path)}>
                    🔗 Abrir · {prettyArtifact(m.artifact.name)}
                  </button>
                )}
                {m.error && lastJobRef.current[m.who] && i === messages.findLastIndex((x) => x.who === m.who) && (
                  <button className="artifact-btn" onClick={() => retryJob(m.who)}>
                    🔁 Reintentar
                  </button>
                )}
                {options.length > 0 && (
                  <div className="quickreplies">
                    {options.map((opt, j) => (
                      <button key={j} onClick={() => quickReply(opt, m.who)} title={opt}>
                        {opt.length > 42 ? opt.slice(0, 40) + '…' : opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )
            })}
          </div>
        )}
      </div>

      {(attachments.length > 0 || refs.length > 0) && (
        <div className="attachbar">
          {attachments.map((a, i) => (
            <span key={a.path} className="attachchip">
              🖼 {a.name}
              <button type="button" onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
          {refs.map((r, i) => (
            <span key={r.path} className="attachchip">
              {r.isDir ? '📁' : '📄'} {r.name}
              <button type="button" onClick={() => setRefs((arr) => arr.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}

      <form className="composer" onSubmit={send}>
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          onPaste={handlePaste}
          onChange={(e) => {
            setInput(e.target.value)
            autoGrow(e.target)
          }}
          onKeyDown={(e) => {
            // Enter envía; Shift+Enter inserta salto de línea
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.target.form?.requestSubmit()
            }
          }}
          placeholder={
            busy
              ? `${running.map((r) => memberOf(r).name).join(', ')} trabajando… (puedes pedirle algo a otro)`
              : squad.length > 1
                ? `Escríbele al squad… (ej: "${memberOf(squad[1]?.id).name}, ayúdame con…" · ⌘1-${squad.length})`
                : 'Escríbele a tu asistente…'
          }
          autoFocus
        />
        <button type="submit">Enviar</button>
      </form>
    </div>
  )
}
