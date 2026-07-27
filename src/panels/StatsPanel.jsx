// Panel de estadísticas (#125): extraído de App.jsx tal cual, sin cambios de
// contenido. Recibe los datos ya cargados — no toca localStorage ni IPC.
import { fmtElapsed, fmtTokens } from '../lib/helpers.js'
import { t, plural, locale } from '../lib/i18n.js'
import { IconClose, IconStats, IconToken, IconClock } from '../components/icons.jsx'

export default function StatsPanel({ open, onClose, data = {}, memberOf }) {
  if (!open) return null
  return (
    <div className="drawer over">
      <div className="drawer-head">
        <b>{t('panel.stats')}</b>
        <button onClick={() => onClose()} title={t('panel.back')}><IconClose size={16} /></button>
      </div>
      {(() => {
        const days = [...Array(14)].map((_, i) => {
          const d = new Date(Date.now() - (13 - i) * 86400000)
          const key = d.toISOString().slice(0, 10)
          return {
            key,
            label: d.toLocaleDateString(locale(), { weekday: 'narrow' }),
            dia: d.getDate(),
            ...(data[key] || { tasks: 0, tokens: 0, ms: 0, agents: {} }),
          }
        })
        const semana = days.slice(-7)
        const maxTok = Math.max(...days.map((d) => d.tokens), 1)
        // agregado por agente de los 14 días
        const agents = {}
        for (const d of days)
          for (const [id, a] of Object.entries(d.agents || {})) {
            const acc = (agents[id] ||= { tasks: 0, tokens: 0, ms: 0 })
            acc.tasks += a.tasks
            acc.tokens += a.tokens
            acc.ms += a.ms
          }
        const rows = Object.entries(agents).sort((a, b) => b[1].tokens - a[1].tokens)
        const totTasks = days.reduce((s2, d) => s2 + d.tasks, 0)
        const totTok = days.reduce((s2, d) => s2 + d.tokens, 0)
        const totMs = days.reduce((s2, d) => s2 + d.ms, 0)
        if (!totTasks) return <div className="hist-empty">{t('stats.empty')}</div>
        const maxAgente = Math.max(...rows.map(([, a]) => a.tokens), 1)
        // sparkline de tokens: polilínea suave sobre los 14 días
        const W = 320
        const H = 68
        const pts = days.map((d, i) => [(i / (days.length - 1)) * W, H - (d.tokens / maxTok) * (H - 8) - 4])
        const linePath = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
        const areaPath = `${linePath} L${W},${H} L0,${H} Z`
        return (
          <>
            {/* tarjetas de resumen */}
            <div className="stat-cards">
              {[
                [t('stats.tasks'), totTasks, <IconStats key="t" size={14} />],
                [t('stats.tokens'), fmtTokens(totTok), <IconToken key="k" size={14} />],
                [t('stats.time'), fmtElapsed(totMs), <IconClock key="c" size={14} />],
              ].map(([k, v, ico]) => (
                <div key={k} className="stat-card">
                  <span className="stat-ico">{ico}</span>
                  <b>{v}</b>
                  <span className="stat-k">{k}</span>
                </div>
              ))}
            </div>

            <div className="menu-sec">{t('stats.tokens14')}</div>
            <svg className="stat-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              <defs>
                <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75].map((g) => (
                <line key={g} x1="0" y1={H * g} x2={W} y2={H * g} stroke="#28353a" strokeWidth="0.7" />
              ))}
              <path d={areaPath} fill="url(#sparkFill)" />
              <path d={linePath} fill="none" stroke="#2dd4bf" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((pt, i) => (
                <circle key={i} cx={pt[0]} cy={pt[1]} r={i === pts.length - 1 ? 3 : 1.6} fill="#2dd4bf" />
              ))}
            </svg>

            <div className="menu-sec">{t('stats.tasksWeek')}</div>
            <div className="stats-bars">
              {semana.map((d) => {
                const maxT = Math.max(...semana.map((x) => x.tasks), 1)
                return (
                  <div key={d.key} className="stats-col" title={t('stats.colTitle', { day: d.key, n: d.tasks, tok: fmtTokens(d.tokens) })}>
                    <span className="stats-val">{d.tasks || ''}</span>
                    <div className="stats-bar" style={{ height: `${Math.max((d.tasks / maxT) * 100, 2)}%` }} />
                    <span className="stats-day">{d.label}</span>
                  </div>
                )
              })}
            </div>

            <div className="menu-sec">{t('stats.byAgent')}</div>
            {rows.map(([id, a]) => (
              <div key={id} className="stat-agent">
                <div className="stat-agent-top">
                  <span>
                    {memberOf(id).emoji} {memberOf(id).name}
                  </span>
                  <span className="stat-agent-num">{t('stats.tokensSuffix', { n: fmtTokens(a.tokens) })}</span>
                </div>
                <div className="stat-agent-bar">
                  <div style={{ width: `${(a.tokens / maxAgente) * 100}%`, background: memberOf(id).color || '#2dd4bf' }} />
                </div>
                <div className="stat-agent-sub">
                  {t('stats.avg', { n: a.tasks, s: plural(a.tasks), avg: fmtElapsed(a.ms / Math.max(a.tasks, 1)) })}
                </div>
              </div>
            ))}
            <div className="skills-note">{t('stats.keep')}</div>
          </>
        )
      })()}
    </div>
  )
}
