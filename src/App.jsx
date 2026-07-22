import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Office from './Office.jsx'
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

function SysMonitor({ modelLabel }) {
  const [s, setS] = useState(null)
  useEffect(() => {
    let on = true
    const tick = async () => {
      const d = await window.oficina?.stats?.()
      if (on && d) setS(d)
    }
    tick()
    const iv = setInterval(tick, 3000)
    return () => {
      on = false
      clearInterval(iv)
    }
  }, [])
  if (!s) return null
  const gb = (b) => (b / 1073741824).toFixed(1)
  const ramPct = (s.ramUsed / s.ramTotal) * 100
  return (
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
      {s.claude && (s.claude.session || s.claude.weekly) && (
        <>
          <div className="mon-title">
            <ClaudeIcon /> claude
          </div>
          {modelLabel && (
            <div className="mon-row">
              <span>Modelo</span>
              <span className="mon-model">{modelLabel}</span>
            </div>
          )}
          {s.claude.session && (
            <>
              <div className="mon-row">
                <span>Sesión</span>
                <Bar pct={s.claude.session.pct} />
                <b>{Math.round(s.claude.session.pct)}%</b>
              </div>
              <div className="mon-sub">resetea en {fmtReset(s.claude.session.resetsAt)}</div>
            </>
          )}
          {s.claude.weekly && (
            <>
              <div className="mon-row">
                <span>Semana</span>
                <Bar pct={s.claude.weekly.pct} />
                <b>{Math.round(s.claude.weekly.pct)}%</b>
              </div>
              <div className="mon-sub">resetea en {fmtReset(s.claude.weekly.resetsAt)}</div>
            </>
          )}
        </>
      )}
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
}

const MAX_ACTIVE = 4

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

// Modelos disponibles para --model (siempre explícito, IDs completos).
const MODEL_LABELS = {
  'claude-fable-5[1m]': 'Fable 5 · 1M',
  'claude-fable-5': 'Fable 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}
const MODEL_ALIASES = {
  fable: 'claude-fable-5',
  fable1m: 'claude-fable-5[1m]',
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
}
const FALLBACK_MODEL = 'claude-sonnet-5'

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
  const [sound, setSound] = useState(() => localStorage.getItem('oficina-sound') !== '0')
  const [roster, setRoster] = useState([]) // config completa (6 roles)
  const [squadOpen, setSquadOpen] = useState(false)
  const [draft, setDraft] = useState([]) // copia editable del roster en el panel ⚙️
  const [avatarPicker, setAvatarPicker] = useState(null) // miembro eligiendo personaje
  const [toast, setToast] = useState(null)
  const [deliverTargets, setDeliverTargets] = useState({}) // a quién camina cada entrega
  const handoffsRef = useRef([]) // [{from, to, original, result?}]
  const toastTimer = useRef(null)
  const sessionsRef = useRef({})
  const convIdRef = useRef(null)
  const logRef = useRef(null)
  const inputRef = useRef(null)

  // squad activo (máx 4) con su meta visual; el primero es el principal
  const squad = useMemo(
    () =>
      roster
        .filter((r) => r.enabled)
        .slice(0, MAX_ACTIVE)
        .map((r) => {
          const url = r.avatar ? `/models/pj/${r.avatar}` : ROLE_META[r.id].url
          return {
            id: r.id,
            name: r.name,
            ...ROLE_META[r.id],
            url,
            // los humanos llevan piel natural; goblins/zombies/robot no
            human: !NONHUMAN_AVATARS.has(url.split('/').pop()),
          }
        }),
    [roster]
  )
  const principal = squad[0]?.id || 'dev'
  const principalRef = useRef(principal)
  useEffect(() => {
    principalRef.current = principal
  }, [principal])
  const memberOf = (id) => squad.find((m) => m.id === id) || { name: id, emoji: '🤖', color: '#93a6a1', label: id }

  const projects = cfg?.projectsByProfile?.[profile] || []
  const running = Object.keys(roleStates)
  const busy = running.length > 0
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

  const loadSquad = async (p) => {
    const r = (await window.oficina?.squad?.get(p)) || []
    setRoster(r)
  }

  useEffect(() => {
    window.oficina?.getConfig?.().then((c) => {
      setCfg(c)
      const first = c.profiles[0]
      setProfile(first)
      setProject(c.projectsByProfile[first]?.[0]?.path || '')
      setModel(c.defaultModels?.[first] || FALLBACK_MODEL)
      loadSquad(first)
    })
  }, [])

  useEffect(() => {
    if (!window.oficina?.onEvent) return
    return window.oficina.onEvent((e) => {
      const who = e.role || principalRef.current
      const isP = who === principalRef.current
      if (e.kind === 'init') {
        if (e.sessionId) sessionsRef.current[who] = e.sessionId
        if (isP) setStatus('pensando…')
      } else if (e.kind === 'tool') {
        setTool({ role: who, name: e.name })
        setRS(who, 'working')
        if (isP) setStatus(`${toolInfo(e.name)[1]}…`)
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
        // ¿hay un handoff pendiente de este rol? guardar su resultado
        const entry = handoffsRef.current.find((h) => h.from === who && h.result == null)
        if (entry) entry.result = (e.result || '').slice(0, 6000) || '(sin salida)'
        // el principal solo camina cuando entrega a un compañero; los demás siempre
        setRS(who, isP && !entry ? 'idle' : 'delivering')
        // si entrega a un compañero, camina hacia ÉL (no hacia el principal)
        if (entry) setDeliverTargets((d) => ({ ...d, [who]: entry.to }))
        setTool((t) => (t?.role === who ? null : t))
        dingSound()
        if (isP) setStatus('esperándote')
      } else if (e.kind === 'error') {
        setMessages((ms) => [...ms, { role: 'assistant', who, text: `⚠️ ${e.message}` }])
        setRS(who, 'idle')
        setTool((t) => (t?.role === who ? null : t))
        buzzSound()
        if (isP) setStatus('error — mira la terminal')
      }
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

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

  // Atajos: ⌘K nueva · ⌘1-4 miembro del squad · ⌘Y historial · Esc cierra paneles
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setHistOpen(false)
        setSquadOpen(false)
        setAvatarPicker(null)
        return
      }
      if (!e.metaKey) return
      if (e.key === 'k') {
        e.preventDefault()
        newChat()
      } else if (e.key === 'y') {
        e.preventDefault()
        toggleHist()
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        const m = squad[Number(e.key) - 1]
        if (!m) return
        setInput((v) => `${m.name}, ${v.replace(/^\S+,\s*/, '')}`)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // aviso transitorio: aparece y se desvanece solo (no ensucia el chat)
  const showToast = (text, ms = 3500) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }

  const newChat = () => {
    setMessages([])
    convIdRef.current = null
    sessionsRef.current = {}
    window.oficina?.reset?.()
    showToast('conversación nueva ✨')
  }

  const changeProfile = (e) => {
    const p = e.target.value
    setProfile(p)
    setProject(cfg?.projectsByProfile?.[p]?.[0]?.path || '')
    setModel(cfg?.defaultModels?.[p] || FALLBACK_MODEL)
    setMessages([])
    convIdRef.current = null
    sessionsRef.current = {}
    window.oficina?.reset?.()
    loadSquad(p) // cada cuenta tiene su squad
  }
  const changeProject = (e) => {
    setProject(e.target.value)
    setMessages([])
    convIdRef.current = null
    sessionsRef.current = {}
    window.oficina?.reset?.()
  }

  // ── Config del squad (⚙️) ────────────────────────────────────────────────
  const openSquad = () => {
    setDraft(roster.map((r) => ({ ...r })))
    setSquadOpen(true)
    setAvatarPicker(null)
    setHistOpen(false)
  }
  const draftEnabled = draft.filter((r) => r.enabled).length
  const toggleMember = (id) =>
    setDraft((d) =>
      d.map((r) => {
        if (r.id !== id) return r
        if (r.enabled && draftEnabled <= 1) return r // mínimo 1
        if (!r.enabled && draftEnabled >= MAX_ACTIVE) return r // máximo 4
        return { ...r, enabled: !r.enabled }
      })
    )
  const renameMember = (id, name) => setDraft((d) => d.map((r) => (r.id === id ? { ...r, name } : r)))
  const setMemberAvatar = (id, avatar) => setDraft((d) => d.map((r) => (r.id === id ? { ...r, avatar: avatar || null } : r)))
  // avatar efectivo de un miembro (elegido o el default de su rol)
  const effectiveAvatar = (r) => r.avatar || ROLE_META[r.id].url.split('/').pop()
  // modelos ya ocupados por OTROS miembros activos (no se pueden repetir)
  const takenAvatars = (selfId) =>
    new Set(draft.filter((r) => r.enabled && r.id !== selfId).map((r) => effectiveAvatar(r)))
  const saveSquad = async () => {
    const clean = draft.map((r) => ({ ...r, name: r.name.trim() || ROLE_META[r.id].label }))
    // sin personajes duplicados entre los activos
    const active = clean.filter((r) => r.enabled)
    if (new Set(active.map(effectiveAvatar)).size !== active.length) {
      showToast('⚠️ dos miembros tienen el mismo personaje — elige otro')
      return
    }
    await window.oficina?.squad?.save(profile, clean)
    setRoster(clean)
    setSquadOpen(false)
    showToast(
      `squad actualizado: ${clean
        .filter((r) => r.enabled)
        .slice(0, MAX_ACTIVE)
        .map((r) => `${ROLE_META[r.id].emoji} ${r.name}`)
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
      messages: messages.map(({ role, text, who, to }) => ({ role, text, who, to })),
    })
  }, [busy, messages, profile, project, model])

  const toggleHist = async () => {
    if (!histOpen) setHistList((await window.oficina?.history?.list()) || [])
    setHistOpen((o) => !o)
    setSquadOpen(false)
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
        showToast(`modelo actual: ${model} · usa /model opus | sonnet | haiku | fable | fable1m`)
        return true
      }
      const resolved = MODEL_ALIASES[arg] ?? arg
      setModel(resolved)
      showToast(`modelo → ${resolved}`)
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

  const send = async (ev) => {
    ev.preventDefault()
    const text = input.trim()
    if (!text) return
    if (text.startsWith('/') && handleLocalCommand(text)) {
      setInput('')
      return
    }
    if (!window.oficina?.ask) {
      showToast('sin Electron — corre npm run dev')
      return
    }
    const target = routeMessage(text, squad, principal)
    if (roleStates[target]) {
      const m = memberOf(target)
      showToast(`${m.emoji} ${m.name} está ocupado — espera a que termine`)
      return
    }
    if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
    const handoffTo = detectHandoff(text, squad, target)
    if (handoffTo) handoffsRef.current.push({ from: target, to: handoffTo, original: text, result: null })
    setMessages((ms) => [...ms, { role: 'user', text, to: target }])
    setInput('')
    setRS(target, 'listening')
    popSound()
    if (target === principal) setStatus('pensando…')
    const res = await window.oficina.ask({ prompt: text, profile, cwd: project, writeMode, model, role: target })
    if (!res?.ok) {
      setMessages((ms) => [...ms, { role: 'assistant', who: target, text: `⚠️ ${res?.error || 'error desconocido'}` }])
      setRS(target, 'idle')
      if (target === principal) setStatus('esperándote')
    }
  }

  return (
    <div className="app">
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
        <button type="button" className="gear" onClick={openSquad} disabled={busy} title="Modelo, permisos, notificaciones y squad">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Configuración
        </button>
      </header>

      <div className="stage">
        <SysMonitor
          modelLabel={(() => {
            // solo la familia del modelo: Fable, Sonnet, Opus, Haiku…
            const fam = model.match(/fable|opus|sonnet|haiku/i)?.[0]
            return fam ? fam[0].toUpperCase() + fam.slice(1).toLowerCase() : model.replace(/^claude-/, '')
          })()}
        />
        <Office
          roleStates={roleStates}
          status={status}
          squad={squad}
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

        {squadOpen && (
          <div className="drawer">
            <div className="drawer-head">
              <b>⚙️ Configuración</b>
              <button onClick={() => setSquadOpen(false)}>✕</button>
            </div>

            {/* preferencias — aplican al instante */}
            <div className="pref-row">
              <span className="pref-label">Modelo:</span>
              <select className="sel pref-sel" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
                {[...new Set([model, ...Object.keys(MODEL_LABELS)])].map((id) => (
                  <option key={id} value={id}>
                    {MODEL_LABELS[id] || id.replace(/^claude-/, '')}
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

            <div className="drawer-sep">Squad · hasta {MAX_ACTIVE} activos · el 1º es el principal ({profile})</div>
            {draft.map((r) => (
              <div key={r.id} className={r.enabled ? 'squad-row' : 'squad-row off'}>
                <div className="squad-row-top">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => toggleMember(r.id)}
                    title={r.enabled ? 'Desactivar' : 'Activar'}
                  />
                  <span className="squad-emoji">{ROLE_META[r.id].emoji}</span>
                  <input
                    className="squad-name"
                    value={r.name}
                    maxLength={16}
                    onChange={(e) => renameMember(r.id, e.target.value)}
                    style={{ borderColor: r.enabled ? ROLE_META[r.id].color : undefined }}
                  />
                  <span className="squad-label">{ROLE_META[r.id].label}</span>
                </div>
                {r.enabled && (
                  <button
                    type="button"
                    className={avatarPicker === r.id ? 'squad-avatar-btn open' : 'squad-avatar-btn'}
                    onClick={() => setAvatarPicker((p) => (p === r.id ? null : r.id))}
                  >
                    🧍 {avatarLabel(effectiveAvatar(r))} · cambiar
                  </button>
                )}
              </div>
            ))}
            <button className="squad-save" onClick={saveSquad}>
              Guardar squad ({draftEnabled}/{MAX_ACTIVE})
            </button>
          </div>
        )}

        {squadOpen &&
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

        {tool && (
          <div className="toolchip" key={`${tool.role}-${tool.name}`}>
            <span className="toolchip-icon">{toolInfo(tool.name)[0]}</span>
            {memberOf(tool.role).name}: {toolInfo(tool.name)[1]}…
          </div>
        )}

        {messages.length > 0 && (
          <div className="chat" ref={logRef}>
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role === 'assistant' && m.who && (
                  <div className="who" style={{ color: memberOf(m.who).color }}>
                    {memberOf(m.who).emoji} {memberOf(m.who).name}
                  </div>
                )}
                {m.role === 'user' && m.to && m.to !== principal && <div className="who to">→ {memberOf(m.to).name}</div>}
                {m.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown> : m.text}
                {m.streaming ? '▍' : ''}
              </div>
            ))}
          </div>
        )}
      </div>

      <form className="composer" onSubmit={send}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
