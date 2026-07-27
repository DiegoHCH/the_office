// Render de markdown del chat: bloques de código con copiar y resaltado
// de sintaxis controlado (refactor #94).
import { useMemo, useRef, useState } from 'react'
// highlight.js: solo el core + los lenguajes que realmente aparecen en el chat
import hljs from 'highlight.js/lib/core'
import hljsJs from 'highlight.js/lib/languages/javascript'
import hljsTs from 'highlight.js/lib/languages/typescript'
import hljsPy from 'highlight.js/lib/languages/python'
import hljsBash from 'highlight.js/lib/languages/bash'
import hljsJson from 'highlight.js/lib/languages/json'
import hljsCss from 'highlight.js/lib/languages/css'
import hljsXml from 'highlight.js/lib/languages/xml'
import hljsSql from 'highlight.js/lib/languages/sql'
import hljsYaml from 'highlight.js/lib/languages/yaml'
import hljsMd from 'highlight.js/lib/languages/markdown'
import hljsGo from 'highlight.js/lib/languages/go'
import hljsJava from 'highlight.js/lib/languages/java'

hljs.registerLanguage('javascript', hljsJs)
hljs.registerLanguage('typescript', hljsTs)
hljs.registerLanguage('python', hljsPy)
hljs.registerLanguage('bash', hljsBash)
hljs.registerLanguage('json', hljsJson)
hljs.registerLanguage('css', hljsCss)
hljs.registerLanguage('xml', hljsXml) // cubre html
hljs.registerLanguage('sql', hljsSql)
hljs.registerLanguage('yaml', hljsYaml)
hljs.registerLanguage('markdown', hljsMd)
hljs.registerLanguage('go', hljsGo)
hljs.registerLanguage('java', hljsJava)
// alias frecuentes en los fences de Claude
const HLJS_ALIASES = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', html: 'xml', yml: 'yaml', md: 'markdown' }

// Bloque de código del markdown con botón de copiar (visible al hover).
function CodePre({ children, ...props }) {
  const ref = useRef(null)
  const [copied, setCopied] = useState(false)
  return (
    <div className="pre-wrap">
      <pre ref={ref} {...props}>
        {children}
      </pre>
      <button
        type="button"
        className="copy-btn"
        title="Copiar código"
        onClick={() => {
          navigator.clipboard.writeText(ref.current?.innerText || '')
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        }}
      >
        {copied ? '✓ Copiado' : '📋'}
      </button>
    </div>
  )
}
// Resaltado de sintaxis controlado (hljs.highlight → HTML, sin mutar el DOM):
// seguro con React aunque el markdown siga llegando en streaming.
function CodeBlock({ inline, className = '', children, ...props }) {
  const raw = String(children ?? '')
  // los `código` inline no llevan language- ni saltos de línea
  const isInline = inline || (!/language-/.test(className) && !raw.includes('\n'))
  const langRaw = /language-(\w+)/.exec(className)?.[1]?.toLowerCase()
  const lang = HLJS_ALIASES[langRaw] || langRaw
  const html = useMemo(() => {
    if (isInline || !lang || !hljs.getLanguage(lang)) return null
    try {
      return hljs.highlight(raw.replace(/\n$/, ''), { language: lang }).value
    } catch {
      return null
    }
  }, [raw, lang, isInline])
  if (isInline || html === null) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  }
  return <code className={`${className} hljs`} {...props} dangerouslySetInnerHTML={{ __html: html }} />
}
export const MD_COMPONENTS = { pre: CodePre, code: CodeBlock }
