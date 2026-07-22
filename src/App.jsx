import { useEffect, useState } from 'react'
import Office from './Office.jsx'

export default function App() {
  const [version, setVersion] = useState('…')

  useEffect(() => {
    // Prueba del puente Electron <-> React (backbone de la Fase 2).
    window.oficina?.getVersion?.().then(setVersion).catch(() => setVersion('n/d'))
  }, [])

  return (
    <div className="app">
      <header className="hud">
        <span className="dot" />
        <b>LA OFICINA</b>
        <span className="muted">· Fase 1 · arte</span>
        <span className="ipc">
          {window.oficina ? `IPC ok · app v${version}` : 'sin Electron (modo navegador)'}
        </span>
      </header>

      <div className="stage">
        <Office />
      </div>

      <form className="composer" onSubmit={(e) => e.preventDefault()}>
        <input placeholder="(Fase 2) aquí le escribirás a Claude…" disabled />
        <button disabled>Enviar</button>
      </form>
    </div>
  )
}
