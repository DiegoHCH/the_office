import { useEffect, useRef, useState } from 'react'
import Office from './Office.jsx'

export default function App() {
  const [messages, setMessages] = useState([]) // {role, text, streaming?}
  const [status, setStatus] = useState('esperándote')
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const logRef = useRef(null)

  useEffect(() => {
    if (!window.oficina?.onEvent) return
    return window.oficina.onEvent((e) => {
      if (e.kind === 'init') {
        setStatus('pensando…')
      } else if (e.kind === 'tool') {
        setStatus(`usando ${e.name}…`)
      } else if (e.kind === 'text') {
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
        setStatus('esperándote')
      } else if (e.kind === 'error') {
        setMessages((ms) => [...ms, { role: 'assistant', text: `⚠️ ${e.message}` }])
        setBusy(false)
        setStatus('error — mira la terminal')
      }
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async (ev) => {
    ev.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    if (!window.oficina?.ask) {
      setStatus('sin Electron — corre npm run dev')
      return
    }
    setMessages((ms) => [...ms, { role: 'user', text }])
    setInput('')
    setBusy(true)
    setStatus('pensando…')
    const res = await window.oficina.ask(text)
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
        <span className="muted">· Fase 2 · conectada a Claude</span>
        <span className={busy ? 'ipc busy' : 'ipc'}>{status}</span>
      </header>

      <div className="stage">
        <Office working={busy} />
        {messages.length > 0 && (
          <div className="chat" ref={logRef}>
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.text}
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
