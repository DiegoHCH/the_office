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

// Modelos disponibles para --model ('' = el default del perfil).
const MODELS = [
  ['', '🧠 auto'],
  ['opus', 'Opus 4.8'],
  ['sonnet', 'Sonnet 5'],
  ['haiku', 'Haiku 4.5'],
  ['claude-fable-5', 'Fable 5'],
]
const MODEL_ALIASES = { fable: 'claude-fable-5', auto: '', default: '' }

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
  const [model, setModel] = useState('') // '' = default del perfil
  const logRef = useRef(null)

  const projects = cfg?.projectsByProfile?.[profile] || []

  useEffect(() => {
    window.oficina?.getConfig?.().then((c) => {
      setCfg(c)
      const first = c.profiles[0]
      setProfile(first)
      setProject(c.projectsByProfile[first]?.[0]?.path || '')
    })
  }, [])

  // cambiar perfil también cambia la lista de proyectos; ambos resetean la charla
  const changeProfile = (e) => {
    const p = e.target.value
    setProfile(p)
    setProject(cfg?.projectsByProfile?.[p]?.[0]?.path || '')
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
    window.oficina?.reset?.()
    setStatus('conversación nueva')
  }

  useEffect(() => {
    if (!window.oficina?.onEvent) return
    return window.oficina.onEvent((e) => {
      if (e.kind === 'init') {
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

  // Comandos locales (los interactivos de la CLI no existen en headless).
  // Cualquier otro /comando pasa directo a Claude → tus skills funcionan.
  const handleLocalCommand = (text) => {
    const [cmd, ...rest] = text.split(/\s+/)
    if (cmd === '/model') {
      const arg = rest[0]?.toLowerCase()
      if (!arg) {
        addSystem(
          `modelo actual: ${model || 'auto (default del perfil)'} · usa /model opus | sonnet | haiku | fable | auto`
        )
        return true
      }
      const resolved = MODEL_ALIASES[arg] ?? arg
      setModel(resolved)
      addSystem(`modelo → ${resolved || 'auto (default del perfil)'}`)
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
          {MODELS.map(([value, label]) => {
            const def = cfg?.defaultModels?.[profile]
            const text = value === '' && def ? `🧠 auto · ${def.replace(/^claude-/, '')}` : label
            return (
              <option key={value} value={value}>
                {text}
              </option>
            )
          })}
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
        <button type="button" className="newchat" onClick={newChat} disabled={busy} title="Conversación nueva">
          ✚ nueva
        </button>
        <span className={busy ? 'ipc busy' : 'ipc'}>{status}</span>
      </header>

      <div className="stage">
        <Office working={busy} />
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
