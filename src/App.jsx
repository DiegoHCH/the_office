import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Office, { THEMES } from './Office.jsx'
import { popSound, dingSound, buzzSound, setSoundEnabled } from './sound.js'
import { NONHUMAN_AVATARS } from './scene/avatarThumbs.js'
import {
  fmtReset, autoGrow, fmtElapsed, fmtTokens, usageTotal, usageTitle, norm, escRe, extractOptions,
  MODEL_OPTIONS, MODEL_ALIASES, FALLBACK_MODEL, modelLabelOf,
} from './lib/helpers.js'
import { ROLE_META, metaOf, MAX_ACTIVE, canDelete, AVATARS, prettyArtifact, avatarLabel, SQUAD_PRESETS } from './data/roles.js'
import { SKILL_CATALOG, ROLE_TAGS, MCP_CATALOG, toolInfo, SEED_SNIPPETS } from './data/catalogs.js'
import { MD_COMPONENTS } from './components/markdown.jsx'
import SysMonitor from './components/SysMonitor.jsx'
import Tour from './components/Tour.jsx'
import Intro from './scene/Intro.jsx'
import { AvatarThumb, AttThumb } from './components/thumbs.jsx'

const STANDUP_PROMPT = `Reunión de standup del squad. Responde BREVE (máximo 5 líneas, con viñetas), en tu personaje:
1) ¿En qué trabajamos la última vez?
2) ¿Quedó algo pendiente o bloqueado?
3) ¿Qué sugieres hacer hoy?
Si no tienes contexto previo conmigo en este proyecto, dilo en una línea y sugiere en qué puedes ayudar según tu rol. No uses herramientas salvo que sea imprescindible.`

// A qué miembro va el mensaje: nombre al inicio / @nombre / keywords / principal.
function routeMessage(text, squad, principal) {
  const t = norm(text)
  for (const m of squad) {
    const n = escRe(norm(m.name))
    if (new RegExp(`^${n}\\b`).test(t) || t.includes(`@${norm(m.name)}`)) return m.id
  }
  for (const m of squad) if (m.id !== principal && m.kw?.test(t)) return m.id
  return principal
}

// ¿El mensaje pide pasarle el resultado a otro miembro? ("...y pásaselo al Dev",
// "Research -> Dev: ...", "para que el QA lo pruebe")
function detectHandoff(text, squad, fromId) {
  const t = norm(text)
  const verb = /(pasal|pasasel|pasa el resultado|entregal|entregasel|entrega el resultado|dasel|dale el resultado|para que|y que)/.test(t)
  for (const m of squad) {
    if (m.id === fromId) continue
    const n = escRe(norm(m.name))
    if (new RegExp(`(?:->|→)\\s*${n}\\b`).test(t)) return m.id
    if (verb && new RegExp(`\\b(?:a|para(?:\\s+que)?|que)\\s+${n}\\b`).test(t)) return m.id
  }
  return null
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [convTokens, setConvTokens] = useState({ in: 0, out: 0, cache: 0 }) // tokens de la conversación
  const [agentTodos, setAgentTodos] = useState({}) // rol → checklist (TodoWrite) mientras trabaja
  const [agentTool, setAgentTool] = useState({}) // rol → su última tool (para el ayudante 👻 de Task)
  const [standupIds, setStandupIds] = useState([]) // participantes del standup (se reúnen en la escena)
  // buscar dentro de la conversación (⌘F)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findIdx, setFindIdx] = useState(0)
  const findInputRef = useRef(null)
  const messagesRef = useRef([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  const deepLinkRef = useRef(() => {}) // handler de la-oficina:// con closures frescas
  const retriedRef = useRef(new Set()) // jobs que ya gastaron su auto-retry
  const autoRetryRef = useRef(() => {}) // re-despacho con closures frescas
  // vista de diff: qué roles editaron archivos en su tarea actual
  const editedRef = useRef({})
  const [diffView, setDiffView] = useState(null) // null | { loading } | { diff, untracked, error }
  const [lightbox, setLightbox] = useState(null) // data URL de la imagen ampliada
  // citar selección (#97): al soltar el mouse con texto seleccionado dentro de
  // una respuesta, aparece un botón flotante que lo lleva al composer
  const [quote, setQuote] = useState(null) // {text, x, y}
  const onChatMouseUp = () => {
    const sel = window.getSelection?.()
    const text = sel?.toString().trim()
    if (!text || text.length < 2) return setQuote(null)
    // solo dentro de mensajes del asistente
    let node = sel.anchorNode
    while (node && node !== document.body) {
      if (node.nodeType === 1 && node.classList?.contains('msg')) break
      node = node.parentNode
    }
    if (!node?.classList?.contains?.('assistant')) return setQuote(null)
    const r = sel.getRangeAt(0).getBoundingClientRect()
    setQuote({ text: text.slice(0, 1200), x: r.left + r.width / 2, y: r.top - 10 })
  }
  const useQuote = () => {
    const q = quote.text
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
    setInput((v) => `${q}\n\n${v}`)
    setQuote(null)
    window.getSelection?.()?.removeAllRanges()
    const el = inputRef.current
    if (el) {
      el.focus()
      requestAnimationFrame(() => autoGrow(el))
    }
  }
  // intro cinemática (#112): edificio → puertas → destello → la oficina.
  // Se salta con Esc, con el botón, o si el sistema pide menos movimiento.
  const [introOpen, setIntroOpen] = useState(() => {
    if (localStorage.getItem('oficina-intro') === '0') return false
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  })
  const [introOn, setIntroOn] = useState(() => localStorage.getItem('oficina-intro') !== '0')
  const [introFade, setIntroFade] = useState(false)
  const saveIntro = (v) => {
    setIntroOn(v)
    localStorage.setItem('oficina-intro', v ? '1' : '0')
    showToast(v ? '🎬 La intro se verá al abrir la app' : 'Intro desactivada')
  }

  // Tour de bienvenida: espera a que la intro termine (si no, se dispara
  // debajo de ella y salta encima justo al acabar) y se marca como visto al
  // MOSTRARLO, no al completarlo — así no reaparece si cierras la app antes.
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    if (introOpen) return // la intro manda; el tour espera su turno
    if (localStorage.getItem('oficina-tour-done')) return
    const t = setTimeout(() => {
      setTourOpen(true)
      try {
        localStorage.setItem('oficina-tour-done', '1')
      } catch {}
    }, 1200)
    return () => clearTimeout(t)
  }, [introOpen])
  const endTour = () => {
    try {
      localStorage.setItem('oficina-tour-done', '1')
    } catch {}
    setTourOpen(false)
  }
  const [status, setStatus] = useState('Esperándote')
  const [roleStates, setRoleStates] = useState({})
  const [tool, setTool] = useState(null)
  const [input, setInput] = useState('')
  const [cfg, setCfg] = useState(null)
  const [profile, setProfile] = useState('work')
  const [project, setProject] = useState('')
  const [writeMode, setWriteMode] = useState(true)
  const [model, setModel] = useState(FALLBACK_MODEL)
  const [histOpen, setHistOpen] = useState(false)
  const [histList, setHistList] = useState([])
  const [histQuery, setHistQuery] = useState('') // filtro del panel de historial
  const [chatFilter, setChatFilter] = useState(null) // ver solo la conversación de un agente
  const [artsOpen, setArtsOpen] = useState(false)
  const [artsList, setArtsList] = useState([])
  const [artsDir, setArtsDir] = useState('')
  const [sound, setSound] = useState(() => localStorage.getItem('oficina-sound') !== '0')
  const [theme, setTheme] = useState('clasico') // se carga por perfil al iniciar/cambiar
  const themeLoaded = useRef(false) // evita machacar el guardado antes de hidratar
  // Tema "auto": 🌙 Noche de 19:00 a 07:00, Clásico de día. Un tick por minuto
  // re-evalúa la hora solo mientras el modo auto está elegido.
  const [, setThemeTick] = useState(0)
  useEffect(() => {
    if (theme !== 'auto') return
    const iv = setInterval(() => setThemeTick((t) => t + 1), 60_000)
    return () => clearInterval(iv)
  }, [theme])
  const hourNow = new Date().getHours()
  const effectiveTheme = theme === 'auto' ? (hourNow >= 19 || hourNow < 7 ? 'noche' : 'clasico') : theme
  const [board, setBoard] = useState(() => localStorage.getItem('oficina-board') !== '0')
  const [roster, setRoster] = useState([]) // config completa (6 roles)
  const [agentsOpen, setAgentsOpen] = useState(false) // panel 👥 Agentes (squad)
  const [skillsOpen, setSkillsOpen] = useState(false) // panel 🧩 Skills (catálogo por perfil)
  const [mcpOpen, setMcpOpen] = useState(false) // panel 🌐 MCP (servidores por perfil)
  const [hasClaudeMd, setHasClaudeMd] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false) // panel 📈 Estadísticas
  const [statsData, setStatsData] = useState({})
  const [diagOpen, setDiagOpen] = useState(false) // panel 🔧 Diagnóstico
  const [diagRows, setDiagRows] = useState([])
  const diagRef = useRef([]) // ring buffer de eventos del stream (máx 500)
  const [installedSkills, setInstalledSkills] = useState(null) // null = leyendo
  const [skillBusy, setSkillBusy] = useState(null) // id de la skill en proceso
  const [prefsOpen, setPrefsOpen] = useState(false) // panel ⚙️ Configuración
  const [ctxOpen, setCtxOpen] = useState(false) // dropdown de perfil + proyecto
  const [draft, setDraft] = useState([]) // copia editable del roster en el panel Agentes
  const [avatarPicker, setAvatarPicker] = useState(null) // miembro eligiendo personaje
  const [addingRole, setAddingRole] = useState(false) // form "agregar rol" abierto
  const NEW_ROLE = { name: '', focus: '', emoji: '🛠️', color: '#38bdf8', kw: '', avatar: '', model: '' }
  const [nr, setNr] = useState(NEW_ROLE) // borrador del rol nuevo (o en edición)
  const [editingId, setEditingId] = useState(null) // rol custom que se está editando
  const [toast, setToast] = useState(null)
  const [appVersion, setAppVersion] = useState('') // pie del menú de Configuración
  const [doneChip, setDoneChip] = useState(null) // "✅ X respondió" transitorio
  const doneChipTimer = useRef(null)
  const [deliverTargets, setDeliverTargets] = useState({}) // a quién camina cada entrega
  const [attachments, setAttachments] = useState([]) // imágenes pegadas/arrastradas
  const [refs, setRefs] = useState([]) // carpetas/archivos del disco arrastrados
  const handoffsRef = useRef([]) // [{from, to, original, result?}]
  const lastJobRef = useRef({}) // role → último job despachado (para Reintentar)
  const queuesRef = useRef({}) // role → [jobs] pendientes cuando está ocupado
  const [queuedCounts, setQueuedCounts] = useState({}) // espejo reactivo de queuesRef (badge ⏳ en la escena)
  const syncQueues = () => {
    const counts = {}
    for (const k of Object.keys(queuesRef.current)) {
      const n = queuesRef.current[k]?.length || 0
      if (n) counts[k] = n
    }
    setQueuedCounts(counts)
    // la cola sobrevive un cierre de la app: se ofrece retomarla al arrancar
    try {
      const jobs = Object.values(queuesRef.current)
        .flat()
        .map(({ id, target, text, display, prompt, atts }) => ({ id, target, text, display, prompt, atts }))
      if (jobs.length) localStorage.setItem('oficina-pending-queue', JSON.stringify({ profile, project, jobs }))
      else localStorage.removeItem('oficina-pending-queue')
    } catch {}
  }
  const pendingArtifactRef = useRef({}) // role → true si generó un artifact en este turno
  const toastTimer = useRef(null)
  const sessionsRef = useRef({})
  const convIdRef = useRef(null)
  const logRef = useRef(null)
  const inputRef = useRef(null)

  // squad activo (máx MAX_ACTIVE) con su meta visual; el primero es el principal
  const squad = useMemo(
    () =>
      roster
        .filter((r) => r.enabled)
        .slice(0, MAX_ACTIVE)
        .map((r) => {
          const meta = metaOf(r)
          const url = r.avatar ? `/models/pj/${r.avatar}` : meta.url
          return {
            id: r.id,
            name: r.name,
            ...meta,
            url,
            // los humanos llevan piel natural; goblins/zombies/robot no
            human: !NONHUMAN_AVATARS.has(url.split('/').pop()),
          }
        }),
    [roster]
  )
  const principal = squad[0]?.id || 'dev'
  const principalRef = useRef(principal)
  const squadRef = useRef(squad)
  useEffect(() => {
    principalRef.current = principal
    squadRef.current = squad
  }, [principal, squad])
  const memberOf = (id) => squad.find((m) => m.id === id) || { name: id, emoji: '🤖', color: '#93a6a1', label: id }
  // modelo efectivo de un agente: el suyo propio si lo fijó, si no el global
  const memberModel = (id) => squad.find((m) => m.id === id)?.model || model

  const projects = cfg?.projectsByProfile?.[profile] || []
  const running = Object.keys(roleStates)
  const runningRef = useRef([])
  useEffect(() => {
    runningRef.current = running
  }, [roleStates])
  // 'delivering' es la caminata de entrega (cosmética): la respuesta ya llegó,
  // así que no bloquea la UI — historial, config y selectores siguen usables.
  const busy = running.some((r) => roleStates[r] !== 'delivering')
  const startedAtRef = useRef({}) // role → Date.now() al arrancar su turno
  const setRS = (role, st) =>
    setRoleStates((s) => {
      const copy = { ...s }
      if (st === 'idle') {
        delete copy[role]
        delete startedAtRef.current[role]
      } else {
        if (!s[role]) startedAtRef.current[role] = Date.now() // empieza el cronómetro
        copy[role] = st
      }
      return copy
    })

  // badge del Dock: cuántos agentes están trabajando ahora mismo
  useEffect(() => {
    window.oficina?.dockBadge?.(running.length)
  }, [running.length])

  // tick de 1s mientras alguien trabaja, para que los cronómetros avancen
  const [, setClockTick] = useState(0)
  useEffect(() => {
    if (!running.length) return
    const iv = setInterval(() => setClockTick((t) => t + 1), 1000)
    return () => clearInterval(iv)
  }, [running.length])

  // role → "2m 15s"; solo a partir del minuto (antes sería ruido)
  const elapsed = {}
  for (const r of running) {
    const t = startedAtRef.current[r] ? Date.now() - startedAtRef.current[r] : 0
    if (t >= 60_000) elapsed[r] = fmtElapsed(t)
  }

  useEffect(() => {
    setSoundEnabled(sound)
    localStorage.setItem('oficina-sound', sound ? '1' : '0')
    window.oficina?.setNotify?.(sound) // también los avisos del sistema
  }, [sound])

  // el tema se guarda POR PERFIL (cada cuenta puede tener el suyo), solo tras hidratar
  useEffect(() => {
    if (!themeLoaded.current) return
    localStorage.setItem(`oficina-theme-${profile}`, theme)
  }, [theme, profile])

  // modelo y permiso también se persisten por perfil: al reiniciar la app no
  // vuelven al default de settings.json ni al modo edición
  useEffect(() => {
    if (!themeLoaded.current) return
    localStorage.setItem(`oficina-model-${profile}`, model)
  }, [model, profile])
  useEffect(() => {
    if (!themeLoaded.current) return
    localStorage.setItem(`oficina-write-${profile}`, writeMode ? '1' : '0')
  }, [writeMode, profile])
  // calidad gráfica (glow-up #111) y mascota 🦊, por perfil
  const [quality, setQuality] = useState('normal')
  const saveQuality = (v) => {
    setQuality(v)
    localStorage.setItem(`oficina-quality-${profile}`, v)
    showToast(v === 'cine' ? '🎬 Calidad Cine — profundidad de campo y bloom' : v === 'ligera' ? '🔋 Calidad Ligera — sin efectos' : '✨ Calidad Normal')
  }
  const [pet, setPet] = useState('')
  useEffect(() => {
    setPet(localStorage.getItem(`oficina-pet-${profile}`) || '')
    setQuality(localStorage.getItem(`oficina-quality-${profile}`) || 'normal')
  }, [profile])
  const savePet = (v) => {
    setPet(v)
    localStorage.setItem(`oficina-pet-${profile}`, v)
    showToast(v ? '🦊 ¡La mascota llegó a la oficina!' : 'La mascota se fue a casa')
  }

  useEffect(() => {
    localStorage.setItem('oficina-board', board ? '1' : '0')
    window.oficina?.setBoard?.(board)
  }, [board])

  const loadSquad = async (p) => {
    const r = (await window.oficina?.squad?.get(p)) || []
    setRoster(r)
  }

  // respaldo automático semanal de la configuración (#101), silencioso
  useEffect(() => {
    const t = setTimeout(() => {
      const extras = {}
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('oficina-') && k !== 'oficina-pending-queue' && k !== 'oficina-camera') extras[k] = localStorage.getItem(k)
      }
      window.oficina?.config?.autoBackup?.(extras)
    }, 8000) // sin estorbar el arranque
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (project) window.oficina?.hasClaudeMd?.(project).then(setHasClaudeMd)
  }, [project])

  useEffect(() => {
    window.oficina?.artifacts?.getDir?.().then(setArtsDir)
    window.oficina?.getVersion?.().then((v) => setAppVersion(v || ''))
    // nota pendiente de un import (skills fuera del catálogo que no se migran solas)
    try {
      const note = localStorage.getItem('oficina-import-note')
      if (note) {
        localStorage.removeItem('oficina-import-note')
        setTimeout(() => showToast(`⚠️ ${note}`, 9000), 1500)
      }
    } catch {}
  }, [])

  const refreshArtifacts = async () => setArtsList((await window.oficina?.artifacts?.list?.()) || [])
  // cierra todos los paneles laterales (cada toggle abre el suyo encima)
  const closePanels = () => {
    setHistOpen(false)
    setArtsOpen(false)
    setAgentsOpen(false)
    setPrefsOpen(false)
    setAvatarPicker(null)
    setCtxOpen(false)
    setSkillsOpen(false)
    setMcpOpen(false)
    setStatsOpen(false)
    setDiagOpen(false)
  }
  const toggleArts = async () => {
    if (!artsOpen) await refreshArtifacts()
    const next = !artsOpen
    closePanels()
    setArtsOpen(next)
  }
  const pickArtsDir = async () => {
    const res = await window.oficina?.artifacts?.pickDir?.()
    if (res?.ok) {
      setArtsDir(res.dir)
      showToast('📁 Carpeta de documentos actualizada')
    }
  }

  useEffect(() => {
    window.oficina?.getConfig?.().then((c) => {
      setCfg(c)
      const first = c.profiles[0]
      setProfile(first)
      setProject(c.projectsByProfile[first]?.[0]?.path || '')
      // el modelo persistido gana sobre el default de settings.json
      setModel(localStorage.getItem(`oficina-model-${first}`) || c.defaultModels?.[first] || FALLBACK_MODEL)
      setWriteMode(localStorage.getItem(`oficina-write-${first}`) !== '0')
      themeLoaded.current = true
      setTheme(localStorage.getItem(`oficina-theme-${first}`) || 'clasico')
      loadSquad(first)
    })
  }, [])

  // Si cambias el modelo por defecto desde la terminal (`/model` en Claude Code),
  // la app lo adopta al volver el foco a su ventana — salvo que aquí hayas
  // elegido otro modelo a mano (tu elección manual gana).
  useEffect(() => {
    const onFocus = async () => {
      const c = await window.oficina?.getConfig?.()
      if (!c) return
      const oldDefault = cfg?.defaultModels?.[profile]
      const newDefault = c.defaultModels?.[profile]
      setCfg(c)
      const followingDefault = oldDefault ? model === oldDefault : model === FALLBACK_MODEL
      if (newDefault && newDefault !== oldDefault && followingDefault) {
        setModel(newDefault)
        showToast(`Modelo → ${modelLabelOf(newDefault)} (cambiado desde la terminal)`)
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [cfg, profile, model])

  useEffect(() => {
    if (!window.oficina?.onEvent) return
    return window.oficina.onEvent((e) => {
      // 🔧 diagnóstico: todo evento (menos el chorro de texto) queda en el buffer
      if (e.kind !== 'text') {
        const info =
          e.kind === 'tool'
            ? `${e.name}${e.detail ? ` · ${String(e.detail).slice(0, 90)}` : ''}`
            : e.kind === 'error'
              ? `${String(e.message || '').slice(0, 120)}${e.detail ? ` — ${String(e.detail).slice(0, 200)}` : ''}`
              : e.kind === 'done'
                ? e.usage
                  ? `🪙 ${fmtTokens(usageTotal(e.usage))}`
                  : ''
                : e.kind === 'init'
                  ? (e.sessionId || '').slice(0, 8)
                  : ''
        diagRef.current.push({ t: Date.now(), role: e.role || '—', kind: e.kind, info })
        if (diagRef.current.length > 500) diagRef.current.shift()
      }
      // órdenes del proceso principal (Tray, atajo global) — no son del stream
      if (e.kind === 'new-chat') {
        newChat()
        return
      }
      if (e.kind === 'focus-composer') {
        inputRef.current?.focus()
        return
      }
      if (e.kind === 'deep-link') {
        deepLinkRef.current(e)
        return
      }
      if (e.kind === 'system-resumed') {
        // el Mac durmió: los streams en curso murieron — avisar si había trabajo
        if (runningRef.current.length) {
          showToast('😴 El Mac se suspendió a media tarea — usa ⏹ y 🔁 Reintentar si algún agente quedó colgado', 8000)
        }
        window.oficina?.refreshUsage?.()
        return
      }
      const who = e.role || principalRef.current
      const isP = who === principalRef.current
      if (e.kind === 'init') {
        if (e.sessionId) sessionsRef.current[who] = e.sessionId
        if (isP) setStatus('Pensando…')
      } else if (e.kind === 'todos') {
        setAgentTodos((t) => ({ ...t, [who]: e.todos }))
      } else if (e.kind === 'tool') {
        setTool({ role: who, name: e.name, detail: e.detail || null })
        setAgentTool((t) => ({ ...t, [who]: e.name }))
        // ¿editó archivos? su respuesta final ofrecerá «ver cambios» (git diff)
        if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(e.name)) editedRef.current[who] = true
        // ¿creó un artifact HTML? marcar para adjuntarlo a su respuesta al terminar
        if (e.name === 'Write' && /\.html?$/i.test(e.detail || '')) {
          pendingArtifactRef.current[who] = true
          setTimeout(refreshArtifacts, 400)
        }
        setRS(who, 'working')
        if (isP) setStatus(`${toolInfo(e.name)[1]}${e.detail ? ` · ${e.detail}` : ''}…`)
      } else if (e.kind === 'text') {
        setTool((t) => (t?.role === who ? null : t))
        setAgentTool((t) => {
          if (!t[who]) return t
          const copy = { ...t }
          delete copy[who]
          return copy
        })
        setRS(who, 'talking')
        if (isP) setStatus('Respondiendo…')
        setMessages((ms) => {
          const idx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && m.streaming)
          if (idx >= 0) {
            const copy = [...ms]
            copy[idx] = { ...copy[idx], text: copy[idx].text + e.text }
            return copy
          }
          return [...ms, { role: 'assistant', who, text: e.text, streaming: true }]
        })
      } else if (e.kind === 'done') {
        const usage = e.usage && usageTotal(e.usage) > 0 ? e.usage : null
        const edited = !!editedRef.current[who]
        delete editedRef.current[who]
        setMessages((ms) => {
          const idx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && m.streaming)
          if (idx >= 0) {
            const copy = [...ms]
            copy[idx] = { ...copy[idx], streaming: false, usage, edited }
            return copy
          }
          return e.result ? [...ms, { role: 'assistant', who, text: e.result, usage, edited }] : ms
        })
        // acumulado de tokens de la conversación (para el monitor de claude)
        if (usage)
          setConvTokens((t) => ({
            in: t.in + (usage.input_tokens || 0),
            out: t.out + (usage.output_tokens || 0),
            cache: t.cache + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
          }))
        // si generó un artifact este turno, adjuntar su enlace al mensaje del agente
        if (pendingArtifactRef.current[who]) {
          delete pendingArtifactRef.current[who]
          window.oficina?.artifacts?.list?.().then((list) => {
            const art = list?.[0]
            if (!art) return
            setMessages((ms) => {
              const idx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && !m.artifact)
              return idx < 0 ? ms : ms.map((m, i) => (i === idx ? { ...m, artifact: art } : m))
            })
          })
        }
        // ¿hay un handoff pendiente de este rol? guardar su resultado
        const entry = handoffsRef.current.find((h) => h.from === who && h.result == null)
        if (entry) entry.result = (e.result || '').slice(0, 6000) || '(sin salida)'
        // el principal solo camina cuando entrega a un compañero; los demás siempre
        setRS(who, isP && !entry ? 'idle' : 'delivering')
        // si entrega a un compañero, camina hacia ÉL (no hacia el principal)
        if (entry) setDeliverTargets((d) => ({ ...d, [who]: entry.to }))
        setTool((t) => (t?.role === who ? null : t))
        setAgentTool((t) => {
          if (!t[who]) return t
          const copy = { ...t }
          delete copy[who]
          return copy
        })
        setAgentTodos((t) => {
          if (!t[who]) return t
          const copy = { ...t }
          delete copy[who]
          return copy
        })
        dingSound()
        window.oficina?.refreshUsage?.() // el % de uso quedó desactualizado tras el turno
        // chip transitorio anunciando la respuesta final (con duración si fue larga)
        const doneName = squadRef.current.find((m) => m.id === who)?.name || who
        const dur = startedAtRef.current[who] ? Date.now() - startedAtRef.current[who] : 0
        recordStat(who, usage, dur) // acumulado diario para 📈 Estadísticas
        setDoneChip(
          `✅ ${doneName} respondió${dur >= 5000 ? ` · ${fmtElapsed(dur)}` : ''}${usage ? ` · 🪙 ${fmtTokens(usageTotal(usage))}` : ''}`
        )
        clearTimeout(doneChipTimer.current)
        doneChipTimer.current = setTimeout(() => setDoneChip(null), 3500)
        if (isP) setStatus('Esperándote')
      } else if (e.kind === 'stopped') {
        delete editedRef.current[who]
        // tarea cancelada: quita la respuesta a medias y marca tu mensaje como cancelado
        setMessages((ms) => {
          const aIdx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && m.streaming)
          let out = aIdx < 0 ? ms : ms.filter((_, i) => i !== aIdx)
          const uIdx = out.findLastIndex((m) => m.role === 'user' && m.to === who && !m.cancelled)
          if (uIdx >= 0) out = out.map((m, i) => (i === uIdx ? { ...m, cancelled: true } : m))
          return out
        })
        handoffsRef.current = handoffsRef.current.filter((h) => !(h.from === who && h.result == null))
        setRS(who, 'idle')
        setTool((t) => (t?.role === who ? null : t))
        setAgentTool((t) => {
          if (!t[who]) return t
          const copy = { ...t }
          delete copy[who]
          return copy
        })
        setAgentTodos((t) => {
          if (!t[who]) return t
          const copy = { ...t }
          delete copy[who]
          return copy
        })
        buzzSound()
        const name = squadRef.current.find((m) => m.id === who)?.name || who
        setToast(`⏹ ${name}: tarea cancelada`)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 3500)
        if (isP) setStatus('Esperándote')
      } else if (e.kind === 'error') {
        delete editedRef.current[who]
        // ¿error transitorio (rate limit, red, timeout)? un reintento
        // automático con backoff — solo UNO por job; si repite, error normal
        const transient = /(\b429\b|\b529\b|rate.?limit|timeout|etimedout|econnreset|enotfound|eai_again|socket hang up|network|overloaded)/i.test(
          `${e.message || ''} ${e.detail || ''}`
        )
        const failedJob = lastJobRef.current[who]
        if (transient && failedJob && !retriedRef.current.has(failedJob.id)) {
          retriedRef.current.add(failedJob.id)
          setRS(who, 'idle')
          setTool((t) => (t?.role === who ? null : t))
          setAgentTool((t) => {
            const copy = { ...t }
            delete copy[who]
            return copy
          })
          setAgentTodos((t) => {
            const copy = { ...t }
            delete copy[who]
            return copy
          })
          const name = squadRef.current.find((m) => m.id === who)?.name || who
          setToast(`⚠️ ${name}: error transitorio — reintentando en 5s…`)
          clearTimeout(toastTimer.current)
          toastTimer.current = setTimeout(() => setToast(null), 5000)
          setTimeout(() => autoRetryRef.current(who), 5000)
          if (isP) setStatus('Reintentando…')
          return
        }
        // el stderr (si vino) se muestra como bloque de código en el mensaje
        const text = e.detail ? `⚠️ ${e.message}\n\n\`\`\`\n${e.detail}\n\`\`\`` : `⚠️ ${e.message}`
        setMessages((ms) => [...ms, { role: 'assistant', who, text, error: true }])
        setRS(who, 'idle')
        setTool((t) => (t?.role === who ? null : t))
        setAgentTool((t) => {
          if (!t[who]) return t
          const copy = { ...t }
          delete copy[who]
          return copy
        })
        setAgentTodos((t) => {
          if (!t[who]) return t
          const copy = { ...t }
          delete copy[who]
          return copy
        })
        buzzSound()
        if (isP) setStatus('Esperándote')
      }
    })
  }, [])

  // Auto-scroll del chat SOLO si ya estabas pegado al fondo: si subiste a
  // releer, el streaming no te arrastra de vuelta. Volver abajo re-engancha.
  const atBottomRef = useRef(true)
  const onLogScroll = () => {
    const el = logRef.current
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }
  useEffect(() => {
    if (atBottomRef.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages])

  // El standup termina cuando todos sus participantes vuelven a estar libres.
  useEffect(() => {
    if (standupIds.length && standupIds.every((id) => !roleStates[id])) {
      setStandupIds([])
      // cierre del standup: ofrecer compartir el resumen a Slack
      setMessages((ms) => [...ms, { role: 'system', text: '📋 Standup completo — reportes arriba', standupShare: true }])
      // si fue el programado, avisar aunque estés en otra app
      if (scheduledStandupRef.current) {
        scheduledStandupRef.current = false
        try {
          new Notification('La Oficina', { body: '📋 Standup del día listo — los reportes del squad te esperan en el chat' })
        } catch {}
      }
    }
  }, [roleStates, standupIds])

  // Watchdog: una entrega normal (caminar, entregar, volver) toma <20s. Si la
  // escena 3D se atasca por cualquier razón y onTourDone nunca llega, el rol
  // no puede quedarse en 'delivering' indefinidamente — a los 30s se libera.
  useEffect(() => {
    const delivering = running.filter((r) => roleStates[r] === 'delivering')
    if (!delivering.length) return
    const t = setTimeout(() => {
      delivering.forEach((r) => setRS(r, 'idle'))
      setDeliverTargets((d) => {
        const copy = { ...d }
        delivering.forEach((r) => delete copy[r])
        return copy
      })
    }, 30_000)
    return () => clearTimeout(t)
  }, [roleStates])

  // Despachador de handoffs: cuando el destinatario está libre, le llega el
  // trabajo del compañero (su sesión arranca con el resultado como contexto).
  useEffect(() => {
    const ready = handoffsRef.current.filter((h) => h.result != null)
    for (const h of ready) {
      if (roleStates[h.to]) continue // ocupado: la entrega espera su turno
      handoffsRef.current = handoffsRef.current.filter((x) => x !== h)
      const from = memberOf(h.from)
      const to = memberOf(h.to)
      setMessages((ms) => [...ms, { role: 'system', text: `🤝 ${from.name} le pasa el trabajo a ${to.name}` }])
      setRS(h.to, 'listening')
      popSound()
      window.oficina
        ?.ask({
          prompt: `${from.name} (${from.label}) del squad te entrega el resultado de su trabajo para que tú continúes con tu parte.\n\nInstrucción original del usuario: "${h.original}"\n\nResultado de ${from.name}:\n"""\n${h.result}\n"""\n\nContinúa a partir de esto según tu rol.`,
          profile,
          cwd: project,
          writeMode,
          model,
          role: h.to,
        })
        .then((res) => {
          if (!res?.ok) {
            setRS(h.to, 'idle')
            showToast(`⚠️ ${res?.error || 'No se pudo entregar'}`)
          }
        })
    }
  }, [roleStates, profile, project, writeMode, model, squad])

  // Procesador de cola: cuando un agente queda libre, toma su siguiente
  // mensaje en cola (como la consola: se procesa al terminar el turno actual).
  useEffect(() => {
    for (const role of Object.keys(queuesRef.current)) {
      const q = queuesRef.current[role]
      if (q?.length && !roleStates[role]) {
        dispatchJob(q.shift())
        syncQueues()
      }
    }
  }, [roleStates, profile, project, writeMode, model])

  // Atajos: ⌘K nueva · ⌘1-⌘6 miembro del squad · ⌘Y historial · ⌘F buscar · Esc cierra paneles
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // por capas: primero el submenu de Agentes; Configuración queda debajo
        if (tourOpen) {
          endTour()
          return
        }
        if (lightbox) {
          setLightbox(null)
          return
        }
        if (findOpen) {
          setFindOpen(false)
          return
        }
        if (diffView) {
          setDiffView(null)
          return
        }
        if (skillsOpen) {
          setSkillsOpen(false)
          return
        }
        if (mcpOpen) {
          setMcpOpen(false)
          return
        }
        if (statsOpen) {
          setStatsOpen(false)
          return
        }
        if (diagOpen) {
          setDiagOpen(false)
          return
        }
        if (agentsOpen) closeAgents()
        else closePanels()
        return
      }
      if (!e.metaKey) return
      if (e.key === 'k') {
        e.preventDefault()
        newChat()
      } else if (e.key === 'f') {
        // buscar dentro de la conversación abierta
        if (!messagesRef.current.length) return
        e.preventDefault()
        setFindOpen(true)
        requestAnimationFrame(() => findInputRef.current?.focus())
      } else if (e.key === 'y') {
        e.preventDefault()
        toggleHist()
      } else if (e.key === ',') {
        // ⌘, — estándar de macOS para preferencias
        e.preventDefault()
        openPrefs()
      } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= squad.length) {
        // un atajo por miembro activo (hasta MAX_ACTIVE)
        e.preventDefault()
        const m = squad[Number(e.key) - 1]
        if (!m) return
        setInput((v) => `${m.name}, ${v.replace(/^\S+,\s*/, '')}`)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // histOpen/prefsOpen: sus toggles los leen · agentsOpen/findOpen/diffView/skillsOpen/mcpOpen/lightbox: Esc por capas
  }, [squad, histOpen, agentsOpen, prefsOpen, findOpen, diffView, skillsOpen, mcpOpen, lightbox, statsOpen, diagOpen, tourOpen])

  // ── Imágenes adjuntas (pegar ⌘V o arrastrar) ─────────────────────────────
  const addImageFile = async (file) => {
    if (!file || !file.type?.startsWith('image/')) return
    const buf = new Uint8Array(await file.arrayBuffer())
    const res = await window.oficina?.saveImage?.(file.name || 'imagen.png', buf)
    if (res?.ok) {
      setAttachments((a) => [...a, { path: res.path, name: file.name || res.path.split('/').pop() }])
      popSound()
    }
  }
  const handlePaste = (e) => {
    for (const item of e.clipboardData?.items || []) {
      if (item.type?.startsWith('image/')) {
        e.preventDefault()
        addImageFile(item.getAsFile())
      }
    }
  }
  const handleDrop = async (e) => {
    e.preventDefault()
    for (const f of e.dataTransfer?.files || []) {
      if (f.type?.startsWith('image/')) {
        addImageFile(f)
        continue
      }
      // carpeta o archivo del disco → lo pasamos por ruta (el agente lo lee)
      const p = window.oficina?.pathForFile?.(f)
      if (!p) continue
      const info = await window.oficina?.pathInfo?.(p)
      if (!info?.ok) continue
      setRefs((r) => (r.some((x) => x.path === p) ? r : [...r, info]))
      popSound()
    }
  }

  // aviso transitorio: aparece y se desvanece solo (no ensucia el chat)
  const showToast = (text, ms = 3500) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }

  // Descarta todo lo pendiente de la conversación actual: mensajes en cola y
  // handoffs a medias no deben dispararse dentro de la conversación siguiente.
  const clearConversation = () => {
    setMessages([])
    setChatFilter(null)
    setConvTokens({ in: 0, out: 0, cache: 0 })
    setAgentTodos({})
    convIdRef.current = null
    sessionsRef.current = {}
    queuesRef.current = {}
    setQueuedCounts({})
    try {
      localStorage.removeItem('oficina-pending-queue')
    } catch {}
    handoffsRef.current = []
    window.oficina?.reset?.()
  }

  const newChat = () => {
    clearConversation()
    showToast('Conversación nueva ✨')
  }

  // ¿El proyecto tiene repo git? (red de seguridad del modo edición)
  const hasGit = async (dir) => {
    if (!dir) return true
    const info = await window.oficina?.pathInfo?.(`${dir.replace(/\/+$/, '')}/.git`)
    return !!info?.ok
  }
  // Cambia el permiso con feedback; en edición SIN git, advertencia ámbar.
  const setWritePermission = async (next) => {
    setWriteMode(next)
    if (!next) {
      showToast('🔒 Modo lectura — solo investigar')
      return
    }
    if (await hasGit(project)) {
      showToast('✏️ Modo edición — puede modificar y correr comandos')
    } else {
      showToast('⚠️ Modo edición SIN git en este proyecto — los cambios no tendrán red de seguridad', 6000)
    }
  }

  const changeProfile = (p) => {
    if (p === profile) return
    setProfile(p)
    setProject(cfg?.projectsByProfile?.[p]?.[0]?.path || '')
    setModel(localStorage.getItem(`oficina-model-${p}`) || cfg?.defaultModels?.[p] || FALLBACK_MODEL)
    setWriteMode(localStorage.getItem(`oficina-write-${p}`) !== '0')
    setTheme(localStorage.getItem(`oficina-theme-${p}`) || 'clasico') // tema por cuenta
    clearConversation()
    window.oficina?.refreshUsage?.() // refrescar el % de uso al cambiar de cuenta
    loadSquad(p) // cada cuenta tiene su squad
  }
  const selectProject = async (v) => {
    if (v === project) return
    setProject(v)
    clearConversation()
    // edición activa + proyecto sin git = sin red de seguridad
    if (writeMode && !(await hasGit(v))) {
      showToast('⚠️ Este proyecto no tiene git y el modo edición está activo — sin red de seguridad', 6000)
    }
  }
  // "➕ Agregar proyecto…": picker de carpeta; se persiste por perfil
  const addProjectFlow = async () => {
    const res = await window.oficina?.addProject?.(profile)
    if (res?.ok) {
      setCfg((await window.oficina?.getConfig?.()) || cfg)
      setProject(res.path)
      clearConversation()
      const git = !writeMode || (await hasGit(res.path))
      showToast(git ? `📌 Proyecto añadido: ${res.name}` : `📌 Proyecto añadido: ${res.name} · ⚠️ sin git (edición sin red de seguridad)`, git ? 3500 : 6000)
    }
  }

  // ── Submenu 👥 Agentes: se abre ENCIMA de Configuración (que queda debajo
  // y sigue abierta al cerrarlo) ────────────────────────────────────────────
  const openAgents = () => {
    setDraft(roster.map((r) => ({ ...r })))
    setAvatarPicker(null)
    setAgentsOpen(true)
  }
  const closeAgents = () => {
    setAgentsOpen(false)
    setAvatarPicker(null)
  }
  // ── Submenu 🧩 Skills: catálogo instalable por perfil (encima de Config) ──
  const [scanUrl, setScanUrl] = useState('')
  const [scanResult, setScanResult] = useState(null) // null | {loading} | {repo, skills} | {error}
  const [skillForm, setSkillForm] = useState(null) // {name, desc} | null
  const refreshSkills = async () => setInstalledSkills((await window.oficina?.skills?.list(profile)) || [])
  const openSkills = () => {
    setInstalledSkills(null)
    setScanUrl('')
    setScanResult(null)
    setSkillForm(null)
    setMktUrl('')
    setPluginQuery('')
    setSkillsOpen(true)
    refreshSkills()
    refreshPlugins()
  }
  const scanRepo = async () => {
    if (!scanUrl.trim()) return
    setScanResult({ loading: true })
    const res = await window.oficina?.skills?.scan(scanUrl)
    setScanResult(res?.ok ? { repo: res.repo, skills: res.skills } : { error: res?.error || 'No se pudo leer el repo' })
  }
  const createSkill = async () => {
    const res = await window.oficina?.skills?.create(profile, skillForm.name, skillForm.desc)
    if (res?.ok) {
      showToast(`🧩 Skill /${res.id} creada — se abrió en el editor`)
      setSkillForm(null)
      refreshSkills()
    } else showToast(`⚠️ ${res?.error || 'No se pudo crear'}`)
  }

  // ── Plugins del perfil (claude plugin CLI) ────────────────────────────────
  const [pluginData, setPluginData] = useState(null) // null | {loading} | {error} | {installed, available, marketplaces}
  const [pluginBusy, setPluginBusy] = useState(null)
  const [mktUrl, setMktUrl] = useState('')
  const [pluginQuery, setPluginQuery] = useState('')
  const refreshPlugins = async () => {
    setPluginData({ loading: true })
    const [lst, mkts] = await Promise.all([window.oficina?.plugins?.list(profile), window.oficina?.plugins?.marketplaces(profile)])
    if (!lst?.ok) setPluginData({ error: lst?.error?.slice(0, 200) || 'No se pudo consultar el CLI de plugins' })
    else setPluginData({ installed: lst.installed, available: lst.available, marketplaces: mkts?.ok ? mkts.marketplaces : [] })
  }
  const addMkt = async () => {
    if (!mktUrl.trim()) return
    setPluginBusy('mkt')
    const res = await window.oficina?.plugins?.addMarketplace(profile, mktUrl)
    setPluginBusy(null)
    if (res?.ok) {
      showToast('📦 Fuente añadida')
      setMktUrl('')
      refreshPlugins()
    } else showToast(`⚠️ ${res?.error?.slice(0, 160) || 'No se pudo añadir'}`, 6000)
  }
  const removeMkt = async (name) => {
    setPluginBusy(name)
    const res = await window.oficina?.plugins?.removeMarketplace(profile, name)
    setPluginBusy(null)
    showToast(res?.ok ? 'Fuente quitada' : `⚠️ ${res?.error?.slice(0, 160) || 'No se pudo quitar'}`)
    refreshPlugins()
  }
  const installPlugin = async (id) => {
    setPluginBusy(id)
    const res = await window.oficina?.plugins?.install(profile, id)
    setPluginBusy(null)
    if (res?.ok) showToast(`🔌 ${id.split('@')[0]} instalado — tus agentes ya lo tienen`)
    else showToast(`⚠️ ${res?.error?.slice(0, 160) || 'No se pudo instalar'}`, 6000)
    refreshPlugins()
  }
  const uninstallPlugin = async (id) => {
    setPluginBusy(id)
    const res = await window.oficina?.plugins?.uninstall(profile, id)
    setPluginBusy(null)
    showToast(res?.ok ? 'Plugin desinstalado' : `⚠️ ${res?.error?.slice(0, 160) || 'No se pudo desinstalar'}`)
    refreshPlugins()
  }
  const installSkill = async (s) => {
    setSkillBusy(s.id)
    const res = await window.oficina?.skills?.install(profile, s.id, s.repo)
    setSkillBusy(null)
    if (res?.ok) showToast(`🧩 ${s.name} instalada — tus agentes ya pueden usarla`)
    else showToast(`⚠️ ${res?.error || 'No se pudo instalar'}`, 6000)
    refreshSkills()
  }
  // «🔄 Actualizar todo»: re-instala (git pull + copia) las del catálogo
  const [skillsUpdating, setSkillsUpdating] = useState(false)
  const updateAllSkills = async () => {
    const known = (installedSkills || []).map((x) => SKILL_CATALOG.find((s) => s.id === x.id)).filter(Boolean)
    const propias = (installedSkills || []).length - known.length
    if (!known.length) {
      showToast(propias ? `Solo tienes skills propias (${propias}) — esas se actualizan a mano` : 'No hay skills del catálogo instaladas')
      return
    }
    setSkillsUpdating(true)
    let ok = 0
    for (const [i, s] of known.entries()) {
      showToast(`🔄 Actualizando ${s.name} (${i + 1}/${known.length})…`, 20000)
      const res = await window.oficina?.skills?.install(profile, s.id, s.repo)
      if (res?.ok) ok++
    }
    setSkillsUpdating(false)
    showToast(`✅ ${ok} actualizada${ok !== 1 ? 's' : ''}${propias ? ` · ${propias} propia${propias !== 1 ? 's' : ''} sin tocar` : ''}`, 6000)
    refreshSkills()
  }

  const removeSkill = async (id) => {
    setSkillBusy(id)
    const res = await window.oficina?.skills?.remove(profile, id)
    setSkillBusy(null)
    showToast(res?.ok ? 'Skill quitada' : `⚠️ ${res?.error || 'No se pudo quitar'}`)
    refreshSkills()
  }

  // ── Submenu 🌐 MCP: servidores por perfil (encima de Configuración) ──────
  const [mcpList, setMcpList] = useState(null) // null = leyendo
  const [mcpAccount, setMcpAccount] = useState(null) // conectores de la cuenta/terminal
  const [mcpBusy, setMcpBusy] = useState(null)
  const [mcpForm, setMcpForm] = useState(null) // {name, target} | null
  const refreshMcp = async () => {
    const res = await window.oficina?.mcp?.list(profile)
    setMcpList(res?.servers || [])
  }
  const openMcp = () => {
    setMcpList(null)
    setMcpForm(null)
    setMcpOpen(true)
    refreshMcp()
    // los conectores de la cuenta tardan (health-check del CLI): llegan aparte
    setMcpAccount({ loading: true })
    window.oficina?.mcp?.account(profile).then((res) => setMcpAccount(res?.ok ? { servers: res.servers } : { error: res?.error }))
  }
  const addMcp = async (entry) => {
    setMcpBusy(entry.id || entry.name)
    const res = await window.oficina?.mcp?.add(
      profile,
      entry.id || entry.name,
      entry.url ? { url: entry.url } : { cmd: entry.cmd, env: entry.env || [] }
    )
    setMcpBusy(null)
    if (res?.ok) showToast(`🌐 ${entry.name} conectado — tus agentes ya lo pueden usar`)
    else showToast(`⚠️ ${res?.error?.slice(0, 160) || 'No se pudo agregar'}`, 6000)
    refreshMcp()
  }
  const removeMcp = async (name) => {
    setMcpBusy(name)
    const res = await window.oficina?.mcp?.remove(profile, name)
    setMcpBusy(null)
    showToast(res?.ok ? 'Servidor quitado' : `⚠️ ${res?.error?.slice(0, 160) || 'No se pudo quitar'}`)
    refreshMcp()
  }
  const addMcpCustom = async () => {
    const name = mcpForm.name.trim().toLowerCase().replace(/\s+/g, '-')
    const target = mcpForm.target.trim()
    if (!name || !target) return
    const env = (mcpForm.envs || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const bad = env.find((l) => !/^[A-Za-z_][A-Za-z0-9_]*=.+$/.test(l))
    if (bad) {
      showToast(`⚠️ Variable inválida: «${bad}» — formato CLAVE=valor`)
      return
    }
    const entry = /^https?:\/\//.test(target) ? { name, id: name, url: target } : { name, id: name, cmd: target.split(/\s+/), env }
    setMcpForm(null)
    await addMcp(entry)
  }

  // ── Exportar/importar configuración ──────────────────────────────────────
  const exportConfig = async () => {
    // extras = lo que vive en localStorage (plantillas, modelos, tema…);
    // el estado transitorio (cola) y lo por-máquina (cámara) no viajan
    const extras = {}
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('oficina-') && k !== 'oficina-pending-queue' && k !== 'oficina-camera') extras[k] = localStorage.getItem(k)
    }
    const res = await window.oficina?.config?.export(extras)
    if (res?.ok) showToast(`💾 Configuración exportada a ${res.path.split('/').pop()}`)
    else if (!res?.canceled) showToast(`⚠️ ${res?.error || 'No se pudo exportar'}`)
  }
  const importConfig = async () => {
    // si hay respaldos automáticos, ofrecerlos antes del selector de archivo
    const bks = (await window.oficina?.config?.backups?.()) || []
    if (bks.length) {
      const ultimo = new Date(bks[0].at).toLocaleDateString('es', { day: '2-digit', month: 'short' })
      const usarBackup = window.confirm(
        `Hay ${bks.length} respaldo${bks.length > 1 ? 's' : ''} automático${bks.length > 1 ? 's' : ''} (el más reciente del ${ultimo}).\n\n` +
          'Aceptar: elegir un archivo (los respaldos están en la carpeta «backups» de la app)\nCancelar: no hacer nada'
      )
      if (!usarBackup) return
    }
    const res = await window.oficina?.config?.import()
    if (!res?.ok) {
      if (!res?.canceled) showToast(`⚠️ ${res?.error || 'No se pudo importar'}`, 6000)
      return
    }
    // extras de localStorage: tema, modelo, permiso, sonido, pizarra, plantillas…
    for (const [k, v] of Object.entries(res.extras || {})) {
      if (k.startsWith('oficina-')) {
        try {
          localStorage.setItem(k, v)
        } catch {}
      }
    }
    // reinstalar las skills del catálogo en cada perfil (clon en caché: rápido)
    const missing = []
    for (const [prof, ids] of Object.entries(res.skills || {})) {
      for (const id of ids) {
        const cat = SKILL_CATALOG.find((s) => s.id === id)
        if (!cat) {
          missing.push(id)
          continue
        }
        showToast(`🧩 Instalando ${cat.name} (${prof})…`, 10000)
        await window.oficina?.skills?.install(prof, cat.id, cat.repo)
      }
    }
    const notes = []
    if (missing.length) notes.push(`Skills fuera del catálogo que no se migraron solas: ${[...new Set(missing)].join(', ')}`)
    if (res.mcpSkipped?.length)
      notes.push(`Servidores MCP con credenciales que debes reconectar a mano: ${res.mcpSkipped.join(', ')}`)
    if (notes.length) {
      try {
        localStorage.setItem('oficina-import-note', notes.join(' · '))
      } catch {}
    }
    // recarga completa: tema, modelo, squad de ambos perfiles, plantillas y
    // preferencias se releen desde cero — importar de verdad importa TODO
    showToast('📥 Configuración importada — recargando la oficina…')
    setTimeout(() => window.location.reload(), 900)
  }

  // ── Panel ⚙️ Configuración (preferencias + acceso a Agentes) ─────────────
  const openPrefs = () => {
    const wasOpen = prefsOpen
    closePanels()
    if (!wasOpen) setPrefsOpen(true)
  }
  const draftEnabled = draft.filter((r) => r.enabled).length
  const toggleMember = (id) => {
    const target = draft.find((r) => r.id === id)
    if (!target) return
    if (target.enabled && draftEnabled <= 1) {
      showToast('⚠️ Debe quedar al menos un agente activo')
      return
    }
    if (!target.enabled && draftEnabled >= MAX_ACTIVE) {
      showToast(`👥 Squad completo (${MAX_ACTIVE}/${MAX_ACTIVE}) — desactiva uno para poder activar otro`)
      return
    }
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)))
  }
  const renameMember = (id, name) => setDraft((d) => d.map((r) => (r.id === id ? { ...r, name } : r)))
  // Drag & drop (grip ⠿): arrastrar una fila y soltarla sobre otra la mueve
  // ahí — antes si viene de abajo, después si viene de arriba.
  const [dragId, setDragId] = useState(null)
  const [dropId, setDropId] = useState(null)
  const dropRole = (targetId) => {
    if (dragId && dragId !== targetId) {
      setDraft((d) => {
        const i = d.findIndex((r) => r.id === dragId)
        const j = d.findIndex((r) => r.id === targetId)
        if (i < 0 || j < 0) return d
        const copy = [...d]
        const [item] = copy.splice(i, 1)
        const j2 = copy.findIndex((r) => r.id === targetId)
        copy.splice(i < j ? j2 + 1 : j2, 0, item)
        return copy
      })
    }
    setDragId(null)
    setDropId(null)
  }
  // Elegir un personaje aplica AL INSTANTE: cierra la galería, actualiza la
  // escena y persiste solo ese cambio (sin arrastrar activaciones pendientes
  // del draft — "Guardar squad" sigue siendo para eso).
  const pickAvatar = async (id, avatar) => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, avatar: avatar || null } : r)))
    setAvatarPicker(null)
    const inRoster = roster.some((r) => r.id === id)
    if (!inRoster) return // rol custom aún no guardado: queda en el draft
    const updated = roster.map((r) => (r.id === id ? { ...r, avatar: avatar || null } : r))
    setRoster(updated) // la escena cambia ya
    await window.oficina?.squad?.save(profile, updated)
    showToast('🧍 Personaje actualizado')
  }
  // Modelo propio de un agente: aplica y persiste al instante (como el avatar).
  const setMemberModel = async (id, mdl) => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, model: mdl || null } : r)))
    if (!roster.some((r) => r.id === id)) return // rol aún no guardado: queda en el draft
    const updated = roster.map((r) => (r.id === id ? { ...r, model: mdl || null } : r))
    setRoster(updated)
    await window.oficina?.squad?.save(profile, updated)
    const name = updated.find((r) => r.id === id)?.name || id
    showToast(mdl ? `🧠 ${name} usará ${modelLabelOf(mdl)}` : `🧠 ${name} vuelve al modelo global`)
  }
  // avatar efectivo de un miembro (elegido o el default de su rol)
  const effectiveAvatar = (r) => r.avatar || metaOf(r).url.split('/').pop()
  // modelos ya ocupados por OTROS miembros activos (no se pueden repetir)
  const takenAvatars = (selfId) =>
    new Set(draft.filter((r) => r.enabled && r.id !== selfId).map((r) => effectiveAvatar(r)))
  // Abre el formulario en modo edición con los valores del rol custom.
  const startEditRole = (r) => {
    setNr({
      name: r.name,
      focus: r.focus || '',
      emoji: r.emoji || '🛠️',
      color: r.color || '#38bdf8',
      kw: r.kw || '',
      avatar: r.avatar || '',
      model: r.model || '',
    })
    setEditingId(r.id)
    setAddingRole(true)
  }

  // Crea un rol personalizado (o guarda la edición de uno existente).
  const addRole = () => {
    const name = nr.name.trim()
    if (!name) {
      showToast('⚠️ Ponle un nombre al rol')
      return
    }
    if (editingId) {
      setDraft((d) =>
        d.map((r) =>
          r.id === editingId
            ? {
                ...r,
                name,
                focus: nr.focus.trim(),
                emoji: (nr.emoji || '🛠️').slice(0, 2),
                color: nr.color || '#38bdf8',
                kw: nr.kw.trim(),
                avatar: nr.avatar || r.avatar,
                model: nr.model || null,
              }
            : r
        )
      )
      setEditingId(null)
      setNr(NEW_ROLE)
      setAddingRole(false)
      showToast(`Rol "${name}" actualizado — guardá para aplicar`)
      return
    }
    const avatar = nr.avatar || AVATARS.find((a) => !draft.some((r) => effectiveAvatar(r) === a)) || AVATARS[0]
    const role = {
      id: `custom-${Date.now()}`,
      name,
      enabled: false,
      custom: true,
      avatar,
      focus: nr.focus.trim(),
      emoji: (nr.emoji || '🛠️').slice(0, 2),
      color: nr.color || '#38bdf8',
      hair: '#1f2937',
      kw: nr.kw.trim(),
      model: nr.model || null,
    }
    setDraft((d) => [...d, role])
    setNr(NEW_ROLE)
    setAddingRole(false)
    showToast(`Rol "${name}" creado — actívalo y guardá`)
  }
  const deleteRole = (id) => setDraft((d) => d.filter((r) => !(r.id === id && canDelete(r))))

  // Presets (#107): activan un conjunto de roles respetando nombres y avatares
  const applyPreset = (preset) => {
    setDraft((d) => {
      const activos = new Set(preset.roles)
      const conEstado = d.map((r) => ({ ...r, enabled: activos.has(r.id) }))
      // el orden importa: el 1º activo es el principal → los del preset primero
      return conEstado.sort((a, b) => preset.roles.indexOf(a.id) - preset.roles.indexOf(b.id))
    })
    showToast(`${preset.label} — revisa y guarda para aplicar`)
  }

  // Built-ins borrables que faltan en el draft = fueron eliminados (tombstones).
  // Restaurarlos aquí y guardar hace que saveSquad ya no escriba sus tombstones.
  const DELETABLE_BUILTINS = ['design', 'qa', 'docs']
  const missingBuiltins = DELETABLE_BUILTINS.filter((id) => !draft.some((r) => r.id === id))
  const restoreDefaults = () => {
    setDraft((d) => [
      ...d,
      ...missingBuiltins.map((id) => ({ id, name: ROLE_META[id].label, enabled: false, avatar: null, custom: false })),
    ])
    showToast('Roles predeterminados restaurados — guardá para aplicar')
  }

  const saveSquad = async () => {
    const clean = draft.map((r) => ({ ...r, name: r.name.trim() || metaOf(r).label }))
    // sin personajes duplicados entre los activos
    const active = clean.filter((r) => r.enabled)
    if (new Set(active.map(effectiveAvatar)).size !== active.length) {
      showToast('⚠️ Dos miembros tienen el mismo personaje — elige otro')
      return
    }
    // sin nombres duplicados entre los activos: el ruteo por nombre ("Ana, haz X")
    // sería ambiguo — siempre ganaría el primero
    const names = active.map((r) => norm(r.name))
    if (new Set(names).size !== names.length) {
      showToast('⚠️ Dos agentes activos tienen el mismo nombre — renombra uno')
      return
    }
    await window.oficina?.squad?.save(profile, clean)
    setRoster(clean)
    setAgentsOpen(false)
    showToast(
      `Squad actualizado: ${clean
        .filter((r) => r.enabled)
        .slice(0, MAX_ACTIVE)
        .map((r) => `${metaOf(r).emoji} ${r.name}`)
        .join(' · ')}`
    )
  }

  // ── Historial ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (busy || !messages.length || !convIdRef.current) return
    const title = messages.find((m) => m.role === 'user')?.text.slice(0, 60) || 'conversación'
    window.oficina?.history?.save({
      id: convIdRef.current,
      title,
      profile,
      project,
      model,
      sessions: { ...sessionsRef.current },
      updatedAt: Date.now(),
      messages: messages.map(({ role, text, who, to, artifact, atts, usage }) => ({ role, text, who, to, artifact, atts, usage })),
    })
  }, [busy, messages, profile, project, model])

  const toggleHist = async () => {
    if (!histOpen) {
      setHistList((await window.oficina?.history?.list()) || [])
      setHistQuery('') // el filtro arranca limpio en cada apertura
    }
    const next = !histOpen
    closePanels()
    setHistOpen(next)
  }
  // búsqueda por CONTENIDO (texto de los mensajes) — {id: extracto}, debounced
  const [histContent, setHistContent] = useState({})
  useEffect(() => {
    if (!histOpen) return
    const q = histQuery.trim()
    if (q.length < 3) {
      setHistContent({})
      return
    }
    const t = setTimeout(async () => setHistContent((await window.oficina?.history?.search(q)) || {}), 300)
    return () => clearTimeout(t)
  }, [histQuery, histOpen])

  // filtro por título/proyecto o por contenido; 📌 arriba
  const histFiltered = (histQuery.trim()
    ? histList.filter((h) => norm(`${h.title || ''} ${h.project || ''}`).includes(norm(histQuery)) || histContent[h.id])
    : histList
  ).slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))

  // renombrar inline
  const [renaming, setRenaming] = useState(null) // {id, val} | null
  const commitRename = async () => {
    if (!renaming) return
    const { id, val } = renaming
    setRenaming(null)
    if (!val.trim()) return
    await window.oficina?.history?.rename(id, val)
    setHistList((await window.oficina?.history?.list()) || [])
  }

  const togglePin = async (e, h) => {
    e.stopPropagation()
    await window.oficina?.history?.pin(h.id, !h.pinned)
    setHistList((await window.oficina?.history?.list()) || [])
    showToast(h.pinned ? 'Conversación desfijada' : '📌 Fijada — no se purga del historial')
  }

  const loadConvo = async (id) => {
    if (busy) return
    const c = await window.oficina?.history?.get(id)
    if (!c) return
    convIdRef.current = c.id
    if (c.profile && cfg?.profiles?.includes(c.profile)) {
      setProfile(c.profile)
      loadSquad(c.profile)
    }
    if (c.project) setProject(c.project)
    if (c.model) setModel(c.model)
    const saved = c.sessions || (c.sessionId ? { dev: c.sessionId } : {})
    sessionsRef.current = { ...saved }
    setMessages(c.messages || [])
    await window.oficina?.setSession?.({ sessions: saved, profile: c.profile, cwd: c.project })
    setHistOpen(false)
    showToast(Object.keys(saved).length ? 'Retomada — recordamos todo 🧠' : 'Conversación cargada')
  }

  const deleteConvo = async (e, id) => {
    e.stopPropagation()
    await window.oficina?.history?.remove(id)
    if (id === convIdRef.current) newChat()
    setHistList((await window.oficina?.history?.list()) || [])
  }

  const exportConvo = async (e, id) => {
    e.stopPropagation()
    const res = await window.oficina?.history?.export(id)
    if (res?.ok) showToast(`⬇ Exportada a ${res.path.split('/').pop()}`)
    else if (!res?.canceled) showToast('⚠️ No se pudo exportar la conversación')
  }

  // ── Plantillas de prompts: snippets por perfil, accesibles con / ─────────
  const [snippets, setSnippets] = useState([])
  const [snipForm, setSnipForm] = useState(null) // formulario de nueva plantilla
  useEffect(() => {
    const raw = localStorage.getItem(`oficina-snippets-${profile}`)
    if (raw === null) {
      // perfil sin plantillas guardadas nunca: sembrar los ejemplos (borrables);
      // si el usuario las borra todas queda '[]' y no se re-siembran
      const seed = SEED_SNIPPETS.map((s) => ({ ...s, id: crypto.randomUUID() }))
      try {
        localStorage.setItem(`oficina-snippets-${profile}`, JSON.stringify(seed))
      } catch {}
      setSnippets(seed)
    } else {
      try {
        setSnippets(JSON.parse(raw) || [])
      } catch {
        setSnippets([])
      }
    }
    setSnipForm(null)
  }, [profile])
  const saveSnippets = (list) => {
    setSnippets(list)
    localStorage.setItem(`oficina-snippets-${profile}`, JSON.stringify(list))
  }
  // ── Autocompletar @nombres: escribir @ lista los agentes (y @todos) ──────
  const AT_RE = /(^|\s)@([\p{L}\p{N}_-]*)$/u
  const atMatch = AT_RE.exec(input)
  const atQuery = atMatch ? atMatch[2] : null
  const atOptions =
    atQuery !== null
      ? [
          { name: 'todos', emoji: '📢', label: 'el mismo mensaje a todos los agentes libres' },
          ...squad.map((m) => ({ name: m.name, emoji: m.emoji, label: m.label })),
        ].filter((o) => norm(o.name).startsWith(norm(atQuery)))
      : []
  const pickAt = (o) => {
    setInput(input.replace(AT_RE, (_, pre) => `${pre}@${o.name} `))
    inputRef.current?.focus()
  }

  const BUILTIN_CMDS = ['/model', '/clear', '/nueva', '/squad', '/standup']
  const snipQuery = input.startsWith('/') && !input.includes('\n') ? input.slice(1) : null
  const snipOpen = snipQuery !== null && !BUILTIN_CMDS.some((c) => input.startsWith(c))
  const snipMatches = snipOpen ? snippets.filter((s) => norm(s.name).includes(norm(snipQuery))) : []
  const [snipVars, setSnipVars] = useState(null) // {text, vars, vals} — plantilla con {{variables}}
  const pickSnippet = (s) => {
    // ¿la plantilla trae {{variables}}? pedir los valores antes de insertar
    const vars = [...new Set([...s.text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]))]
    if (vars.length) {
      setSnipVars({ text: s.text, vars, vals: {} })
      return
    }
    setInput(s.text)
    const el = inputRef.current
    if (el) {
      el.focus()
      requestAnimationFrame(() => autoGrow(el))
    }
  }
  const insertSnipVars = () => {
    let out = snipVars.text
    for (const v of snipVars.vars) out = out.split(`{{${v}}}`).join(snipVars.vals[v] || '').replace(new RegExp(`\\{\\{\\s*${escRe(v)}\\s*\\}\\}`, 'g'), snipVars.vals[v] || '')
    setSnipVars(null)
    setInput(out)
    const el = inputRef.current
    if (el) {
      el.focus()
      requestAnimationFrame(() => autoGrow(el))
    }
  }

  // ── Buscar en la conversación (⌘F) ───────────────────────────────────────
  // busca sobre lo visible (respeta el filtro por agente); índices de messages
  const visibleMessages = chatFilter ? messages.filter((m) => m.who === chatFilter || m.to === chatFilter) : messages
  const findHits =
    findOpen && findQuery.trim()
      ? visibleMessages.filter((m) => m.text && norm(m.text).includes(norm(findQuery))).map((m) => messages.indexOf(m))
      : []
  const gotoHit = (n) => {
    if (!findHits.length) return
    const idx = ((n % findHits.length) + findHits.length) % findHits.length
    setFindIdx(idx)
    logRef.current?.querySelector(`[data-mi="${findHits[idx]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  useEffect(() => {
    if (findOpen && findQuery.trim()) gotoHit(0)
  }, [findQuery]) // al escribir, salta a la primera coincidencia

  // ── Vista de diff: cambios pendientes del proyecto (git diff HEAD) ───────
  const openDiff = async () => {
    setDiffView({ loading: true })
    const res = await window.oficina?.gitDiff?.(project)
    if (!res?.ok) setDiffView({ error: res?.error || 'No se pudo leer el diff' })
    else setDiffView({ diff: res.diff, untracked: res.untracked || [] })
  }
  const diffLineClass = (l) =>
    l.startsWith('+++') || l.startsWith('---')
      ? 'dl meta'
      : l.startsWith('+')
        ? 'dl add'
        : l.startsWith('-')
          ? 'dl del'
          : l.startsWith('@@')
            ? 'dl hunk'
            : l.startsWith('diff --git')
              ? 'dl file'
              : 'dl'

  // ── Compartir el resumen del standup a Slack (vía conector MCP de la cuenta)
  const [slackChannel, setSlackChannel] = useState(() => localStorage.getItem('oficina-slack-channel') || '')
  const saveSlackChannel = (v) => {
    setSlackChannel(v)
    localStorage.setItem('oficina-slack-channel', v.trim())
  }
  const shareStandup = (idx) => {
    const chan = (localStorage.getItem('oficina-slack-channel') || '').trim().replace(/^#/, '')
    if (!chan) {
      showToast('⚠️ Configura el canal de Slack en ⚙️ Preferencias primero')
      openPrefs()
      return
    }
    // los reportes: mensajes del squad entre el arranque del standup y su cierre
    const start = messages.slice(0, idx).findLastIndex((m) => m.role === 'system' && /Standup diario/.test(m.text || ''))
    const reports = messages.slice(Math.max(start, 0), idx).filter((m) => m.role === 'assistant' && !m.error)
    if (!reports.length) {
      showToast('No encontré reportes de este standup')
      return
    }
    const body = reports.map((m) => `### ${memberOf(m.who).name} (${memberOf(m.who).label})\n${(m.text || '').slice(0, 700)}`).join('\n\n')
    const target = squad.find((m) => m.id === 'pr')?.id || principal
    routeJob({
      id: crypto.randomUUID(),
      target,
      text: 'Compartir standup a Slack',
      display: `📤 Comparte el resumen del standup en #${chan}`,
      prompt:
        `Toma estos reportes del standup de hoy y compón un resumen breve y claro (una viñeta por persona, sin inventar nada). ` +
        `Luego publícalo en el canal #${chan} de Slack usando el conector MCP de Slack disponible. ` +
        `IMPORTANTE: antes de publicar, muéstrame el resumen y pregúntame si lo publico — NO publiques sin mi confirmación explícita en el siguiente mensaje.\n\n${body}`,
      atts: [],
    })
  }

  // ── Standup programado: /standup solo a la hora configurada (días hábiles)
  const [standupAt, setStandupAt] = useState(() => localStorage.getItem('oficina-standup') || '')
  const saveStandupAt = (v) => {
    setStandupAt(v)
    localStorage.setItem('oficina-standup', v)
    showToast(v ? `📋 Standup programado a las ${v} (días hábiles)` : 'Standup programado apagado')
  }
  const standupCmdRef = useRef(() => {})
  useEffect(() => {
    standupCmdRef.current = () => handleLocalCommand('/standup')
  })

  // Auto-retry (#90): re-despacha el último job de un rol con estado fresco.
  useEffect(() => {
    autoRetryRef.current = (who) => {
      const job = lastJobRef.current[who]
      if (job) routeJob({ ...job }) // mismo id: el mensaje no se duplica
    }
  })

  // ── Deep links: el handler vive en un ref para tener closures frescas ────
  useEffect(() => {
    deepLinkRef.current = (d) => {
      if (d.action === 'standup') {
        handleLocalCommand('/standup')
        return
      }
      if (d.action === 'ask') {
        const text = (d.text || '').trim()
        if (!text) {
          inputRef.current?.focus()
          return
        }
        if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
        const target = d.role
          ? squad.find((m) => m.id === d.role || norm(m.name) === norm(d.role))?.id || principal
          : routeMessage(text, squad, principal)
        routeJob({ id: crypto.randomUUID(), target, text, display: `🔗 ${text}`, prompt: text, atts: [] })
        showToast(`🔗 Deep link → ${memberOf(target).name}`)
      }
    }
  })
  const scheduledStandupRef = useRef(false) // ¿el standup en curso fue automático?
  useEffect(() => {
    const check = (offerCatchUp) => {
      const at = localStorage.getItem('oficina-standup')
      if (!at) return
      const now = new Date()
      if (now.getDay() === 0 || now.getDay() === 6) return // solo hábiles
      const today = now.toISOString().slice(0, 10)
      if (localStorage.getItem('oficina-standup-last') === today) return
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      if (hhmm >= at && hhmm <= at.replace(/:\d\d$/, (m) => `:${String(Math.min(Number(m.slice(1)) + 1, 59)).padStart(2, '0')}`)) {
        localStorage.setItem('oficina-standup-last', today)
        scheduledStandupRef.current = true
        standupCmdRef.current()
      } else if (offerCatchUp && hhmm > at) {
        // la app no estaba abierta a esa hora: ofrecer ponerse al día
        localStorage.setItem('oficina-standup-last', today)
        if (window.confirm(`El standup programado de las ${at} no corrió (la app estaba cerrada). ¿Lo corro ahora?`)) {
          scheduledStandupRef.current = true
          standupCmdRef.current()
        }
      }
    }
    const t = setTimeout(() => check(true), 4000)
    const iv = setInterval(() => check(false), 30000)
    return () => {
      clearTimeout(t)
      clearInterval(iv)
    }
  }, [])

  // ── Comandos locales ─────────────────────────────────────────────────────
  const handleLocalCommand = (text) => {
    const [cmd, ...rest] = text.split(/\s+/)
    if (cmd === '/model') {
      const arg = rest[0]?.toLowerCase()
      if (!arg) {
        showToast(`Modelo actual: ${modelLabelOf(model)} · usa /model opus | fable | sonnet | haiku`)
        return true
      }
      const resolved = MODEL_ALIASES[arg] ?? arg
      setModel(resolved)
      showToast(`Modelo → ${modelLabelOf(resolved)}`)
      return true
    }
    if (cmd === '/clear' || cmd === '/nueva') {
      newChat()
      return true
    }
    if (cmd === '/squad') {
      showToast(squad.map((m) => `${m.emoji} ${m.name} — ${m.label}`).join('  ·  '))
      return true
    }
    if (cmd === '/standup') {
      const free = squad.filter((m) => !roleStates[m.id])
      if (!free.length) {
        showToast('Todo el squad está ocupado — intenta en un momento')
        return true
      }
      if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
      setMessages((ms) => [...ms, { role: 'system', text: `📋 Standup diario — reporta el squad (${free.map((m) => m.name).join(', ')})` }])
      setStandupIds(free.map((m) => m.id)) // en la escena: todos a la reunión
      checkQuota()
      popSound()
      // cada uno retoma su última sesión en este proyecto y reporta (en paralelo)
      free.forEach((m, i) => {
        setTimeout(() => {
          setRS(m.id, 'listening')
          window.oficina
            ?.ask({ prompt: STANDUP_PROMPT, profile, cwd: project, writeMode: false, model: memberModel(m.id), role: m.id, standup: true })
            .then((res) => {
              if (!res?.ok) setRS(m.id, 'idle')
            })
        }, i * 600)
      })
      return true
    }
    return false
  }

  // Lanza un job a su agente (o lo ENCOLA si está ocupado — como la consola).
  const enqueueJob = (job) => {
    setMessages((ms) => [...ms, { role: 'user', text: job.display, to: job.target, atts: job.atts, jobId: job.id, queued: true }])
    ;(queuesRef.current[job.target] ||= []).push(job)
    syncQueues()
    showToast(`⏳ En cola para ${memberOf(job.target).name}`)
  }
  const dispatchJob = async (job) => {
    lastJobRef.current[job.target] = job // para el botón Reintentar tras un error
    if (job.handoffTo) handoffsRef.current.push({ from: job.target, to: job.handoffTo, original: job.text, result: null })
    setMessages((ms) => {
      const has = ms.some((m) => m.jobId === job.id)
      const cleared = ms.map((m) => (m.jobId === job.id ? { ...m, queued: false } : m))
      return has ? cleared : [...cleared, { role: 'user', text: job.display, to: job.target, atts: job.atts, jobId: job.id }]
    })
    setRS(job.target, 'listening')
    popSound()
    if (job.target === principal) setStatus('Pensando…')
    const res = await window.oficina.ask({
      prompt: job.prompt,
      profile,
      cwd: project,
      writeMode,
      model: memberModel(job.target),
      role: job.target,
      standup: job.standup,
    })
    if (!res?.ok) {
      setMessages((ms) => [...ms, { role: 'assistant', who: job.target, text: `⚠️ ${res?.error || 'Error desconocido'}` }])
      setRS(job.target, 'idle')
      if (job.target === principal) setStatus('Esperándote')
    }
  }
  // ── Cola persistente: al arrancar, ofrecer retomar lo que quedó sin enviar ─
  const [pendingRestore, setPendingRestore] = useState(null)
  useEffect(() => {
    if (!cfg) return
    let saved = null
    try {
      saved = JSON.parse(localStorage.getItem('oficina-pending-queue'))
    } catch {}
    if (!saved?.jobs?.length) return
    localStorage.removeItem('oficina-pending-queue')
    const n = saved.jobs.length
    if (!window.confirm(`Tenías ${n} mensaje${n > 1 ? 's' : ''} en cola cuando se cerró la app. ¿Los envío ahora?`)) return
    if (saved.profile && cfg.profiles?.includes(saved.profile)) setProfile(saved.profile)
    if (saved.project) setProject(saved.project)
    if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
    setPendingRestore(saved.jobs)
  }, [cfg])
  // se despachan en un render posterior, ya con el perfil/proyecto restaurados
  useEffect(() => {
    if (!pendingRestore?.length) return
    const jobs = pendingRestore
    setPendingRestore(null)
    jobs.forEach((j, i) => setTimeout(() => routeJob({ ...j, id: crypto.randomUUID() }), 300 + i * 500))
    showToast(`⏳ Retomando ${jobs.length} mensaje${jobs.length > 1 ? 's' : ''} de la cola`)
  }, [pendingRestore])

  // ── Estadísticas: acumulado diario por agente (tareas, tokens, tiempo) ───
  const recordStat = (who, usage, ms) => {
    try {
      const all = JSON.parse(localStorage.getItem('oficina-stats')) || {}
      const day = new Date().toISOString().slice(0, 10)
      const d = (all[day] ||= { tasks: 0, tokens: 0, ms: 0, agents: {} })
      const a = (d.agents[who] ||= { tasks: 0, tokens: 0, ms: 0 })
      const tok = usage ? usageTotal(usage) : 0
      d.tasks += 1
      d.tokens += tok
      d.ms += ms
      a.tasks += 1
      a.tokens += tok
      a.ms += ms
      const days = Object.keys(all).sort()
      while (days.length > 60) delete all[days.shift()] // 60 días de historia
      localStorage.setItem('oficina-stats', JSON.stringify(all))
    } catch {}
  }
  const openDiag = () => {
    setDiagRows([...diagRef.current].reverse()) // lo más reciente arriba
    setDiagOpen(true)
  }
  const diagText = () =>
    [...diagRef.current]
      .map((r) => `${new Date(r.t).toLocaleTimeString('es')} · ${r.role} · ${r.kind}${r.info ? ` · ${r.info}` : ''}`)
      .join('\n')

  const openStats = () => {
    try {
      setStatsData(JSON.parse(localStorage.getItem('oficina-stats')) || {})
    } catch {
      setStatsData({})
    }
    setStatsOpen(true)
  }

  // Aviso de cuota alta: si la sesión de 5h va >90%, un toast al despachar
  // (máx. uno cada 10 min para no ser cansón).
  const quotaWarnAtRef = useRef(0)
  const checkQuota = () => {
    if (Date.now() - quotaWarnAtRef.current < 10 * 60 * 1000) return
    window.oficina?.stats?.(profile).then((s) => {
      const pct = s?.claude?.session?.pct
      if (pct >= 90) {
        quotaWarnAtRef.current = Date.now()
        showToast(`⚠️ Vas ${Math.round(pct)}% de la cuota de 5h — resetea en ${fmtReset(s.claude.session.resetsAt)}`, 6000)
      }
    })
  }

  // Aviso de colisión (#99): dos agentes editando el MISMO repo pueden
  // pisarse (git add -A cruzados, el mismo archivo a la vez). No se bloquea
  // —a veces es lo que quieres—, pero se advierte una vez por tarea.
  const warnCollision = (target) => {
    if (!writeMode || !project) return
    const otros = running.filter((r) => r !== target && roleStates[r] && roleStates[r] !== 'delivering')
    if (!otros.length) return
    const quien = otros.map((r) => memberOf(r).name).join(', ')
    showToast(`⚠️ ${quien} ya está editando ${project.split('/').pop()} — cuidado con pisarse`, 6000)
  }

  // sitúa un job: si el agente está libre y sin cola → va; si no → encola
  const routeJob = (job) => {
    atBottomRef.current = true // enviar algo re-engancha el auto-scroll
    checkQuota()
    warnCollision(job.target)
    const busyOrQueued = !!roleStates[job.target] || (queuesRef.current[job.target]?.length > 0)
    if (busyOrQueued) enqueueJob(job)
    else dispatchJob(job)
  }

  // Reintenta el último job de un rol (tras un error).
  const retryJob = (who) => {
    const job = lastJobRef.current[who]
    if (job) routeJob({ ...job, id: crypto.randomUUID() })
  }

  // Saca un mensaje de la cola antes de que se despache (✕ en el chip "en cola").
  const cancelQueued = (m) => {
    const q = queuesRef.current[m.to]
    if (q) queuesRef.current[m.to] = q.filter((j) => j.id !== m.jobId)
    syncQueues()
    setMessages((ms) => ms.map((x) => (x.jobId === m.jobId ? { ...x, queued: false, cancelled: true } : x)))
    showToast('Mensaje sacado de la cola')
  }

  // Respuesta rápida: envía una opción elegida al agente (encola si ocupado).
  const quickReply = (option, target) => {
    if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
    routeJob({ id: crypto.randomUUID(), target, text: option, display: option, prompt: option, atts: [] })
  }

  const send = (ev) => {
    ev.preventDefault()
    const text = input.trim()
    if (!text && !attachments.length && !refs.length) return
    if (text.startsWith('/') && handleLocalCommand(text)) {
      setInput('')
      return
    }
    if (!window.oficina?.ask) {
      showToast('Sin Electron — corre npm run dev')
      return
    }
    // "@todos <mensaje>": el mismo prompt a todos los agentes libres a la vez
    const bcast = /^@?todos[\s,:]+/i.exec(text)
    if (bcast) {
      const rest = text.slice(bcast[0].length).trim()
      if (!rest) {
        showToast('⚠️ @todos necesita un mensaje')
        return
      }
      const free = squad.filter((m) => !roleStates[m.id] && !(queuesRef.current[m.id]?.length > 0))
      if (!free.length) {
        showToast('Todo el squad está ocupado — intenta en un momento')
        return
      }
      if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
      // un solo jobId compartido: el mensaje del usuario se pinta una vez
      checkQuota()
      const sharedId = crypto.randomUUID()
      free.forEach((m, i) =>
        setTimeout(() => dispatchJob({ id: sharedId, target: m.id, text: rest, display: `📢 @todos — ${rest}`, prompt: rest, atts: [] }), i * 400)
      )
      showToast(`📢 Enviado a ${free.length} agente${free.length > 1 ? 's' : ''}`)
      setInput('')
      setAttachments([])
      setRefs([])
      if (inputRef.current) inputRef.current.style.height = 'auto'
      return
    }
    const target = routeMessage(text, squad, principal)
    if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
    const handoffTo = detectHandoff(text, squad, target)
    // adjuntos: imágenes (Read) y carpetas/archivos del disco (Glob/Read)
    const atts = attachments
    const rfs = refs
    let prompt = text || (rfs.length ? 'Haz un breve resumen de los documentos.' : 'Describe y analiza las imágenes adjuntas.')
    if (rfs.length) {
      const list = rfs.map((r) => `- ${r.isDir ? '📁 carpeta' : '📄 archivo'}: ${r.path}`).join('\n')
      prompt = `Tengo estos elementos en mi disco (léelos con Glob para listar y Read para su contenido; en carpetas revisa los documentos que haya):\n${list}\n\n${prompt}`
    }
    if (atts.length) {
      prompt = `He adjuntado ${atts.length} imagen(es). Léelas con la herramienta Read:\n${atts.map((a) => `- ${a.path}`).join('\n')}\n\n${prompt}`
    }
    routeJob({
      id: crypto.randomUUID(),
      target,
      text,
      display: text || (rfs.length ? '📁' : '🖼'),
      prompt,
      handoffTo,
      // imágenes con su path (para miniatura); refs solo por nombre
      atts: [...atts.map((a) => ({ name: a.name, path: a.path })), ...rfs.map((r) => r.name)],
    })
    setInput('')
    setAttachments([])
    setRefs([])
    if (inputRef.current) inputRef.current.style.height = 'auto' // vuelve a 1 línea
  }

  return (
    <div className="app" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      <header className="hud">
        <span className="dot" />
        <b>LA OFICINA</b>
        {/* contexto unificado: perfil + proyecto en un solo dropdown */}
        <div className="ctx">
          <button
            type="button"
            className="ctxbtn"
            onClick={() => setCtxOpen((o) => !o)}
            disabled={busy}
            title="Perfil y proyecto"
          >
            {profile === 'work' ? '💼' : profile === 'private' ? '🔒' : '🧑'} {profile}
            <span className="ctx-sep">/</span>
            <span className="ctx-proj">
              {(projects.find((x) => x.path === project)?.name || project.split('/').pop() || '…').replace(/^(🗂|📌) /, '')}
            </span>
            <span className="ctx-caret">▾</span>
          </button>
          {ctxOpen && (
            <>
              <div className="ctx-backdrop" onClick={() => setCtxOpen(false)} />
              <div className="ctx-pop">
                {(cfg?.profiles?.length || 0) > 1 && (
                  <div className="ctx-tabs">
                    {cfg.profiles.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={p === profile ? 'ctx-tab on' : 'ctx-tab'}
                        onClick={() => changeProfile(p)}
                      >
                        {p === 'work' ? '💼 work' : p === 'private' ? '🔒 private' : `🧑 ${p}`}
                      </button>
                    ))}
                  </div>
                )}
                {projects.map((p) => (
                  <button
                    key={p.path}
                    type="button"
                    className={p.path === project ? 'ctx-item on' : 'ctx-item'}
                    title={p.path}
                    onClick={() => {
                      selectProject(p.path)
                      setCtxOpen(false)
                    }}
                  >
                    {p.name}
                  </button>
                ))}
                <button
                  type="button"
                  className="ctx-item ctx-add"
                  onClick={async () => {
                    await addProjectFlow()
                    setCtxOpen(false)
                  }}
                >
                  ➕ Agregar proyecto…
                </button>
              </div>
            </>
          )}
        </div>
        <div className="hud-actions">
          {/* secundarias en ícono-solo (tooltip); la primaria es "+ Nueva" */}
          <button type="button" className="iconbtn" onClick={toggleArts} title="Documentos creados por el squad">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </button>
          {/* Historial y Configuración se pueden abrir mientras el squad trabaja:
              sus controles internos ya se deshabilitan solos cuando aplica */}
          <button type="button" className="iconbtn" onClick={toggleHist} title="Historial (⌘Y)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button type="button" className="primarybtn" onClick={newChat} disabled={busy} title="Conversación nueva (⌘K)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Nueva</span>
          </button>
          <button type="button" className="iconbtn gearspin" onClick={openPrefs} title="Configuración (⌘,)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <div className="stage">
        <SysMonitor profile={profile} modelLabel={modelLabelOf(model)} tokens={convTokens} />
        <Office
          roleStates={roleStates}
          status={status}
          squad={squad}
          theme={effectiveTheme}
          tool={tool}
          todos={agentTodos}
          standup={standupIds}
          subagents={Object.keys(agentTool).filter((r) => agentTool[r] === 'Task')}
          pet={pet}
          quality={quality}
          elapsed={elapsed}
          queued={queuedCounts}
          deliverTargets={deliverTargets}
          onPickMember={(id) => {
            // clic en un personaje = dirigirle el mensaje (como ⌘1-⌘6)
            const m = squad.find((x) => x.id === id)
            if (!m) return
            setInput((v) => `${m.name}, ${v.replace(/^\S+,\s*/, '')}`)
            inputRef.current?.focus()
          }}
          onTourDone={(r) => {
            setRS(r, 'idle')
            setDeliverTargets((d) => {
              const copy = { ...d }
              delete copy[r]
              return copy
            })
          }}
        />

        {prefsOpen && (
          <div className="drawer">
            <div className="drawer-head">
              <b>⚙️ Configuración</b>
              <button onClick={() => setPrefsOpen(false)}>✕</button>
            </div>

            {/* navegación: filas de menú (ícono · label · chevron) */}
            <div className="menu-group">
              <button type="button" className="menu-item" onClick={openAgents}>
                <span className="mi-icon">👥</span>
                <span className="mi-label">Agentes</span>
                <span className="mi-hint">{squad.length} activos</span>
                <span className="mi-chev">›</span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={async () => {
                  const r = await window.oficina?.openClaudeMd?.(project)
                  showToast(r?.ok ? '📘 CLAUDE.md abierto — lo leen todos los agentes' : '⚠️ No pude abrirlo')
                  setHasClaudeMd(true)
                }}
              >
                <span className="mi-icon">📘</span>
                <span className="mi-label">CLAUDE.md del proyecto</span>
                <span className="mi-hint">{hasClaudeMd ? 'existe' : 'crear'}</span>
                <span className="mi-chev">›</span>
              </button>
              <button type="button" className="menu-item" onClick={openSkills}>
                <span className="mi-icon">🧩</span>
                <span className="mi-label">Skills</span>
                <span className="mi-hint">superpoderes del perfil</span>
                <span className="mi-chev">›</span>
              </button>
              <button type="button" className="menu-item" onClick={openMcp}>
                <span className="mi-icon">🌐</span>
                <span className="mi-label">Servidores MCP</span>
                <span className="mi-hint">herramientas externas</span>
                <span className="mi-chev">›</span>
              </button>
              <button type="button" className="menu-item" onClick={openStats}>
                <span className="mi-icon">📈</span>
                <span className="mi-label">Estadísticas</span>
                <span className="mi-hint">tareas · tokens · tiempos</span>
                <span className="mi-chev">›</span>
              </button>
              <button type="button" className="menu-item" onClick={openDiag}>
                <span className="mi-icon">🔧</span>
                <span className="mi-label">Diagnóstico</span>
                <span className="mi-hint">eventos y errores</span>
                <span className="mi-chev">›</span>
              </button>
              <button type="button" className="menu-item" onClick={() => window.oficina?.openHelp?.()}>
                <span className="mi-icon">📖</span>
                <span className="mi-label">Guía de uso</span>
                <span className="mi-chev">›</span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  closePanels()
                  setTourOpen(true)
                }}
              >
                <span className="mi-icon">🎓</span>
                <span className="mi-label">Tour de bienvenida</span>
                <span className="mi-chev">›</span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={async () => {
                  const res = await window.oficina?.openTerminal?.(project)
                  showToast(res?.ok ? `🖥 Abriendo ${res.app}…` : '⚠️ No pude abrir la terminal')
                }}
              >
                <span className="mi-icon">🖥</span>
                <span className="mi-label">Abrir terminal en el proyecto</span>
                <span className="mi-chev">›</span>
              </button>
              <button type="button" className="menu-item" onClick={exportConfig}>
                <span className="mi-icon">💾</span>
                <span className="mi-label">Exportar configuración</span>
                <span className="mi-hint">squad · plantillas · personas</span>
                <span className="mi-chev">›</span>
              </button>
              <button type="button" className="menu-item" onClick={importConfig}>
                <span className="mi-icon">📥</span>
                <span className="mi-label">Importar configuración</span>
                <span className="mi-hint">o restaurar un respaldo</span>
                <span className="mi-chev">›</span>
              </button>
            </div>

            {/* preferencias — aplican al instante */}
            <div className="menu-sec">Preferencias</div>
            <div className="menu-group">
            <div className="pref-row">
              <span className="pref-label">Modelo:</span>
              <select className="sel pref-sel" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
                {[...new Set([model, ...Object.keys(MODEL_OPTIONS)])].map((id) => (
                  <option key={id} value={id}>
                    {modelLabelOf(id)}
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">Intro:</span>
              <select className="sel pref-sel" value={introOn ? '1' : '0'} onChange={(e) => saveIntro(e.target.value === '1')}>
                <option value="1">🎬 Mostrar al abrir la app</option>
                <option value="0">Sin intro</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">Calidad:</span>
              <select className="sel pref-sel" value={quality} onChange={(e) => saveQuality(e.target.value)}>
                <option value="cine">🎬 Cine — todos los efectos</option>
                <option value="normal">✨ Normal (recomendado)</option>
                <option value="ligera">🔋 Ligera — ahorra batería</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">Mascota:</span>
              <select className="sel pref-sel" value={pet} onChange={(e) => savePet(e.target.value)}>
                <option value="">Sin mascota</option>
                <option value="Fox">🦊 Zorrito</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">Slack:</span>
              <input
                className="sel pref-sel"
                placeholder="canal para el standup (ej: equipo-dev)"
                value={slackChannel}
                onChange={(e) => saveSlackChannel(e.target.value)}
              />
            </div>
            <div className="pref-row">
              <span className="pref-label">Standup:</span>
              <select className="sel pref-sel" value={standupAt} onChange={(e) => saveStandupAt(e.target.value)}>
                <option value="">Apagado</option>
                {['08:00', '08:30', '09:00', '09:30', '10:00', '11:00', '12:00'].map((h) => (
                  <option key={h} value={h}>
                    📋 {h} · días hábiles
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">Permiso:</span>
              <select
                className="sel pref-sel"
                value={writeMode ? 'write' : 'read'}
                onChange={(e) => setWritePermission(e.target.value === 'write')}
                disabled={busy}
              >
                <option value="write">✏️ Edición — puede modificar y correr comandos</option>
                <option value="read">🔒 Lectura — solo investigar</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">Tema:</span>
              <select className="sel pref-sel" value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="auto">🌗 Auto — Noche al atardecer</option>
                {Object.entries(THEMES).map(([id, t]) => (
                  <option key={id} value={id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">Documentos:</span>
              <button type="button" className="pref-toggle" onClick={pickArtsDir} title={artsDir}>
                📁 …{artsDir.slice(-30) || 'Carpeta por defecto'}
              </button>
            </div>
            <div className="pref-row">
              <span className="pref-label">Pizarra:</span>
              <button
                type="button"
                className={board ? 'pref-toggle on' : 'pref-toggle'}
                onClick={() => setBoard((b) => !b)}
                title="Memoria común del squad en SQUAD.md (leen y anotan lo importante)"
              >
                {board ? '🧠 Activada' : '🧠 Desactivada'}
              </button>
              <button
                type="button"
                className="newchat"
                style={{ flex: 'none' }}
                onClick={async () => {
                  const res = await window.oficina?.openBoard?.(project)
                  showToast(res?.ok ? '🧠 Abriendo SQUAD.md…' : '⚠️ Reinicia la app (npm run dev)')
                }}
                title="Ver/editar SQUAD.md del proyecto"
              >
                Abrir
              </button>
            </div>
            <div className="pref-row">
              <span className="pref-label">Notificaciones:</span>
              <button
                type="button"
                className={sound ? 'pref-toggle on' : 'pref-toggle'}
                onClick={() => setSound((s) => !s)}
                title={sound ? 'Apagar sonidos y avisos' : 'Encender sonidos y avisos'}
              >
                {sound ? '🔔 Encendidas' : '🔕 Apagadas'}
              </button>
            </div>
            </div>

            <div className="menu-foot">La Oficina{appVersion ? ` · v${appVersion}` : ''}</div>
          </div>
        )}

        {diagOpen && (
          <div className="drawer over">
            <div className="drawer-head">
              <b>🔧 Diagnóstico</b>
              <button onClick={() => setDiagOpen(false)} title="Volver a Configuración">✕</button>
            </div>
            <div className="diag-actions">
              <button
                type="button"
                className="skill-manual"
                onClick={() => {
                  navigator.clipboard.writeText(diagText())
                  showToast('Log copiado 📋')
                }}
              >
                📋 Copiar todo
              </button>
              <button
                type="button"
                className="skill-manual"
                onClick={() => {
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(new Blob([diagText()], { type: 'text/plain' }))
                  a.download = `la-oficina-diagnostico-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`
                  a.click()
                  URL.revokeObjectURL(a.href)
                  showToast('⬇ Log exportado a Descargas')
                }}
              >
                ⬇ Exportar
              </button>
              <button type="button" className="skill-manual" onClick={openDiag}>🔄 Refrescar</button>
            </div>
            {diagRows.length === 0 && <div className="hist-empty">Sin eventos aún — se registran init, tools, entregas y errores</div>}
            {diagRows.map((r, i) => (
              <div key={i} className={`diag-row ${r.kind}`}>
                <span className="diag-time">{new Date(r.t).toLocaleTimeString('es')}</span>
                <span className="diag-role">{memberOf(r.role).name || r.role}</span>
                <span className="diag-kind">{r.kind}</span>
                <span className="diag-info">{r.info}</span>
              </div>
            ))}
          </div>
        )}

        {statsOpen && (
          <div className="drawer over">
            <div className="drawer-head">
              <b>📈 Estadísticas de la oficina</b>
              <button onClick={() => setStatsOpen(false)} title="Volver a Configuración">✕</button>
            </div>
            {(() => {
              const days = [...Array(7)].map((_, i) => {
                const d = new Date(Date.now() - (6 - i) * 86400000)
                const key = d.toISOString().slice(0, 10)
                return { key, label: d.toLocaleDateString('es', { weekday: 'short' }), ...(statsData[key] || { tasks: 0, tokens: 0, ms: 0, agents: {} }) }
              })
              const maxTok = Math.max(...days.map((d) => d.tokens), 1)
              // agregado de los 7 días por agente
              const agents = {}
              for (const d of days) {
                for (const [id, a] of Object.entries(d.agents || {})) {
                  const t = (agents[id] ||= { tasks: 0, tokens: 0, ms: 0 })
                  t.tasks += a.tasks
                  t.tokens += a.tokens
                  t.ms += a.ms
                }
              }
              const rows = Object.entries(agents).sort((a, b) => b[1].tasks - a[1].tasks)
              const total = days.reduce((s, d) => s + d.tasks, 0)
              if (!total) return <div className="hist-empty">Aún no hay datos — se acumulan con cada tarea terminada</div>
              return (
                <>
                  <div className="menu-sec">🪙 Tokens · últimos 7 días</div>
                  <div className="stats-bars">
                    {days.map((d) => (
                      <div key={d.key} className="stats-col" title={`${d.key} · ${d.tasks} tareas · ${fmtTokens(d.tokens)} tokens`}>
                        <span className="stats-val">{d.tokens ? fmtTokens(d.tokens) : ''}</span>
                        <div className="stats-bar" style={{ height: `${Math.max((d.tokens / maxTok) * 100, 2)}%` }} />
                        <span className="stats-day">{d.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="menu-sec">Por agente · 7 días</div>
                  {rows.map(([id, a]) => (
                    <div key={id} className="hist-item skill-item">
                      <div className="skill-info">
                        <div className="hist-title">
                          {memberOf(id).emoji} {memberOf(id).name}
                        </div>
                        <div className="hist-meta">
                          {a.tasks} tarea{a.tasks !== 1 ? 's' : ''} · 🪙 {fmtTokens(a.tokens)} · ⏱ {fmtElapsed(a.ms / Math.max(a.tasks, 1))} promedio
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="skills-note">
                    Total 7 días: {total} tareas · 🪙 {fmtTokens(days.reduce((s, d) => s + d.tokens, 0))}. Se guardan 60 días.
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {mcpOpen && (
          <div className="drawer over">
            <div className="drawer-head">
              <b>🌐 Servidores MCP · {profile === 'work' ? '💼 work' : '🔒 private'}</b>
              <button onClick={() => setMcpOpen(false)} title="Volver a Configuración">✕</button>
            </div>
            <div className="skills-note">
              Conectan herramientas externas a tus agentes (navegador, documentación, diseño). Se guardan en el perfil y los
              agentes los usan automáticamente.
            </div>
            {mcpList === null && <div className="hist-empty">Leyendo servidores del perfil…</div>}
            {mcpList !== null && (
              <>
                {mcpList.length === 0 && (
                  <div className="hist-empty">Aún no tienes servidores en este perfil — conecta del catálogo 👇</div>
                )}
                {MCP_CATALOG.map((s) => {
                  const inst = mcpList.some((x) => x.name === s.id)
                  return (
                    <div key={s.id} className="hist-item skill-item">
                      <div className="skill-info">
                        <div className="hist-title">
                          {s.name} {inst && <span className="skill-ok">✓ conectado</span>}
                        </div>
                        <div className="hist-meta">{s.desc}</div>
                        <div className="skill-tags">
                          {s.roles.map((r) => (
                            <span key={r} className="skill-tag">{ROLE_TAGS[r] || r}</span>
                          ))}
                        </div>
                      </div>
                      <div className="art-actions">
                        {mcpBusy === s.id ? (
                          <span className="skill-busy">⏳</span>
                        ) : inst ? (
                          <button title="Quitar del perfil" onClick={() => removeMcp(s.id)}>🗑</button>
                        ) : s.manual ? (
                          <button
                            className="skill-manual"
                            title="Se configura por fuera de la app — abre la guía oficial"
                            onClick={() => window.open(s.link)}
                          >
                            Cómo conectarlo ↗
                          </button>
                        ) : s.needsEnv ? (
                          <button
                            className="skill-install"
                            title={`Necesita tu ${s.needsEnv} — se pide en el formulario`}
                            onClick={() => setMcpForm({ name: s.id, target: s.cmd.join(' '), envs: `${s.needsEnv}=` })}
                          >
                            Conectar…
                          </button>
                        ) : (
                          <button className="skill-install" onClick={() => addMcp(s)}>Conectar</button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {mcpList
                  .filter((x) => !MCP_CATALOG.some((s) => s.id === x.name))
                  .map((x) => (
                    <div key={x.name} className="hist-item skill-item">
                      <div className="skill-info">
                        <div className="hist-title">
                          {x.name} <span className="skill-ok">✓ conectado</span>
                        </div>
                        <div className="hist-meta">{x.spec}</div>
                      </div>
                      <div className="art-actions">
                        {mcpBusy === x.name ? (
                          <span className="skill-busy">⏳</span>
                        ) : (
                          <button title="Quitar del perfil" onClick={() => removeMcp(x.name)}>🗑</button>
                        )}
                      </div>
                    </div>
                  ))}
                {/* lo que ve el CLI: conectores de la cuenta claude.ai y servers
                    configurados desde la terminal (solo lectura desde aquí) */}
                <div className="menu-sec">Desde tu cuenta y terminal</div>
                {mcpAccount?.loading && <div className="hist-empty">Consultando al CLI (hace health-check, tarda unos segundos)…</div>}
                {mcpAccount?.error && <div className="hist-empty">⚠️ {mcpAccount.error}</div>}
                {mcpAccount?.servers &&
                  (() => {
                    const extra = mcpAccount.servers.filter((s) => !mcpList.some((x) => x.name === s.name))
                    if (!extra.length) return <div className="hist-empty">Nada más configurado fuera de la app</div>
                    return extra.map((s) => (
                      <div key={s.name} className="hist-item skill-item">
                        <div className="skill-info">
                          <div className="hist-title">
                            {s.name}{' '}
                            <span className={s.status.startsWith('✔') ? 'skill-ok' : 'mcp-warn'}>
                              {s.status.startsWith('✔') ? '✓ conectado' : s.status.replace(/^!\s*/, '⚠ ')}
                            </span>
                          </div>
                          <div className="hist-meta">{s.target}</div>
                        </div>
                      </div>
                    ))
                  })()}
                {mcpForm ? (
                  <div className="snip-form">
                    <input
                      placeholder="Nombre (ej: mi-servidor)"
                      value={mcpForm.name}
                      onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
                      autoFocus
                    />
                    <input
                      placeholder="Comando (npx paquete…) o URL https://…"
                      value={mcpForm.target}
                      onChange={(e) => setMcpForm({ ...mcpForm, target: e.target.value })}
                    />
                    <textarea
                      placeholder={'Variables de entorno (opcional, una por línea)\nGEMINI_API_KEY=tu-key'}
                      rows={2}
                      value={mcpForm.envs || ''}
                      onChange={(e) => setMcpForm({ ...mcpForm, envs: e.target.value })}
                    />
                    <div className="snip-form-row">
                      <button type="button" onClick={() => setMcpForm(null)}>Cancelar</button>
                      <button
                        type="button"
                        className="snip-save"
                        disabled={!mcpForm.name.trim() || !mcpForm.target.trim()}
                        onClick={addMcpCustom}
                      >
                        Conectar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="snip-new" onClick={() => setMcpForm({ name: '', target: '' })}>
                    ➕ Conectar otro servidor
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {skillsOpen && (
          <div className="drawer over">
            <div className="drawer-head">
              <b>🧩 Skills · {profile === 'work' ? '💼 work' : '🔒 private'}</b>
              <button onClick={() => setSkillsOpen(false)} title="Volver a Configuración">✕</button>
            </div>
            <div className="skills-note">
              Se instalan en el perfil ({profile === 'work' ? '~/.claude-work' : '~/.claude-private'}) y los agentes las usan
              automáticamente cuando la tarea lo amerita.
            </div>
            {installedSkills?.length > 0 && (
              <div className="diag-actions">
                <button type="button" className="skill-manual" onClick={updateAllSkills} disabled={skillsUpdating}>
                  {skillsUpdating ? '⏳ Actualizando…' : '🔄 Actualizar todo'}
                </button>
              </div>
            )}
            {installedSkills === null && <div className="hist-empty">Leyendo skills instaladas…</div>}
            {installedSkills !== null && (
              <>
                {installedSkills.length === 0 && (
                  <div className="hist-empty">Aún no tienes skills en este perfil — instala del catálogo 👇</div>
                )}
                {SKILL_CATALOG.map((s) => {
                  const inst = installedSkills.some((x) => x.id === s.id)
                  return (
                    <div key={s.id} className="hist-item skill-item">
                      <div className="skill-info">
                        <div className="hist-title">
                          {s.name} {inst && <span className="skill-ok">✓ instalada</span>}
                        </div>
                        <div className="hist-meta">{s.desc}</div>
                        <div className="skill-tags">
                          {s.roles.map((r) => (
                            <span key={r} className="skill-tag">{ROLE_TAGS[r] || r}</span>
                          ))}
                        </div>
                      </div>
                      <div className="art-actions">
                        {skillBusy === s.id ? (
                          <span className="skill-busy">⏳</span>
                        ) : inst ? (
                          <>
                            <button title="Actualizar a la última versión" onClick={() => installSkill(s)}>🔄</button>
                            <button title="Quitar del perfil" onClick={() => removeSkill(s.id)}>🗑</button>
                          </>
                        ) : (
                          <button className="skill-install" onClick={() => installSkill(s)}>Instalar</button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {installedSkills
                  .filter((x) => !SKILL_CATALOG.some((s) => s.id === x.id))
                  .map((x) => (
                    <div key={x.id} className="hist-item skill-item">
                      <div className="skill-info">
                        <div className="hist-title">
                          {x.id} <span className="skill-ok">✓ instalada</span>
                        </div>
                        <div className="hist-meta">{x.desc || 'Skill propia (fuera del catálogo)'}</div>
                      </div>
                      <div className="art-actions">
                        {skillBusy === x.id ? (
                          <span className="skill-busy">⏳</span>
                        ) : (
                          <button title="Quitar del perfil" onClick={() => removeSkill(x.id)}>🗑</button>
                        )}
                      </div>
                    </div>
                  ))}

                {/* instalar desde cualquier repo de GitHub */}
                <div className="menu-sec">Desde un repo</div>
                <div className="skill-scan">
                  <input
                    placeholder="usuario/repo o URL de GitHub…"
                    value={scanUrl}
                    onChange={(e) => setScanUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && scanRepo()}
                  />
                  <button type="button" className="skill-install" onClick={scanRepo} disabled={scanResult?.loading}>
                    {scanResult?.loading ? '⏳' : 'Buscar'}
                  </button>
                </div>
                {scanResult?.error && <div className="hist-empty">⚠️ {scanResult.error}</div>}
                {scanResult?.skills?.length === 0 && <div className="hist-empty">Ese repo no trae carpetas con SKILL.md</div>}
                {scanResult?.skills?.map((s) => {
                  const inst = installedSkills.some((x) => x.id === s.id)
                  return (
                    <div key={s.id} className="hist-item skill-item">
                      <div className="skill-info">
                        <div className="hist-title">
                          {s.id} {inst && <span className="skill-ok">✓ instalada</span>}
                        </div>
                        <div className="hist-meta">{s.desc || `de ${scanResult.repo}`}</div>
                      </div>
                      <div className="art-actions">
                        {skillBusy === s.id ? (
                          <span className="skill-busy">⏳</span>
                        ) : (
                          <button className="skill-install" onClick={() => installSkill({ id: s.id, repo: scanResult.repo, name: s.id })}>
                            {inst ? 'Actualizar' : 'Instalar'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* crear una skill propia */}
                {skillForm ? (
                  <div className="snip-form">
                    <input
                      placeholder="Nombre (ej: estilo-mis-proyectos)"
                      value={skillForm.name}
                      onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })}
                      autoFocus
                    />
                    <textarea
                      placeholder="¿Cuándo debe usarla el agente? (esto decide su activación)"
                      rows={2}
                      value={skillForm.desc}
                      onChange={(e) => setSkillForm({ ...skillForm, desc: e.target.value })}
                    />
                    <div className="snip-form-row">
                      <button type="button" onClick={() => setSkillForm(null)}>Cancelar</button>
                      <button type="button" className="snip-save" disabled={!skillForm.name.trim()} onClick={createSkill}>
                        Crear y abrir
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="snip-new" onClick={() => setSkillForm({ name: '', desc: '' })}>
                    ➕ Crear skill propia
                  </button>
                )}

                {/* plugins: paquetes completos vía claude plugin CLI */}
                <div className="menu-sec">Plugins</div>
                <div className="skills-note">
                  Paquetes completos (skills + comandos + agentes + MCP) instalados con el CLI de Claude Code. Cualquier repo de
                  GitHub sirve como fuente.
                </div>
                {pluginData?.loading && <div className="hist-empty">Consultando plugins del perfil…</div>}
                {pluginData?.error && <div className="hist-empty">⚠️ {pluginData.error}</div>}
                {pluginData?.installed && (
                  <>
                    <div className="skill-scan">
                      <input
                        placeholder="Añadir fuente: usuario/repo o URL…"
                        value={mktUrl}
                        onChange={(e) => setMktUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addMkt()}
                      />
                      <button type="button" className="skill-install" onClick={addMkt} disabled={pluginBusy === 'mkt'}>
                        {pluginBusy === 'mkt' ? '⏳' : 'Añadir'}
                      </button>
                    </div>
                    {pluginData.marketplaces.map((m) => (
                      <div key={m.name} className="hist-item skill-item">
                        <div className="skill-info">
                          <div className="hist-title">📦 {m.name}</div>
                          <div className="hist-meta">{m.repo}</div>
                        </div>
                        <div className="art-actions">
                          {pluginBusy === m.name ? (
                            <span className="skill-busy">⏳</span>
                          ) : (
                            m.name !== 'claude-plugins-official' && (
                              <button title="Quitar fuente" onClick={() => removeMkt(m.name)}>🗑</button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                    {pluginData.installed.map((p) => (
                      <div key={p.id} className="hist-item skill-item">
                        <div className="skill-info">
                          <div className="hist-title">
                            🔌 {p.name} <span className="skill-ok">✓ instalado</span>
                          </div>
                          <div className="hist-meta">{p.desc}</div>
                        </div>
                        <div className="art-actions">
                          {pluginBusy === p.id ? (
                            <span className="skill-busy">⏳</span>
                          ) : (
                            <button title="Desinstalar" onClick={() => uninstallPlugin(p.id)}>🗑</button>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="skill-scan">
                      <input
                        placeholder={`🔍 Buscar entre ${pluginData.available.length} plugins disponibles…`}
                        value={pluginQuery}
                        onChange={(e) => setPluginQuery(e.target.value)}
                      />
                    </div>
                    {pluginQuery.trim() &&
                      pluginData.available
                        .filter((p) => norm(`${p.name} ${p.desc}`).includes(norm(pluginQuery)))
                        .sort((a, b) => b.installs - a.installs)
                        .slice(0, 8)
                        .map((p) => (
                          <div key={p.id} className="hist-item skill-item">
                            <div className="skill-info">
                              <div className="hist-title">{p.name}</div>
                              <div className="hist-meta">{p.desc}</div>
                              <div className="skill-tags">
                                <span className="skill-tag">📦 {p.marketplace}</span>
                                {p.installs > 0 && <span className="skill-tag">⬇ {fmtTokens(p.installs)}</span>}
                              </div>
                            </div>
                            <div className="art-actions">
                              {pluginBusy === p.id ? (
                                <span className="skill-busy">⏳</span>
                              ) : pluginData.installed.some((x) => x.name === p.name) ? (
                                <span className="skill-ok">✓</span>
                              ) : (
                                <button className="skill-install" onClick={() => installPlugin(p.id)}>Instalar</button>
                              )}
                            </div>
                          </div>
                        ))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {agentsOpen && (
          <div className="drawer over">
            <div className="drawer-head">
              <b>👥 Agentes</b>
              <button onClick={closeAgents} title="Volver a Configuración">✕</button>
            </div>
            <div className="preset-row">
              {SQUAD_PRESETS.map((p) => (
                <button key={p.id} type="button" className="preset-chip" onClick={() => applyPreset(p)} title={`Activa: ${p.roles.join(', ')}`}>
                  {p.label}
                </button>
              ))}
            </div>
            {draft.map((r) => (
              <div
                key={r.id}
                className={[
                  'squad-row',
                  dragId === r.id ? 'dragging' : '',
                  dropId === r.id && dragId !== r.id ? 'droptarget' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (dropId !== r.id) setDropId(r.id)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dropRole(r.id)
                }}
              >
                <div className="squad-row-top">
                  <span
                    className="squad-grip"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      setDragId(r.id)
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setDropId(null)
                    }}
                    title="Arrastrar para reordenar"
                  >
                    ⠿
                  </span>
                  <span className="squad-emoji">{metaOf(r).emoji}</span>
                  <input
                    className="squad-name"
                    value={r.name}
                    maxLength={16}
                    onChange={(e) => renameMember(r.id, e.target.value)}
                    style={{ borderColor: metaOf(r).color }}
                  />
                  <span className="squad-label">{r.custom ? 'personalizado' : metaOf(r).label}</span>
                  {/* columna de ancho fijo para ✏️/🗑: así el switch queda
                      alineado verticalmente en todas las filas */}
                  <span className="squad-tools">
                    {r.custom && (
                      <button
                        type="button"
                        className="squad-del"
                        onClick={() => startEditRole(r)}
                        title="Editar foco, keywords, emoji y color"
                      >
                        ✏️
                      </button>
                    )}
                    {canDelete(r) && (
                      <button
                        type="button"
                        className="squad-del"
                        onClick={() => deleteRole(r.id)}
                        title={r.custom ? 'Eliminar este rol personalizado' : 'Eliminar este rol'}
                      >
                        🗑️
                      </button>
                    )}
                  </span>
                  {/* switch al borde derecho, misma columna en todas las filas */}
                  <label className="switch" title={r.enabled ? 'Desactivar' : 'Activar'}>
                    <input type="checkbox" checked={r.enabled} onChange={() => toggleMember(r.id)} />
                    <span className="switch-track" />
                  </label>
                </div>
                {/* personaje y personalidad se editan igual esté activo o no */}
                <div className="squad-actions">
                  <button
                    type="button"
                    className={avatarPicker === r.id ? 'squad-avatar-btn open' : 'squad-avatar-btn'}
                    onClick={() => setAvatarPicker((p) => (p === r.id ? null : r.id))}
                  >
                    🧍 {avatarLabel(effectiveAvatar(r))}
                  </button>
                  <button
                    type="button"
                    className="squad-avatar-btn"
                    onClick={() => window.oficina?.openPersona?.(profile, r.id, r.name)}
                    title="Editar la personalidad de este personaje (.md)"
                  >
                    ✏️ Personalidad
                  </button>
                  <select
                    className="squad-avatar-btn squad-model"
                    value={r.model || ''}
                    onChange={(e) => setMemberModel(r.id, e.target.value)}
                    title="Modelo propio de este agente (Global = el del selector de arriba)"
                  >
                    <option value="">🧠 Global</option>
                    {Object.keys(MODEL_OPTIONS).map((id) => (
                      <option key={id} value={id}>
                        🧠 {modelLabelOf(id)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            {addingRole ? (
              <div className="add-role">
                <input
                  className="add-role-in"
                  placeholder="Nombre (ej: Traductor)"
                  value={nr.name}
                  maxLength={16}
                  onChange={(e) => setNr((v) => ({ ...v, name: e.target.value }))}
                />
                <input
                  className="add-role-in"
                  placeholder="Foco / especialidad (ej: traducir textos ES↔EN)"
                  value={nr.focus}
                  onChange={(e) => setNr((v) => ({ ...v, focus: e.target.value }))}
                />
                <input
                  className="add-role-in"
                  placeholder="Palabras clave de ruteo (traduce, translate)"
                  value={nr.kw}
                  onChange={(e) => setNr((v) => ({ ...v, kw: e.target.value }))}
                />
                <div className="add-role-row">
                  <input
                    className="add-role-emoji"
                    placeholder="🛠️"
                    value={nr.emoji}
                    maxLength={2}
                    onChange={(e) => setNr((v) => ({ ...v, emoji: e.target.value }))}
                  />
                  <input
                    type="color"
                    className="add-role-color"
                    value={nr.color}
                    onChange={(e) => setNr((v) => ({ ...v, color: e.target.value }))}
                    title="Color del nametag/globo"
                  />
                  <select
                    className="add-role-avatar"
                    value={nr.avatar}
                    onChange={(e) => setNr((v) => ({ ...v, avatar: e.target.value }))}
                    title="Personaje 3D"
                  >
                    <option value="">Personaje (auto)</option>
                    {AVATARS.map((a) => (
                      <option key={a} value={a}>
                        {avatarLabel(a)}
                      </option>
                    ))}
                  </select>
                </div>
                <select
                  className="add-role-in"
                  value={nr.model}
                  onChange={(e) => setNr((v) => ({ ...v, model: e.target.value }))}
                  title="Modelo propio de este agente (si no, usa el global)"
                >
                  <option value="">🧠 Modelo: el global ({modelLabelOf(model)})</option>
                  {Object.keys(MODEL_OPTIONS).map((id) => (
                    <option key={id} value={id}>
                      🧠 {modelLabelOf(id)}
                    </option>
                  ))}
                </select>
                <div className="add-role-actions">
                  <button type="button" className="add-role-ok" onClick={addRole}>
                    {editingId ? 'Guardar cambios' : 'Crear rol'}
                  </button>
                  <button
                    type="button"
                    className="add-role-cancel"
                    onClick={() => (setAddingRole(false), setNr(NEW_ROLE), setEditingId(null))}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button className="squad-add" type="button" onClick={() => setAddingRole(true)}>
                ➕ Agregar rol
              </button>
            )}
            {missingBuiltins.length > 0 && (
              <button className="squad-add" type="button" onClick={restoreDefaults} title="Recupera UI/UX, QA o Docs si los borraste">
                ♻️ Restaurar roles predeterminados ({missingBuiltins.length})
              </button>
            )}
            <button className="squad-save" onClick={saveSquad}>
              Guardar squad ({draftEnabled}/{MAX_ACTIVE})
            </button>
          </div>
        )}

        {agentsOpen &&
          avatarPicker &&
          (() => {
            const r = draft.find((x) => x.id === avatarPicker)
            if (!r) return null
            const taken = takenAvatars(r.id)
            const current = effectiveAvatar(r)
            return (
              <div className="drawer right">
                <div className="drawer-head">
                  <b>🧍 Personaje de {r.name}</b>
                  <button onClick={() => setAvatarPicker(null)}>✕</button>
                </div>
                <div className="avatar-grid">
                  {AVATARS.map((a) => {
                    const isTaken = taken.has(a)
                    const sel = current === a
                    return (
                      <div
                        key={a}
                        className={`avatar-card${sel ? ' sel' : ''}${isTaken ? ' taken' : ''}`}
                        onClick={() => !isTaken && pickAvatar(r.id, a)}
                        title={isTaken ? 'En uso por otro miembro' : avatarLabel(a)}
                      >
                        <AvatarThumb file={a} />
                        <div className="avatar-name">
                          {avatarLabel(a)}
                          {isTaken ? ' 🔒' : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

        {diffView && (
          <div className="drawer diff-drawer">
            <div className="drawer-head">
              <b>🔀 Cambios en {project?.split('/').pop() || 'el proyecto'}</b>
              <button onClick={() => setDiffView(null)}>✕</button>
            </div>
            {diffView.loading && <div className="hist-empty">Leyendo el diff…</div>}
            {diffView.error && <div className="hist-empty">⚠️ {diffView.error}</div>}
            {diffView.diff !== undefined && !diffView.diff && !diffView.untracked?.length && (
              <div className="hist-empty">Sin cambios pendientes en el repo (¿ya fueron commiteados?)</div>
            )}
            {diffView.untracked?.length > 0 && (
              <div className="diff-untracked">📄 Nuevos sin trackear: {diffView.untracked.join(' · ')}</div>
            )}
            {diffView.diff && (
              <pre className="diff-pre">
                {diffView.diff.split('\n').map((l, i) => (
                  <div key={i} className={diffLineClass(l)}>
                    {l || ' '}
                  </div>
                ))}
              </pre>
            )}
          </div>
        )}

        {artsOpen && (
          <div className="drawer">
            <div className="drawer-head">
              <b>📄 Documentos</b>
              <button onClick={() => setArtsOpen(false)}>✕</button>
            </div>
            {artsList.length === 0 && <div className="hist-empty">Aún no hay documentos · pídele uno a un agente</div>}
            {artsList.map((a) => (
              <div key={a.path} className="hist-item art-item">
                <div onClick={() => window.oficina?.artifacts?.open?.(a.path)} style={{ cursor: 'pointer' }}>
                  <div className="hist-title">🔗 {prettyArtifact(a.name)}</div>
                  <div className="hist-meta">
                    {a.at ? new Date(a.at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </div>
                <div className="art-actions">
                  <button
                    onClick={() => {
                      setRefs((r) => (r.some((x) => x.path === a.path) ? r : [...r, { path: a.path, name: a.name, isDir: false }]))
                      setArtsOpen(false)
                      showToast('💬 Documento en contexto — escribe qué hacer con él')
                      inputRef.current?.focus()
                    }}
                    title="Usar como contexto del próximo mensaje (el agente lo lee)"
                  >
                    💬
                  </button>
                  <button onClick={() => window.oficina?.artifacts?.reveal?.(a.path)} title="Revelar en Finder">📂</button>
                  <button
                    onClick={async () => {
                      const r = await window.oficina?.artifacts?.zip?.(a.path)
                      showToast(r?.ok ? '📦 Zip exportado' : '⚠️ Exportación cancelada')
                    }}
                    title="Exportar como .zip (con imágenes) para compartir"
                  >
                    📦
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {histOpen && (
          <div className="drawer">
            <div className="drawer-head">
              <b>Historial</b>
              <button onClick={() => setHistOpen(false)}>✕</button>
            </div>
            {histList.length > 0 && (
              <input
                className="hist-search"
                placeholder="🔍 Buscar por título o proyecto…"
                value={histQuery}
                onChange={(e) => setHistQuery(e.target.value)}
                autoFocus
              />
            )}
            {histFiltered.length === 0 && (
              <div className="hist-empty">{histList.length ? 'Sin resultados para esa búsqueda' : 'Sin conversaciones guardadas'}</div>
            )}
            {histFiltered.map((h) => (
              <div key={h.id} className="hist-item" onClick={() => renaming?.id !== h.id && loadConvo(h.id)}>
                {renaming?.id === h.id ? (
                  <input
                    className="hist-rename"
                    value={renaming.val}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ id: h.id, val: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <div className="hist-title">
                    {h.pinned && '📌 '}
                    {h.title}
                  </div>
                )}
                {histContent[h.id] && <div className="hist-meta hist-excerpt">🔎 {histContent[h.id]}</div>}
                <div className="hist-meta">
                  {h.profile === 'work' ? '💼' : '🔒'} {h.project?.split('/').pop()} · {h.count} msgs ·{' '}
                  {h.updatedAt
                    ? new Date(h.updatedAt).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : ''}
                </div>
                <button
                  className="hist-export hist-ren"
                  title="Renombrar"
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenaming({ id: h.id, val: h.title || '' })
                  }}
                >
                  ✏️
                </button>
                <button
                  className="hist-export hist-pin"
                  title={h.pinned ? 'Desfijar' : 'Fijar (no se purga)'}
                  style={h.pinned ? { opacity: 0.8 } : undefined}
                  onClick={(e) => togglePin(e, h)}
                >
                  📌
                </button>
                <button className="hist-export" title="Exportar a Markdown" onClick={(e) => exportConvo(e, h.id)}>
                  ⬇
                </button>
                <button className="hist-del" title="Borrar" onClick={(e) => deleteConvo(e, h.id)}>
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}

        {toast && (
          <div className="toast" key={toast}>
            {toast}
          </div>
        )}

        {/* chips para detener a quien esté trabajando */}
        {running.filter((r) => roleStates[r] !== 'delivering').length > 0 && (
          <div className="stopbar">
            {running
              .filter((r) => roleStates[r] !== 'delivering')
              .map((r) => (
                <button key={r} className="stopchip" onClick={() => window.oficina?.stop?.(r)} title={`Detener a ${memberOf(r).name}`}>
                  ⏹ {memberOf(r).name}
                  {elapsed[r] ? ` · ${elapsed[r]}` : ''}
                </button>
              ))}
          </div>
        )}

        {doneChip && (
          <div className="toolchip" key={doneChip}>
            {doneChip}
          </div>
        )}

        {messages.length > 0 && (
          <div className="chat" ref={logRef} onScroll={onLogScroll} onMouseUp={onChatMouseUp}>
            {findOpen && (
              <div className="find-bar">
                <input
                  ref={findInputRef}
                  placeholder="Buscar en la conversación…"
                  value={findQuery}
                  onChange={(e) => {
                    setFindQuery(e.target.value)
                    setFindIdx(0)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      gotoHit(e.shiftKey ? findIdx - 1 : findIdx + 1)
                    }
                  }}
                />
                <span className="find-count">{findQuery.trim() ? (findHits.length ? `${findIdx + 1}/${findHits.length}` : '0') : ''}</span>
                <button type="button" onClick={() => gotoHit(findIdx - 1)} title="Anterior (⇧Enter)">↑</button>
                <button type="button" onClick={() => gotoHit(findIdx + 1)} title="Siguiente (Enter)">↓</button>
                <button type="button" onClick={() => setFindOpen(false)} title="Cerrar (Esc)">✕</button>
              </div>
            )}
            {chatFilter && (
              <div className="chat-filter">
                Viendo solo a {memberOf(chatFilter).emoji} {memberOf(chatFilter).name}
                <button type="button" onClick={() => setChatFilter(null)}>✕ ver todo</button>
              </div>
            )}
            {(chatFilter ? messages.filter((m) => m.who === chatFilter || m.to === chatFilter) : messages).map((m) => {
              const i = messages.indexOf(m)
              // botones de respuesta rápida: solo en el último mensaje del asistente,
              // ya terminado, si detecto un menú de opciones y nadie está ocupado
              const isLastAssistant =
                m.role === 'assistant' && !m.streaming && i === messages.length - 1 && !busy
              const options = isLastAssistant ? extractOptions(m.text) : []
              return (
              <div
                key={i}
                data-mi={i}
                className={`msg ${m.role}${findOpen && findHits[findIdx] === i ? ' find-current' : findOpen && findHits.includes(i) ? ' find-hit' : ''}`}
              >
                {m.role === 'assistant' && m.who && (
                  <div
                    className="who whobtn"
                    style={{ color: memberOf(m.who).color }}
                    onClick={() => setChatFilter((f) => (f === m.who ? null : m.who))}
                    title={chatFilter === m.who ? 'Ver todo el chat' : `Ver solo la conversación de ${memberOf(m.who).name}`}
                  >
                    {memberOf(m.who).emoji} {memberOf(m.who).name}
                  </div>
                )}
                {m.role === 'user' && m.to && m.to !== principal && <div className="who to">→ {memberOf(m.to).name}</div>}
                {m.role === 'user' && m.queued && (
                  <div className="who to">
                    ⏳ En cola
                    <button type="button" className="queue-cancel" onClick={() => cancelQueued(m)} title="Quitar de la cola">
                      ✕
                    </button>
                  </div>
                )}
                {m.role === 'user' && m.cancelled && (
                  <div className="who to">
                    ⏹ Cancelado
                    <button
                      type="button"
                      className="queue-cancel"
                      title="Editar y reenviar"
                      onClick={() => {
                        setInput(m.text)
                        inputRef.current?.focus()
                        requestAnimationFrame(() => autoGrow(inputRef.current))
                      }}
                    >
                      ✏️ Editar
                    </button>
                  </div>
                )}
                {m.role === 'user' && m.atts?.length > 0 && (
                  <div className="msg-atts">
                    {m.atts.map((a, j) =>
                      typeof a === 'string' ? <span key={j}>🖼 {a}</span> : <AttThumb key={j} att={a} onZoom={setLightbox} />
                    )}
                  </div>
                )}
                {m.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                    {m.text}
                  </ReactMarkdown>
                ) : (
                  m.text
                )}
                {m.streaming ? '▍' : ''}
                {m.usage && (
                  <div className="msg-tokens" title={usageTitle(m.usage)}>
                    🪙 {fmtTokens(usageTotal(m.usage))} tokens
                  </div>
                )}
                {m.role === 'assistant' && !m.streaming && !m.error && (
                  <button
                    type="button"
                    className="msg-copy"
                    title="Copiar respuesta completa"
                    onClick={() => {
                      navigator.clipboard.writeText(m.text)
                      showToast('Respuesta copiada 📋')
                    }}
                  >
                    📋
                  </button>
                )}
                {m.role === 'user' && !m.queued && (
                  <button
                    type="button"
                    className="msg-copy msg-edit"
                    title="Editar y reenviar"
                    onClick={() => {
                      setInput(m.text)
                      const el = inputRef.current
                      if (el) {
                        el.focus()
                        requestAnimationFrame(() => autoGrow(el))
                      }
                    }}
                  >
                    ✏️
                  </button>
                )}
                {m.artifact && (
                  <button className="artifact-btn" onClick={() => window.oficina?.artifacts?.open?.(m.artifact.path)}>
                    🔗 Abrir · {prettyArtifact(m.artifact.name)}
                  </button>
                )}
                {m.edited && (
                  <button className="artifact-btn" onClick={openDiff}>
                    🔀 Ver cambios
                  </button>
                )}
                {m.role === 'system' && m.standupShare && (
                  <button className="artifact-btn" onClick={() => shareStandup(i)}>
                    📤 Compartir resumen a Slack
                  </button>
                )}
                {m.error && lastJobRef.current[m.who] && i === messages.findLastIndex((x) => x.who === m.who) && (
                  <button className="artifact-btn" onClick={() => retryJob(m.who)}>
                    🔁 Reintentar
                  </button>
                )}
                {options.length > 0 && (
                  <div className="quickreplies">
                    {options.map((opt, j) => (
                      <button key={j} onClick={() => quickReply(opt, m.who)} title={opt}>
                        {opt.length > 42 ? opt.slice(0, 40) + '…' : opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )
            })}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} title="Click o Esc para cerrar">
          <img src={lightbox} alt="" />
        </div>
      )}

      {introOpen && (
        <Intro
          onDone={() => {
            setIntroOpen(false)
            setIntroFade(true) // la oficina emerge del negro, no aparece de golpe
            setTimeout(() => setIntroFade(false), 1700) // hasta que el velo termine
          }}
        />
      )}
      {introFade && <div className="intro-veil" />}
      {quote && (
        <button type="button" className="quote-btn" style={{ left: quote.x, top: quote.y }} onClick={useQuote}>
          💬 Citar
        </button>
      )}
      {tourOpen && <Tour onDone={endTour} />}

      {(attachments.length > 0 || refs.length > 0) && (
        <div className="attachbar">
          {attachments.map((a, i) => (
            <span key={a.path} className="attachchip">
              <AttThumb att={a} onZoom={setLightbox} />
              <button type="button" onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
          {refs.map((r, i) => (
            <span key={r.path} className="attachchip">
              {r.isDir ? '📁' : '📄'} {r.name}
              <button type="button" onClick={() => setRefs((arr) => arr.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* plantilla con {{variables}}: pedir los valores antes de insertar */}
      {snipVars && (
        <div className="snip-pop">
          <div className="skills-note">La plantilla tiene variables — llénalas:</div>
          <div className="snip-form">
            {snipVars.vars.map((v, j) => (
              <input
                key={v}
                placeholder={v}
                autoFocus={j === 0}
                value={snipVars.vals[v] || ''}
                onChange={(e) => setSnipVars({ ...snipVars, vals: { ...snipVars.vals, [v]: e.target.value } })}
                onKeyDown={(e) => e.key === 'Enter' && insertSnipVars()}
              />
            ))}
            <div className="snip-form-row">
              <button type="button" onClick={() => setSnipVars(null)}>Cancelar</button>
              <button type="button" className="snip-save" onClick={insertSnipVars}>
                Insertar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* @nombres: escribir @ lista los agentes activos (y @todos) */}
      {atQuery !== null && atOptions.length > 0 && (
        <div className="snip-pop">
          {atOptions.map((o) => (
            <div key={o.name} className="snip-item" onClick={() => pickAt(o)}>
              <b>{o.emoji} @{o.name}</b>
              <span className="snip-preview">{o.label}</span>
            </div>
          ))}
        </div>
      )}
      {/* plantillas: escribir / en el composer las lista y filtra por nombre */}
      {snipOpen && !snipVars && (
        <div className="snip-pop">
          {snipMatches.map((s) => (
            <div key={s.id} className="snip-item" onClick={() => pickSnippet(s)} title={s.text}>
              <b>/{s.name}</b>
              <span className="snip-preview">{s.text.length > 64 ? s.text.slice(0, 62) + '…' : s.text}</span>
              <button
                type="button"
                className="snip-del"
                title="Borrar plantilla"
                onClick={(e) => {
                  e.stopPropagation()
                  saveSnippets(snippets.filter((x) => x.id !== s.id))
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {!snipMatches.length && (
            <div className="snip-empty">{snippets.length ? 'Ninguna plantilla con ese nombre' : 'Aún no tienes plantillas'}</div>
          )}
          {snipForm ? (
            <div className="snip-form">
              <input
                placeholder="Nombre (ej: revisar-pr)"
                value={snipForm.name}
                onChange={(e) => setSnipForm({ ...snipForm, name: e.target.value })}
                autoFocus
              />
              <textarea
                placeholder={'Texto de la plantilla… (admite {{variables}}: «revisa el PR {{numero}} de {{repo}}»)'}
                rows={3}
                value={snipForm.text}
                onChange={(e) => setSnipForm({ ...snipForm, text: e.target.value })}
              />
              <div className="snip-form-row">
                <button type="button" onClick={() => setSnipForm(null)}>Cancelar</button>
                <button
                  type="button"
                  className="snip-save"
                  disabled={!snipForm.name.trim() || !snipForm.text.trim()}
                  onClick={() => {
                    const name = snipForm.name.trim().replace(/^\//, '').replace(/\s+/g, '-').toLowerCase()
                    saveSnippets([...snippets.filter((x) => x.name !== name), { id: crypto.randomUUID(), name, text: snipForm.text.trim() }])
                    setSnipForm(null)
                    showToast(`Plantilla /${name} guardada 📌`)
                  }}
                >
                  Guardar
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="snip-new" onClick={() => setSnipForm({ name: snipQuery || '', text: '' })}>
              ➕ Nueva plantilla
            </button>
          )}
        </div>
      )}
      <form className="composer" onSubmit={send}>
        {/* el permiso a la vista: edición (auto-acepta cambios) vs solo lectura */}
        <button
          type="button"
          className={writeMode ? 'perm-chip write' : 'perm-chip read'}
          onClick={() => setWritePermission(!writeMode)}
          disabled={busy}
          title={
            writeMode
              ? 'Modo edición: los agentes pueden modificar archivos y correr comandos (auto-aceptado). Clic para pasar a solo lectura.'
              : 'Modo lectura: los agentes solo investigan. Clic para permitir edición.'
          }
        >
          {writeMode ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          )}
        </button>
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          onPaste={handlePaste}
          onChange={(e) => {
            setInput(e.target.value)
            autoGrow(e.target)
          }}
          onKeyDown={(e) => {
            // con el popover de @nombres abierto, Enter/Tab toma el primero
            if (atQuery !== null && atOptions.length > 0 && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
              e.preventDefault()
              pickAt(atOptions[0])
              return
            }
            // con el popover de plantillas abierto, Enter/Tab toma la primera
            if (snipOpen && !snipVars && snipMatches.length > 0 && !snipForm && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
              e.preventDefault()
              pickSnippet(snipMatches[0])
              return
            }
            // Enter envía; Shift+Enter inserta salto de línea
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.target.form?.requestSubmit()
            }
          }}
          placeholder={
            busy
              ? `${running.map((r) => memberOf(r).name).join(', ')} trabajando… (puedes pedirle algo a otro)`
              : squad.length > 1
                ? `Escríbele al squad… (ej: "${memberOf(squad[1]?.id).name}, ayúdame con…" · ⌘1-${squad.length})`
                : 'Escríbele a tu asistente…'
          }
          autoFocus
        />
        <button type="submit">Enviar</button>
      </form>
    </div>
  )
}

