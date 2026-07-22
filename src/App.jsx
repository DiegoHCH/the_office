import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Office from './Office.jsx'
import { popSound, dingSound, buzzSound, setSoundEnabled } from './sound.js'

// ── El squad ─────────────────────────────────────────────────────────────────
const ROLES = {
  dev: { name: 'Luffy', emoji: '⌨️', color: '#2dd4bf', label: 'Dev' },
  research: { name: 'Nami', emoji: '🔍', color: '#6366f1', label: 'Research' },
  design: { name: 'Sanji', emoji: '🎨', color: '#f472b6', label: 'UI/UX' },
  qa: { name: 'Zoro', emoji: '🧪', color: '#f5a524', label: 'QA' },
}
const ROLE_IDS = Object.keys(ROLES)

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

// ── Enrutar el mensaje al miembro del squad correcto ────────────────────────
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const ROLE_KEYWORDS = [
  ['design', /disen|\bui\b|\bux\b|figma|pantalla|mockup|interfaz|estilo|boton|layout|tipografia/],
  ['qa', /\btest\b|\btests\b|prueba|regresion|\bqa\b|coverage|e2e|unitari/],
  ['research', /investig|busca|analiza|compara|artifact|documenta/],
]
function routeMessage(text) {
  const t = norm(text)
  // nombre al inicio ("tess, ...") o @nombre en cualquier parte
  for (const id of ROLE_IDS) {
    const n = norm(ROLES[id].name)
    if (new RegExp(`^${n}\\b`).test(t) || t.includes(`@${n}`)) return id
  }
  for (const [role, re] of ROLE_KEYWORDS) if (re.test(t)) return role
  return 'dev'
}

export default function App() {
  const [messages, setMessages] = useState([]) // {role:'user'|'assistant'|'system', text, who?, to?, streaming?}
  const [status, setStatus] = useState('esperándote')
  // Estado de cada rol: listening (te mira), working (mira pantalla), talking (te mira).
  // Ausente = idle (en su pantalla, a lo suyo).
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
  const sessionsRef = useRef({}) // role → sessionId (para historial/--resume)
  const convIdRef = useRef(null)
  const logRef = useRef(null)
  const inputRef = useRef(null)

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
  }, [sound])

  useEffect(() => {
    window.oficina?.getConfig?.().then((c) => {
      setCfg(c)
      const first = c.profiles[0]
      setProfile(first)
      setProject(c.projectsByProfile[first]?.[0]?.path || '')
      setModel(c.defaultModels?.[first] || FALLBACK_MODEL)
    })
  }, [])

  useEffect(() => {
    if (!window.oficina?.onEvent) return
    return window.oficina.onEvent((e) => {
      const who = e.role || 'dev'
      if (e.kind === 'init') {
        if (e.sessionId) sessionsRef.current[who] = e.sessionId
        if (who === 'dev') setStatus('pensando…')
      } else if (e.kind === 'tool') {
        setTool({ role: who, name: e.name })
        setRS(who, 'working') // necesita la pantalla: se gira a trabajar
        if (who === 'dev') setStatus(`${toolInfo(e.name)[1]}…`)
      } else if (e.kind === 'text') {
        setTool((t) => (t?.role === who ? null : t))
        setRS(who, 'talking') // te responde: se voltea a mirarte
        if (who === 'dev') setStatus('respondiendo…')
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
        // el squad camina a "entregarle" a Luffy; Luffy solo vuelve a esperar
        setRS(who, who === 'dev' ? 'idle' : 'delivering')
        setTool((t) => (t?.role === who ? null : t))
        dingSound()
        if (who === 'dev') setStatus('esperándote')
      } else if (e.kind === 'error') {
        setMessages((ms) => [...ms, { role: 'assistant', who, text: `⚠️ ${e.message}` }])
        setRS(who, 'idle')
        setTool((t) => (t?.role === who ? null : t))
        buzzSound()
        if (who === 'dev') setStatus('error — mira la terminal')
      }
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Atajos: ⌘K nueva · ⌘1-4 hablarle a un tripulante · ⌘Y historial · Esc cierra panel
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setHistOpen(false)
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
        const id = ROLE_IDS[Number(e.key) - 1]
        setInput((v) => `${ROLES[id].name}, ${v.replace(/^\S+,\s*/, '')}`)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const addSystem = (text) => setMessages((ms) => [...ms, { role: 'system', text }])

  const flashStatus = (text, ms = 2500) => {
    setStatus(text)
    setTimeout(() => setStatus((s) => (s === text ? 'esperándote' : s)), ms)
  }

  const newChat = () => {
    setMessages([])
    convIdRef.current = null
    sessionsRef.current = {}
    window.oficina?.reset?.()
    flashStatus('conversación nueva ✨')
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
  }
  const changeProject = (e) => {
    setProject(e.target.value)
    setMessages([])
    convIdRef.current = null
    sessionsRef.current = {}
    window.oficina?.reset?.()
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
  }

  const loadConvo = async (id) => {
    if (busy) return
    const c = await window.oficina?.history?.get(id)
    if (!c) return
    convIdRef.current = c.id
    if (c.profile && cfg?.profiles?.includes(c.profile)) setProfile(c.profile)
    if (c.project) setProject(c.project)
    if (c.model) setModel(c.model)
    // compat: conversaciones viejas guardaban un solo sessionId (dev)
    const saved = c.sessions || (c.sessionId ? { dev: c.sessionId } : {})
    sessionsRef.current = { ...saved }
    setMessages(c.messages || [])
    await window.oficina?.setSession?.({ sessions: saved, profile: c.profile, cwd: c.project })
    setHistOpen(false)
    flashStatus(Object.keys(saved).length ? 'retomada — recordamos todo 🧠' : 'conversación cargada', 3000)
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
        addSystem(`modelo actual: ${model} · usa /model opus | sonnet | haiku | fable | fable1m`)
        return true
      }
      const resolved = MODEL_ALIASES[arg] ?? arg
      setModel(resolved)
      addSystem(`modelo → ${resolved}`)
      return true
    }
    if (cmd === '/clear' || cmd === '/nueva') {
      newChat()
      return true
    }
    if (cmd === '/squad') {
      addSystem(ROLE_IDS.map((id) => `${ROLES[id].emoji} ${ROLES[id].name} — ${ROLES[id].label}`).join('  ·  '))
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
      setStatus('sin Electron — corre npm run dev')
      return
    }
    const target = routeMessage(text)
    if (roleStates[target]) {
      addSystem(`${ROLES[target].emoji} ${ROLES[target].name} está ocupado — espera a que termine`)
      return
    }
    if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
    setMessages((ms) => [...ms, { role: 'user', text, to: target }])
    setInput('')
    setRS(target, 'listening') // lo nombraste: se voltea a mirarte
    popSound()
    if (target === 'dev') setStatus('pensando…')
    const res = await window.oficina.ask({ prompt: text, profile, cwd: project, writeMode, model, role: target })
    if (!res?.ok) {
      setMessages((ms) => [...ms, { role: 'assistant', who: target, text: `⚠️ ${res?.error || 'error desconocido'}` }])
      setRS(target, 'idle')
      if (target === 'dev') setStatus('esperándote')
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
              {p === 'work' ? '💼 work' : p === 'private' ? '🔒 private' : p}
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
        <select className="sel" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} title="Modelo (--model)">
          {[...new Set([model, ...Object.keys(MODEL_LABELS)])].map((id) => (
            <option key={id} value={id}>
              {MODEL_LABELS[id] || id.replace(/^claude-/, '')}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={writeMode ? 'mode write' : 'mode'}
          onClick={() => setWriteMode((w) => !w)}
          title={writeMode ? 'Puede editar archivos y correr comandos (acceptEdits)' : 'Solo lectura: investigar sin tocar nada'}
        >
          {writeMode ? '✏️ edición' : '🔒 lectura'}
        </button>
        <button type="button" className="newchat" onClick={() => setSound((s) => !s)} title={sound ? 'Silenciar sonidos' : 'Activar sonidos'}>
          {sound ? '🔊' : '🔇'}
        </button>
        <button type="button" className="newchat" onClick={toggleHist} disabled={busy} title="Historial de conversaciones">
          🕘
        </button>
        <button type="button" className="newchat" onClick={newChat} disabled={busy} title="Conversación nueva">
          ✚ nueva
        </button>
      </header>

      <div className="stage">
        <Office roleStates={roleStates} status={status} onTourDone={(r) => setRS(r, 'idle')} />
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
                  {h.updatedAt ? new Date(h.updatedAt).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
                <button className="hist-del" title="Borrar" onClick={(e) => deleteConvo(e, h.id)}>
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
        {tool && (
          <div className="toolchip" key={`${tool.role}-${tool.name}`}>
            <span className="toolchip-icon">{toolInfo(tool.name)[0]}</span>
            {ROLES[tool.role]?.name}: {toolInfo(tool.name)[1]}…
          </div>
        )}
        {messages.length > 0 && (
          <div className="chat" ref={logRef}>
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role === 'assistant' && m.who && (
                  <div className="who" style={{ color: ROLES[m.who]?.color }}>
                    {ROLES[m.who]?.emoji} {ROLES[m.who]?.name}
                  </div>
                )}
                {m.role === 'user' && m.to && m.to !== 'dev' && (
                  <div className="who to">→ {ROLES[m.to]?.name}</div>
                )}
                {m.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                ) : (
                  m.text
                )}
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
              ? `${running.map((r) => ROLES[r].name).join(', ')} trabajando… (puedes pedirle algo a otro)`
              : `Escríbele al squad… (ej: "${ROLES.qa.name}, corre los tests" · "@${ROLES.research.name.toLowerCase()} investiga X")`
          }
          autoFocus
        />
        <button disabled={!input.trim()}>Enviar</button>
      </form>
    </div>
  )
}
