// Tour de bienvenida con spotlight (refactor #94).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'

// Tour de bienvenida: spotlight sobre la UI real, paso a paso. Los textos
// salen del diccionario, así que el tour sigue al idioma elegido (#103).
const TOUR_STEPS = [
  { sel: '.ctxbtn', k: 'ctx' },
  { sel: '.hud', k: 'hud' },
  // solo aparece si la carpeta tiene un proyecto que se pueda correr, así que el
  // paso se salta cuando no hay botón: señalar un hueco no explica nada
  { sel: '.devbtn', k: 'run', opcional: true },
  { sel: '.sysmon-stack', k: 'mon' },
  { sel: 'canvas', k: 'office' },
  { sel: '.perm-chip', k: 'perm' },
  { sel: '.composer textarea', k: 'composer' },
]
const PAD = 8 // holgura del recuadro alrededor del elemento
const HUECO = 14 // separación entre el recuadro y la tarjeta
const BORDE = 12 // margen mínimo con el borde de la ventana
const ANCHO = 320 // el mismo que fija .tour-card en el CSS

// Dónde cabe la tarjeta: debajo del elemento, encima, o —si el elemento ocupa
// casi toda la pantalla, como el canvas de la oficina— dentro de él. Sin este
// último caso la tarjeta se salía por arriba: la lógica anterior solo elegía
// entre debajo y encima, y con el canvas no cabe en ninguno de los dos.
export function colocar(rect, altoTarjeta, vw, vh) {
  if (!rect) return { left: '50%', top: '40%', transform: 'translateX(-50%)' }
  const left = Math.min(Math.max(rect.left, BORDE), Math.max(vw - ANCHO - BORDE, BORDE))
  const abajo = rect.bottom + HUECO
  const arriba = rect.top - HUECO - altoTarjeta
  let top
  if (abajo + altoTarjeta <= vh - BORDE) top = abajo
  else if (arriba >= BORDE) top = arriba
  else top = rect.top + HUECO // dentro del elemento
  // pase lo que pase, nunca fuera de la ventana
  return { left, top: Math.min(Math.max(top, BORDE), Math.max(vh - altoTarjeta - BORDE, BORDE)) }
}

export default function Tour({ onDone }) {
  // los pasos opcionales se resuelven una vez, al arrancar: así el contador
  // «3 / 6» no cuenta un paso que nunca se va a ver
  const [TOUR] = useState(() => TOUR_STEPS.filter((p) => !p.opcional || document.querySelector(p.sel)))
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const [alto, setAlto] = useState(185) // hasta medirla; el texto varía por idioma
  const cardRef = useRef(null)
  useEffect(() => {
    const measure = () => {
      const el = document.querySelector(TOUR[i].sel)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [i])
  // el alto real depende de cuánto texto tenga el paso: medirlo antes de pintar
  useLayoutEffect(() => {
    if (cardRef.current) setAlto(cardRef.current.getBoundingClientRect().height)
  }, [i, rect])
  const s = TOUR[i]
  const cardStyle = colocar(rect, alto, window.innerWidth, window.innerHeight)
  return (
    <div className="tour">
      {rect && (
        <div
          className="tour-spot"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      )}
      <div className="tour-card" ref={cardRef} style={cardStyle}>
        <div className="tour-step">
          {i + 1} / {TOUR.length}
        </div>
        <b>{t(`tour.${s.k}.title`)}</b>
        <p>{t(`tour.${s.k}.text`)}</p>
        <div className="tour-actions">
          <button type="button" onClick={onDone}>{t('tour.skip')}</button>
          <button type="button" className="tour-next" onClick={() => (i < TOUR.length - 1 ? setI(i + 1) : onDone())}>
            {i < TOUR.length - 1 ? t('tour.next') : t('tour.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
