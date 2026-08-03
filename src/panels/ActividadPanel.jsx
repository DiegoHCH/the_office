// Qué está haciendo el agente por detrás: qué lee, qué escribe, qué ejecuta.
//
// El objetivo es supervisar mientras trabaja, así que manda lo reciente: la
// lista va en orden y se queda pegada al final mientras haya movimiento. En
// cuanto subes a mirar algo, deja de arrastrarte — un panel que te devuelve al
// final cada vez que llega una línea es inservible justo cuando lo necesitas.
import { useEffect, useRef, useState } from 'react'

import { IconClose, IconFolder } from '../components/icons.jsx'
import { t } from '../lib/i18n.js'
import { resumen, rutaCorta } from '../lib/actividad.js'

const VERBO = {
  lee: t('act.reads'),
  escribe: t('act.writes'),
  corre: t('act.runs'),
  piensa: t('act.plans'),
  otro: t('act.uses'),
}

// En 24 h a propósito: «03:29:03 p. m.» se come un tercio del ancho de la fila,
// y en un registro el meridiano no aporta nada.
const hora = (ms) =>
  ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }) : ''

export default function ActividadPanel({ open, onClose, pasos = [], proyecto = '', memberOf, trabajando = false, conversacion = '' }) {
  const finRef = useRef(null)
  const cajaRef = useRef(null)
  const pegadoRef = useRef(true)
  const [familia, setFamilia] = useState('') // '' = todo

  // Se sigue el final solo si el usuario ya estaba abajo. `scrollHeight` puede
  // no estar listo en el mismo frame en que llega la línea, de ahí el ref sobre
  // el nodo final en vez de calcular posiciones a mano.
  useEffect(() => {
    if (open && pegadoRef.current) finRef.current?.scrollIntoView({ block: 'end' })
  }, [pasos, open])

  if (!open) return null

  const r = resumen(pasos)
  const lista = familia ? pasos.filter((p) => p.familia === familia) : pasos

  return (
    <div className="drawer over ancho col">
      <div className="drawer-head">
        {/* De qué conversación es. El panel sigue a la pestaña activa, así que al
            cambiar de pestaña cambia lo que muestra: sin decir de quién es, ese
            cambio parecería que el rastro se ha borrado. */}
        <b>
          {t('panel.activity')}
          {conversacion && <span className="act-de"> · {conversacion}</span>}
        </b>
        <button onClick={() => onClose()} title={t('panel.back')}>
          <IconClose size={16} />
        </button>
      </div>

      {/* El resumen va arriba porque responde de un vistazo la pregunta que trae
          a este panel: ¿ha tocado algo, y dónde? */}
      <div className="act-sum">
        <span className={trabajando ? 'act-live on' : 'act-live'}>
          {trabajando ? t('act.working') : t('act.idle')}
        </span>
        {['lee', 'escribe', 'corre', 'piensa'].map((f) =>
          r.cuenta[f] ? (
            <button
              key={f}
              type="button"
              className={familia === f ? `act-tag ${f} on` : `act-tag ${f}`}
              onClick={() => setFamilia(familia === f ? '' : f)}
              title={t('act.filter')}
            >
              {VERBO[f]} <b>{r.cuenta[f]}</b>
            </button>
          ) : null
        )}
        {r.archivos.length > 0 && (
          <span className="act-tag files" title={r.archivos.join('\n')}>
            <IconFolder size={12} /> {r.archivos.length}
          </span>
        )}
      </div>

      {/* Las carpetas tocadas: es la pregunta «¿por dónde anda?» respondida sin
          leer el detalle paso a paso. */}
      {r.carpetas.length > 0 && (
        <div className="act-dirs">
          {r.carpetas.map((c) => (
            <code key={c} title={c}>
              {rutaCorta(c, proyecto)}
            </code>
          ))}
        </div>
      )}

      {lista.length === 0 && <div className="hist-empty">{t('act.empty')}</div>}

      <div
        className="act-list"
        ref={cajaRef}
        onScroll={(e) => {
          const el = e.currentTarget
          pegadoRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {lista.map((p, i) => {
          const m = memberOf?.(p.role)
          return (
            <div key={`${p.t}-${i}`} className={`act-row ${p.familia}`}>
              <span className="act-time">{hora(p.t)}</span>
              {m && (
                <span className="act-who" style={{ color: m.color }}>
                  {m.name}
                </span>
              )}
              <span className="act-verb">{VERBO[p.familia]}</span>
              <span className="act-what" title={p.detail || p.name}>
                {p.path ? rutaCorta(p.path, proyecto) : p.detail || p.name}
              </span>
              {p.veces > 1 && <span className="act-veces">×{p.veces}</span>}
            </div>
          )
        })}
        <div ref={finRef} />
      </div>
    </div>
  )
}
