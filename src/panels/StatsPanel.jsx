// Panel de estadísticas (#125).
//
// Dos vistas: «Resumen» —los números del rango, el mapa de actividad y el
// reparto por tripulante— y «Modelos» —cuántos tokens se ha llevado cada uno—.
// Las cuentas NO están aquí: viven en lib/estadisticas.js, que es puro y está
// probado; este archivo solo dibuja.
//
// Sobre el color, siguiendo la guía de visualización del proyecto: las series de
// modelo son categóricas (identidad) y van en ORDEN FIJO desde --serie-1, nunca
// cicladas ni reasignadas al cambiar de rango; el mapa de actividad es
// secuencial (magnitud) y usa UN solo tono con luminosidad creciente. Ambas
// paletas están validadas con el script de la guía en los dos temas, y la
// leyenda lleva siempre el valor escrito para que la identidad no dependa solo
// del color.
import { useMemo, useState } from 'react'
import { fmtElapsed, fmtTokens, modelLabelOf } from '../lib/helpers.js'
import { apiladas, diasDelRango, nivel, porModelo, rachas, rejilla, resumen } from '../lib/estadisticas.js'
import { t, plural, locale } from '../lib/i18n.js'
import { IconClose, IconStats, IconToken, IconClock, IconChat, IconBolt, IconCheck, IconBranch } from '../components/icons.jsx'

const RANGOS = ['7d', '30d', 'all']
// Cuántas semanas caben en el mapa sin apretar las celdas en el ancho del panel.
const SEMANAS = 18

export default function StatsPanel({ open, onClose, data = {}, memberOf }) {
  const [vista, setVista] = useState('resumen')
  const [rango, setRango] = useState('30d')
  // Las cuentas se recalculan solo al cambiar de rango o de datos, no en cada
  // render: el panel se re-renderiza también al mover el ratón por encima.
  const calc = useMemo(() => {
    const dias = diasDelRango(data, rango)
    const res = resumen(dias)
    const activos = dias.filter((d) => (Number(d.tasks) || 0) > 0).map((d) => d.key)
    const modelos = porModelo(dias)
    return { dias, res, racha: rachas(activos), modelos, series: apiladas(dias, modelos.map((m) => m.id)) }
  }, [data, rango])

  if (!open) return null

  const { dias, res, racha, modelos, series } = calc
  const colorSerie = (i) => (modelos[i]?.id === '__otros__' ? 'var(--serie-otros)' : `var(--serie-${(i % 4) + 1})`)
  const nombreModelo = (m) => (m.id === '__otros__' ? t('stats.others', { n: m.otros }) : modelLabelOf(m.id) || m.id)

  return (
    <div className="drawer over">
      <div className="drawer-head">
        <b>{t('panel.stats')}</b>
        <button onClick={() => onClose()} title={t('panel.back')}><IconClose size={16} /></button>
      </div>

      {/* Filtros en UNA fila sobre los gráficos: la vista a la izquierda y el
          rango a la derecha, que es el orden en que se decide qué se mira. */}
      <div className="stats-tools">
        <div className="stats-tabs">
          {['resumen', 'modelos'].map((v) => (
            <button key={v} type="button" className={v === vista ? 'stats-tab on' : 'stats-tab'} onClick={() => setVista(v)}>
              {t(`stats.tab.${v}`)}
            </button>
          ))}
        </div>
        <div className="stats-tabs">
          {RANGOS.map((r) => (
            <button key={r} type="button" className={r === rango ? 'stats-tab on' : 'stats-tab'} onClick={() => setRango(r)}>
              {t(`stats.range.${r}`)}
            </button>
          ))}
        </div>
      </div>

      {!res.turnos ? (
        <div className="hist-empty">{t('stats.empty')}</div>
      ) : vista === 'resumen' ? (
        <Resumen data={data} res={res} racha={racha} dias={dias} modelos={modelos} memberOf={memberOf} />
      ) : (
        <Modelos modelos={modelos} series={series} res={res} colorSerie={colorSerie} nombreModelo={nombreModelo} />
      )}
    </div>
  )
}

function Tarjeta({ ico, valor, k, title }) {
  return (
    <div className="stat-card" title={title || ''}>
      {ico && <span className="stat-ico">{ico}</span>}
      <b>{valor}</b>
      <span className="stat-k">{k}</span>
    </div>
  )
}

function Resumen({ data, res, racha, dias, modelos, memberOf }) {
  const celdas = rejilla(data, SEMANAS)
  const maxCelda = Math.max(...celdas.map((c) => c.tokens), 1)
  // Agregado por tripulante del rango que se está mirando.
  const agentes = {}
  for (const d of dias)
    for (const [id, a] of Object.entries(d.agents || {})) {
      const acc = (agentes[id] ||= { tasks: 0, tokens: 0, ms: 0 })
      acc.tasks += Number(a.tasks) || 0
      acc.tokens += Number(a.tokens) || 0
      acc.ms += Number(a.ms) || 0
    }
  const filas = Object.entries(agentes).sort((a, b) => b[1].tokens - a[1].tokens)
  const maxAgente = Math.max(...filas.map(([, a]) => a.tokens), 1)
  const horaTxt = res.horaPunta === null ? '—' : `${String(res.horaPunta).padStart(2, '0')}:00`
  const modeloTxt = res.modeloTop ? modelLabelOf(res.modeloTop) : '—'

  return (
    <>
      <div className="stat-cards">
        <Tarjeta ico={<IconChat size={14} />} valor={res.sesiones || '—'} k={t('stats.sessions')} title={t('stats.sessionsTitle')} />
        <Tarjeta ico={<IconStats size={14} />} valor={res.turnos} k={t('stats.turns')} title={t('stats.turnsTitle')} />
        <Tarjeta ico={<IconToken size={14} />} valor={fmtTokens(res.tokens)} k={t('stats.tokens')} />
        <Tarjeta ico={<IconClock size={14} />} valor={fmtElapsed(res.ms)} k={t('stats.time')} />
        <Tarjeta ico={<IconCheck size={14} />} valor={res.diasActivos} k={t('stats.activeDays')} />
        <Tarjeta ico={<IconBolt size={14} />} valor={t('stats.days', { n: racha.actual })} k={t('stats.streak')} title={t('stats.streakTitle')} />
        <Tarjeta ico={<IconBranch size={14} />} valor={t('stats.days', { n: racha.max })} k={t('stats.streakMax')} />
        <Tarjeta valor={horaTxt} k={t('stats.peakHour')} title={t('stats.peakHourTitle')} />
      </div>
      <div className="stat-cards">
        <Tarjeta valor={modeloTxt} k={t('stats.favModel')} title={t('stats.favModelTitle')} />
        <Tarjeta valor={fmtTokens(res.entrada)} k={t('stats.in')} title={t('stats.inTitle')} />
        <Tarjeta valor={fmtTokens(res.salida)} k={t('stats.out')} title={t('stats.outTitle')} />
      </div>

      {/* Aviso honesto: los datos por modelo, hora y entrada/salida empezaron a
          guardarse con esta versión. Sin esto, las tarjetas en «—» se leen como
          «no has trabajado» en vez de «esto aún no se medía». */}
      {!res.conDatosNuevos && <div className="skills-note">{t('stats.newDataNote')}</div>}

      <div className="menu-sec">{t('stats.map', { n: SEMANAS })}</div>
      <div className="heat">
        {Array.from({ length: SEMANAS }, (_, col) => (
          <div key={col} className="heat-col">
            {celdas.slice(col * 7, col * 7 + 7).map((c) => (
              <span
                key={c.key}
                className={c.futuro ? 'heat-cell futuro' : `heat-cell n${nivel(c.tokens, maxCelda)}`}
                title={c.futuro ? '' : t('stats.cellTitle', { day: c.key, n: c.turnos, s: plural(c.turnos), tok: fmtTokens(c.tokens) })}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heat-leyenda">
        <span>{t('stats.less')}</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <span key={n} className={`heat-cell n${n}`} />
        ))}
        <span>{t('stats.more')}</span>
      </div>

      <div className="menu-sec">{t('stats.byAgent')}</div>
      {filas.map(([id, a]) => (
        <div key={id} className="stat-agent">
          <div className="stat-agent-top">
            <span>
              {memberOf(id).emoji} {memberOf(id).name}
            </span>
            <span className="stat-agent-num">{t('stats.tokensSuffix', { n: fmtTokens(a.tokens) })}</span>
          </div>
          <div className="stat-agent-bar">
            <div style={{ width: `${(a.tokens / maxAgente) * 100}%`, background: memberOf(id).color || 'var(--accent)' }} />
          </div>
          <div className="stat-agent-sub">
            {t('stats.avg', { n: a.tasks, s: plural(a.tasks), avg: fmtElapsed(a.ms / Math.max(a.tasks, 1)) })}
          </div>
        </div>
      ))}
      {modelos.length > 0 && <div className="skills-note">{t('stats.keep')}</div>}
    </>
  )
}

function Modelos({ modelos, series, res, colorSerie, nombreModelo }) {
  if (!modelos.length) return <div className="hist-empty">{t('stats.noModels')}</div>
  const max = Math.max(...series.map((s) => s.total), 1)
  // Solo los días CON tokens: en «todo» las columnas vacías de meses sin trabajo
  // aplastarían las que sí tienen, y el eje dejaría de decir nada.
  const conDatos = series.filter((s) => s.total > 0)
  const dia = (k) => new Date(`${k}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })

  return (
    <>
      <div className="stat-cards">
        <Tarjeta ico={<IconToken size={14} />} valor={fmtTokens(res.tokens)} k={t('stats.tokens')} />
        <Tarjeta valor={fmtTokens(res.entrada)} k={t('stats.in')} title={t('stats.inTitle')} />
        <Tarjeta valor={fmtTokens(res.salida)} k={t('stats.out')} title={t('stats.outTitle')} />
      </div>

      <div className="menu-sec">{t('stats.byDay')}</div>
      {!conDatos.length ? (
        <div className="skills-note">{t('stats.noModelsRange')}</div>
      ) : (
        <div className="mstack">
          {conDatos.map((s) => (
            <div key={s.key} className="mstack-col" title={t('stats.dayTitle', { day: dia(s.key), tok: fmtTokens(s.total) })}>
              <div className="mstack-bar">
                {s.partes.map((v, i) =>
                  v > 0 ? (
                    <span
                      key={i}
                      className="mstack-seg"
                      style={{ height: `${(v / max) * 100}%`, background: colorSerie(i) }}
                      title={`${nombreModelo(modelos[i])} · ${fmtTokens(v)}`}
                    />
                  ) : null
                )}
              </div>
              <span className="mstack-day">{dia(s.key)}</span>
            </div>
          ))}
        </div>
      )}

      {/* La leyenda ES la tabla: nombre, entrada, salida y porcentaje. Cumple dos
          cosas a la vez — que la identidad no dependa solo del color, y la regla
          de relieve del tema claro, donde dos series quedan por debajo de 3:1. */}
      <div className="menu-sec">{t('stats.share')}</div>
      <div className="mleg">
        {modelos.map((m, i) => (
          <div key={m.id} className="mleg-row">
            <span className="mleg-dot" style={{ background: colorSerie(i) }} />
            <span className="mleg-name">{nombreModelo(m)}</span>
            <span className="mleg-io">{t('stats.io', { in: fmtTokens(m.entrada), out: fmtTokens(m.salida) })}</span>
            <span className="mleg-pct">{m.pct >= 0.1 ? `${m.pct.toFixed(1)}%` : '<0.1%'}</span>
          </div>
        ))}
      </div>
    </>
  )
}
