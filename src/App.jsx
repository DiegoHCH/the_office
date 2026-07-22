import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Office from './Office.jsx'
import { popSound, dingSound, buzzSound, setSoundEnabled } from './sound.js'

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

// Qué miembro activa cada herramienta (si ese rol está en el squad activo).
const TOOL_AFFINITY = { Bash: 'qa', Read: 'research', Glob: 'research', Grep: 'research', WebSearch: 'research', WebFetch: 'research' }

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
  const [toast, setToast] = useState(null)
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
        .map((r) => ({ id: r.id, name: r.name, ...ROLE_META[r.id] })),
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
        setRS(who, isP ? 'idle' : 'delivering')
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

  // Atajos: ⌘K nueva · ⌘1-4 miembro del squad · ⌘Y historial · Esc cierra paneles
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setHistOpen(false)
        setSquadOpen(false)
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
  const saveSquad = async () => {
    const clean = draft.map((r) => ({ ...r, name: r.name.trim() || ROLE_META[r.id].label }))
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
        <Office roleStates={roleStates} status={status} squad={squad} onTourDone={(r) => setRS(r, 'idle')} />

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
            ))}
            <button className="squad-save" onClick={saveSquad}>
              Guardar squad ({draftEnabled}/{MAX_ACTIVE})
            </button>
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
