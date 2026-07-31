// Monitor de recursos y cuota de Claude (refactor #94).
import { useEffect, useState } from 'react'
import { fmtReset, fmtTokens, ventanaDe } from '../lib/helpers.js'
import { t } from '../lib/i18n.js'

// Logo de Apple (sistema) y spark de Claude, como SVG inline.
const AppleIcon = () => (
  <svg viewBox="0 0 384 512" width="11" height="11" fill="#e9f1ee">
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.7-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
  </svg>
)
const ClaudeIcon = () => {
  const spokes = [8, 41, 74, 106, 139, 172, 205, 238, 272, 305, 338].map((deg, i) => {
    const a = (deg * Math.PI) / 180
    const len = 8.6 + (i % 3) * 0.7
    return <line key={deg} x1="12" y1="12" x2={12 + Math.cos(a) * len} y2={12 + Math.sin(a) * len} />
  })
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" stroke="#da7756" strokeWidth="3" strokeLinecap="round">
      {spokes}
    </svg>
  )
}

function Bar({ pct }) {
  const p = Math.min(100, Math.max(0, pct || 0))
  return (
    <div className="mon-bar">
      <div className={p > 80 ? 'hot' : ''} style={{ width: `${p}%` }} />
    </div>
  )
}

export default function SysMonitor({ modelLabel, model, profile, tokens, contexto = 0, innerRef }) {
  const tokTotal = tokens ? tokens.in + tokens.out + tokens.cache : 0
  const [s, setS] = useState(null)
  useEffect(() => {
    let on = true
    const tick = async () => {
      const d = await window.oficina?.stats?.(profile)
      if (on && d) setS(d)
    }
    tick()
    const iv = setInterval(tick, 3000)
    // al volver a la ventana, refrescar el % (por si la sesión se reinició fuera)
    const onFocus = () => {
      window.oficina?.refreshUsage?.()
      tick()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      on = false
      clearInterval(iv)
      window.removeEventListener('focus', onFocus)
    }
  }, [profile])
  if (!s) return null
  const gb = (b) => (b / 1073741824).toFixed(1)
  const ramPct = (s.ramUsed / s.ramTotal) * 100
  // dos burbujas independientes apiladas: sistema arriba, claude debajo
  return (
    <div className="sysmon-stack" ref={innerRef}>
      <div className="sysmon">
        <div className="mon-title">
          <AppleIcon /> {t('mon.system')}
        </div>
        <div className="mon-row">
          <span>CPU</span>
          <Bar pct={s.cpu} />
          <b>{s.cpu}%</b>
        </div>
        <div className="mon-row">
          <span>RAM</span>
          <Bar pct={ramPct} />
          <b>
            {gb(s.ramUsed)}/{gb(s.ramTotal)}G
          </b>
        </div>
        <div className="mon-row">
          <span>App</span>
          <span className="mon-app">{s.appMB} MB</span>
        </div>
      </div>
      {/* la burbuja de claude existe siempre: si el uso aún no llegó (API
          rate-limited, sin red, primer arranque) muestra el modelo y un aviso
          en vez de desaparecer en silencio */}
      <div className="sysmon">
        <div className="mon-title">
          <ClaudeIcon /> claude
        </div>
        {modelLabel && (
          <div className="mon-row">
            <span>{t('mon.model')}</span>
            <span className="mon-model">{modelLabel}</span>
          </div>
        )}
        {tokTotal > 0 && (
          <div
            className="mon-row mon-wrap"
            title={t('mon.tokTitle', { in: fmtTokens(tokens.in), out: fmtTokens(tokens.out), cache: fmtTokens(tokens.cache) })}
          >
            <span>{t('mon.tokens')}</span>
            <span className="mon-model">{t('mon.thisConv', { n: fmtTokens(tokTotal) })}</span>
          </div>
        )}
        {contexto > 0 && (() => {
          // aviso antes de que Claude compacte solo y el agente «olvide» (#123)
          const pct = Math.min(100, (contexto / ventanaDe(model)) * 100)
          return (
            <>
              <div className="mon-row" title={t('mon.ctxTitle', { n: fmtTokens(contexto), max: fmtTokens(ventanaDe(model)) })}>
                <span>{t('mon.context')}</span>
                <Bar pct={pct} />
                <b>{Math.round(pct)}%</b>
              </div>
              {/* El absoluto contra la ventana, en su propia línea. Junto al % le
                  dejaba a la barra 40px, y el porcentaje solo no se puede
                  contrastar con nada: era justo el dato que faltaba para ver que
                  el 100% no cuadraba con la ventana del modelo. */}
              <div className="mon-sub">
                {fmtTokens(contexto)} / {fmtTokens(ventanaDe(model))}
              </div>
            </>
          )
        })()}
        {!(s.claude && (s.claude.session || s.claude.weekly)) && (
          <div className="mon-sub mon-nodata">
            {s.claudeLimitedFor ? t('mon.limited', { m: s.claudeLimitedFor }) : t('mon.noUsage')}
          </div>
        )}
        {s.claude?.session && (
          <>
            <div className="mon-row">
              <span>{t('mon.session')}</span>
              <Bar pct={s.claude.session.pct} />
              <b>{Math.round(s.claude.session.pct)}%</b>
            </div>
            <div className="mon-sub">{t('mon.resets', { t: fmtReset(s.claude.session.resetsAt) })}</div>
          </>
        )}
        {s.claude?.weekly && (
          <>
            <div className="mon-row">
              <span>{t('mon.week')}</span>
              <Bar pct={s.claude.weekly.pct} />
              <b>{Math.round(s.claude.weekly.pct)}%</b>
            </div>
            <div className="mon-sub">{t('mon.resets', { t: fmtReset(s.claude.weekly.resetsAt) })}</div>
          </>
        )}
      </div>
    </div>
  )
}
