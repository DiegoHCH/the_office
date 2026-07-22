import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Office from './Office.jsx'

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
// Default de Claude Code cuando el perfil no tiene modelo guardado
// (verificado contra el perfil private: claude-sonnet-5).
const FALLBACK_MODEL = 'claude-sonnet-5'

export default function App() {
  const [messages, setMessages] = useState([]) // {role, text, streaming?}
  const [status, setStatus] = useState('esperándote')
  const [busy, setBusy] = useState(false)
  const [tool, setTool] = useState(null) // herramienta en uso (chip sobre la escena)
  const [input, setInput] = useState('')
  const [cfg, setCfg] = useState(null) // {profiles, projectsByProfile}
  const [profile, setProfile] = useState('work')
  const [project, setProject] = useState('')
  const [writeMode, setWriteMode] = useState(true) // edición por defecto (flujo normal de trabajo)
  const [model, setModel] = useState(FALLBACK_MODEL)
  const [sessionId, setSessionId] = useState(null) // session de claude (para --resume al retomar)
  const [histOpen, setHistOpen] = useState(false)
  const [histList, setHistList] = useState([])
  const convIdRef = useRef(null) // id de la conversación actual en el historial
  const logRef = useRef(null)

  const projects = cfg?.projectsByProfile?.[profile] || []

  useEffect(() => {
    window.oficina?.getConfig?.().then((c) => {
      setCfg(c)
      const first = c.profiles[0]
      setProfile(first)
      setProject(c.projectsByProfile[first]?.[0]?.path || '')
      setModel(c.defaultModels?.[first] || FALLBACK_MODEL)
    })
  }, [])

  // cambiar perfil también cambia la lista de proyectos; ambos resetean la charla
  const changeProfile = (e) => {
    const p = e.target.value
    setProfile(p)
    setProject(cfg?.projectsByProfile?.[p]?.[0]?.path || '')
    setModel(cfg?.defaultModels?.[p] || FALLBACK_MODEL)
    setMessages([])
    window.oficina?.reset?.()
  }
  const changeProject = (e) => {
    setProject(e.target.value)
    setMessages([])
    window.oficina?.reset?.()
  }

  const newChat = () => {
    setMessages([])
    convIdRef.current = null
    setSessionId(null)
    window.oficina?.reset?.()
    flashStatus('conversación nueva ✨')
  }

  // ── Historial ──────────────────────────────────────────────────────────────
  // Guardado automático al terminar cada respuesta.
  useEffect(() => {
    if (busy || !messages.length || !convIdRef.current) return
    const title = messages.find((m) => m.role === 'user')?.text.slice(0, 60) || 'conversación'
    window.oficina?.history?.save({
      id: convIdRef.current,
      title,
      profile,
      project,
      model,
      sessionId,
      updatedAt: Date.now(),
      messages: messages.map(({ role, text }) => ({ role, text })),
    })
  }, [busy, messages, profile, project, model, sessionId])

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
    setSessionId(c.sessionId || null)
    setMessages(c.messages || [])
    // restaurar la sesión en el main → el próximo mensaje hace --resume
    await window.oficina?.setSession?.({ sessionId: c.sessionId, profile: c.profile, cwd: c.project })
    setHistOpen(false)
    flashStatus(c.sessionId ? 'retomada — recuerdo todo 🧠' : 'conversación cargada', 3000)
  }

  const deleteConvo = async (e, id) => {
    e.stopPropagation()
    await window.oficina?.history?.remove(id)
    // si borras la conversación abierta, limpiar también el chat en pantalla
    // (si no, el auto-guardado la volvería a crear en el próximo mensaje)
    if (id === convIdRef.current) newChat()
    setHistList((await window.oficina?.history?.list()) || [])
  }

  useEffect(() => {
    if (!window.oficina?.onEvent) return
    return window.oficina.onEvent((e) => {
      if (e.kind === 'init') {
        if (e.sessionId) setSessionId(e.sessionId)
        setStatus('pensando…')
      } else if (e.kind === 'tool') {
        setTool(e.name)
        setStatus(`${toolInfo(e.name)[1]}…`)
      } else if (e.kind === 'text') {
        setTool(null)
        setStatus('respondiendo…')
        setMessages((ms) => {
          const last = ms[ms.length - 1]
          if (last?.role === 'assistant' && last.streaming) {
            return [...ms.slice(0, -1), { ...last, text: last.text + e.text }]
          }
          return [...ms, { role: 'assistant', text: e.text, streaming: true }]
        })
      } else if (e.kind === 'done') {
        setMessages((ms) => {
          const last = ms[ms.length - 1]
          if (last?.role === 'assistant' && last.streaming) {
            return [...ms.slice(0, -1), { ...last, streaming: false }]
          }
          // sin deltas: usar el resultado final completo
          return e.result ? [...ms, { role: 'assistant', text: e.result }] : ms
        })
        setBusy(false)
        setTool(null)
        setStatus('esperándote')
      } else if (e.kind === 'error') {
        setMessages((ms) => [...ms, { role: 'assistant', text: `⚠️ ${e.message}` }])
        setBusy(false)
        setTool(null)
        setStatus('error — mira la terminal')
      }
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const addSystem = (text) => setMessages((ms) => [...ms, { role: 'system', text }])

  // status transitorio: se muestra un momento y vuelve a "esperándote"
  // (solo si nadie lo cambió mientras tanto)
  const flashStatus = (text, ms = 2500) => {
    setStatus(text)
    setTimeout(() => setStatus((s) => (s === text ? 'esperándote' : s)), ms)
  }

  // Comandos locales (los interactivos de la CLI no existen en headless).
  // Cualquier otro /comando pasa directo a Claude → tus skills funcionan.
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
    return false
  }

  const send = async (ev) => {
    ev.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    if (text.startsWith('/') && handleLocalCommand(text)) {
      setInput('')
      return
    }
    if (!window.oficina?.ask) {
      setStatus('sin Electron — corre npm run dev')
      return
    }
    if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
    setMessages((ms) => [...ms, { role: 'user', text }])
    setInput('')
    setBusy(true)
    setStatus('pensando…')
    const res = await window.oficina.ask({ prompt: text, profile, cwd: project, writeMode, model })
    if (!res?.ok) {
      setMessages((ms) => [...ms, { role: 'assistant', text: `⚠️ ${res?.error || 'error desconocido'}` }])
      setBusy(false)
      setStatus('esperándote')
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
          disabled={busy}
          title={writeMode ? 'Puede editar archivos y correr comandos (acceptEdits)' : 'Solo lectura: investigar sin tocar nada'}
        >
          {writeMode ? '✏️ edición' : '🔒 lectura'}
        </button>
        <button type="button" className="newchat" onClick={toggleHist} disabled={busy} title="Historial de conversaciones">
          🕘
        </button>
        <button type="button" className="newchat" onClick={newChat} disabled={busy} title="Conversación nueva">
          ✚ nueva
        </button>
      </header>

      <div className="stage">
        <Office working={busy} status={status} />
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
          <div className="toolchip" key={tool}>
            <span className="toolchip-icon">{toolInfo(tool)[0]}</span>
            {toolInfo(tool)[1]}…
          </div>
        )}
        {messages.length > 0 && (
          <div className="chat" ref={logRef}>
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? 'Claude está trabajando…' : 'Escríbele a Claude…'}
          disabled={busy}
          autoFocus
        />
        <button disabled={busy || !input.trim()}>Enviar</button>
      </form>
    </div>
  )
}
