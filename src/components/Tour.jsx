// Tour de bienvenida con spotlight (refactor #94).
import { useEffect, useState } from 'react'

// Tour de bienvenida: spotlight sobre la UI real, paso a paso.
const TOUR_STEPS = [
  { sel: '.ctxbtn', title: 'Tu contexto', text: 'Perfil y proyecto activos. Aquí cambias entre work/private, eliges el repo donde trabaja el squad y agregas carpetas externas.' },
  { sel: '.hud', title: 'La barra', text: 'Documentos que genera el squad, historial de conversaciones (⌘Y), conversación nueva (⌘K) y Configuración (⌘,) — ahí viven Agentes, Skills y MCP.' },
  { sel: '.sysmon-stack', title: 'Monitores', text: 'CPU y RAM reales del Mac, y tu cuota de Claude: modelo en uso, tokens de la conversación y % de la sesión de 5h y la semana.' },
  { sel: 'canvas', title: 'La oficina', text: 'Cada personaje es una sesión real de Claude Code. Click en uno para dirigirle el mensaje; arrastra para rotar la cámara y doble click la restablece.' },
  { sel: '.perm-chip', title: 'Permisos a la vista', text: 'Ámbar = edición (puede modificar archivos y correr comandos, auto-aceptado — úsalo en repos con git). Gris = solo lectura. Un click lo alterna.' },
  { sel: '.composer textarea', title: 'El composer', text: 'Enter envía · Shift+Enter salto de línea · / abre tus plantillas · @ lista los agentes (@todos = a todos los libres) · ⌘F busca en la conversación.' },
]
export default function Tour({ onDone }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  useEffect(() => {
    const measure = () => {
      const el = document.querySelector(TOUR_STEPS[i].sel)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [i])
  const s = TOUR_STEPS[i]
  const pad = 8
  const cardW = 320
  const below = rect ? rect.bottom < window.innerHeight - 230 : true
  const cardStyle = rect
    ? {
        left: Math.min(Math.max(rect.left, 12), window.innerWidth - cardW - 12),
        ...(below ? { top: rect.bottom + 14 } : { bottom: window.innerHeight - rect.top + 14 }),
      }
    : { left: '50%', top: '40%', transform: 'translateX(-50%)' }
  return (
    <div className="tour">
      {rect && (
        <div
          className="tour-spot"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      )}
      <div className="tour-card" style={cardStyle}>
        <div className="tour-step">
          {i + 1} / {TOUR_STEPS.length}
        </div>
        <b>{s.title}</b>
        <p>{s.text}</p>
        <div className="tour-actions">
          <button type="button" onClick={onDone}>Saltar</button>
          <button type="button" className="tour-next" onClick={() => (i < TOUR_STEPS.length - 1 ? setI(i + 1) : onDone())}>
            {i < TOUR_STEPS.length - 1 ? 'Siguiente →' : '¡Listo! 🎉'}
          </button>
        </div>
      </div>
    </div>
  )
}
