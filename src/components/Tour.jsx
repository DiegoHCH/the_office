// Tour de bienvenida con spotlight (refactor #94).
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'

// Tour de bienvenida: spotlight sobre la UI real, paso a paso. Los textos
// salen del diccionario, así que el tour sigue al idioma elegido (#103).
const TOUR_STEPS = [
  { sel: '.ctxbtn', k: 'ctx' },
  { sel: '.hud', k: 'hud' },
  { sel: '.sysmon-stack', k: 'mon' },
  { sel: 'canvas', k: 'office' },
  { sel: '.perm-chip', k: 'perm' },
  { sel: '.composer textarea', k: 'composer' },
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
        <b>{t(`tour.${s.k}.title`)}</b>
        <p>{t(`tour.${s.k}.text`)}</p>
        <div className="tour-actions">
          <button type="button" onClick={onDone}>{t('tour.skip')}</button>
          <button type="button" className="tour-next" onClick={() => (i < TOUR_STEPS.length - 1 ? setI(i + 1) : onDone())}>
            {i < TOUR_STEPS.length - 1 ? t('tour.next') : t('tour.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
