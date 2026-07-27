// Consola de diagnóstico (#125): extraída de App.jsx tal cual.
import { t, locale } from '../lib/i18n.js'
import { IconClose, IconCopy, IconRefresh } from '../components/icons.jsx'

export default function DiagPanel({ open, onClose, rows = [], text, memberOf, onRefresh, toast }) {
  if (!open) return null
  return (
    <div className="drawer over">
      <div className="drawer-head">
        <b>{t('panel.diag')}</b>
        <button onClick={() => onClose()} title={t('panel.back')}><IconClose size={16} /></button>
      </div>
      <div className="diag-actions">
        <button
          type="button"
          className="skill-manual"
          onClick={() => {
            navigator.clipboard.writeText(text())
            toast(t('toast.logCopied'))
          }}
        >
          <IconCopy size={13} /> {t('diag.copyAll')}
        </button>
        <button
          type="button"
          className="skill-manual"
          onClick={() => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }))
            a.download = `la-oficina-diagnostico-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`
            a.click()
            URL.revokeObjectURL(a.href)
            toast(t('toast.logExported'))
          }}
        >
          ⬇ {t('diag.export')}
        </button>
        <button type="button" className="skill-manual" onClick={onRefresh}><IconRefresh size={13} /> {t('diag.refresh')}</button>
      </div>
      {rows.length === 0 && <div className="hist-empty">{t('diag.empty')}</div>}
      {rows.map((r, i) => (
        <div key={i} className={`diag-row ${r.kind}`}>
          <span className="diag-time">{new Date(r.t).toLocaleTimeString(locale())}</span>
          <span className="diag-role">{memberOf(r.role).name || r.role}</span>
          <span className="diag-kind">{r.kind}</span>
          <span className="diag-info">{r.info}</span>
        </div>
      ))}
    </div>
  )
}
