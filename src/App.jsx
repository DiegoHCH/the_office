import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { THEMES } from './Office.jsx'
// la escena y la intro son lo más pesado del bundle: van en diferido (#105)
const Office = lazy(() => import('./Office.jsx'))
import { popSound, dingSound, buzzSound, setSoundEnabled } from './sound.js'
import { NONHUMAN_AVATARS } from './scene/avatarThumbs.js'
import {
  fmtReset, autoGrow, fmtElapsed, fmtTokens, usageTotal, usageTitle, norm, escRe, extractOptions,
  MODEL_OPTIONS, MODEL_ALIASES, FALLBACK_MODEL, EFFORTS, modelLabelOf, contextoUsado, nivelTraspaso,
} from './lib/helpers.js'
import { ROLE_META, metaOf, MAX_ACTIVE, canDelete, AVATARS, prettyArtifact, avatarLabel, SQUAD_PRESETS } from './data/roles.js'
import { routeMessage, detectHandoff } from './lib/routing.js'
import { t, plural, locale, getLang, setLang, langName, LANGS } from './lib/i18n.js'
import { prefKey, leerPref } from './lib/prefs.js'
import { claveDia } from './lib/estadisticas.js'
import { estadoInicial, abrir as abreOrq, cerrar as cierraOrq, subsDe } from './lib/subagentes.js'
import { paraElPanel } from './lib/historial.js'
import { decideDespacho, pideReparto, quienColisiona } from './lib/despacho.js'
import { registra, resumen as resumenActividad } from './lib/actividad.js'
import { SKILL_CATALOG, ROLE_TAGS, MCP_CATALOG, toolInfo, seedSnippets, PETS } from './data/catalogs.js'
import { MD_COMPONENTS, configuraTerminal } from './components/markdown.jsx'
import SysMonitor from './components/SysMonitor.jsx'
import Tour from './components/Tour.jsx'
const Intro = lazy(() => import('./scene/Intro.jsx'))
import { AvatarThumb, AttThumb } from './components/thumbs.jsx'
import StatsPanel from './panels/StatsPanel.jsx'
import ActividadPanel from './panels/ActividadPanel.jsx'
import DiagPanel from './panels/DiagPanel.jsx'
import {
  IconAgents, IconBook, IconSkills, IconMcp, IconStats, IconDiag, IconTour,
  IconTerminal, IconExport, IconImport, IconTune, IconChevron,
  IconWork, IconPrivate, IconPerson, IconFolder, IconPin, IconAdd,
  IconClose, IconMinimize, IconBranch, IconTrash, IconRefresh, IconReveal, IconZip, IconDownload, IconEdit, IconPerson3D,
  IconCheck, IconWarn, IconSpinner, IconClip, IconBulb, IconLink, IconSearchSmall, IconArrowUp, IconArrowDown, IconFile, IconImage,
  IconCopy, IconRetry, IconShare, IconDiff, IconChat, IconBoard, IconBell, IconBellOff, IconRestore, IconClock,
  IconBolt, IconRestartApp, IconStopSquare, IconPlay,
} from './components/icons.jsx'

const standupPrompt = () => t('prompt.standup')

export default function App() {
  const [messages, setMessages] = useState([])
  const [convTokens, setConvTokens] = useState({ in: 0, out: 0, cache: 0 })
  const [ctxUsado, setCtxUsado] = useState(0) // tokens enviados en el último turno (#123) // tokens de la conversación
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
  const editedPathsRef = useRef([]) // rutas tocadas en la conversación → en qué repos pedir el diff
  const ultimoRef = useRef(null) // último rol que respondió → afinidad de los seguimientos
  const turnoPathsRef = useRef({}) // role → rutas tocadas EN ESTE turno (para decidir la recarga)
  const autoTimerRef = useRef(null)
  const hubotextoRef = useRef({}) // role → true si el turno llegó a decir algo
  const [copyView, setCopyView] = useState(null) // { desde, partes, resumen } — copiar entre perfiles
  const [diffView, setDiffView] = useState(null) // null | { loading } | { diff, untracked, error }
  const [devicesView, setDevicesView] = useState(null) // null | { loading } | { devices, emulators, error }
  const [flutterProj, setFlutterProj] = useState(null) // { esFlutter, proyecto, proyectos } del proyecto activo
  const [targets, setTargets] = useState(null) // último listado conocido, precargado al elegir proyecto
  const [npmProj, setNpmProj] = useState(null) // { esNpm, proyecto, scripts, gestor } — web/escritorio
  const [makeProj, setMakeProj] = useState(null) // { esMake, grupos, total } — targets del Makefile
  const [makeAbierto, setMakeAbierto] = useState({}) // módulos desplegados
  // las apps corriendo: deviceId → { fase, device, appId, progreso, url, error }
  // `flutter run --machine` no admite -d all, así que es un proceso por
  // dispositivo y las acciones de la barra van a todas salvo que se enfoque una.
  const [runs, setRuns] = useState({})
  const [foco, setFoco] = useState(null) // deviceId enfocado, null = todas
  const [autoReload, setAutoReload] = useState(false)
  const [config, setConfig] = useState('') // configuración de .vscode/launch.json elegida
  const [runLogs, setRunLogs] = useState([])
  const [verLogs, setVerLogs] = useState(false)
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
    showToast(v ? t('toast.introOn') : t('toast.introOff'))
  }

  // Tour de bienvenida: espera a que la intro termine (si no, se dispara
  // debajo de ella y salta encima justo al acabar) y se marca como visto al
  // MOSTRARLO, no al completarlo — así no reaparece si cierras la app antes.
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    if (introOpen) return // la intro manda; el tour espera su turno
    if (localStorage.getItem('oficina-tour-done')) return
    const timer = setTimeout(() => {
      setTourOpen(true)
      try {
        localStorage.setItem('oficina-tour-done', '1')
      } catch {}
    }, 1200)
    return () => clearTimeout(timer)
  }, [introOpen])
  const endTour = () => {
    try {
      localStorage.setItem('oficina-tour-done', '1')
    } catch {}
    setTourOpen(false)
  }
  const [status, setStatus] = useState(t('status.waiting'))
  const [roleStates, setRoleStates] = useState({})
  const [tool, setTool] = useState(null)
  const [input, setInput] = useState('')
  const [cfg, setCfg] = useState(null)
  const [profile, setProfile] = useState('work')
  // Alto real del monitor, para colocar los chips justo debajo sin acoplarlos a
  // su contenedor. Va con ref de callback y no con useRef: el monitor devuelve
  // null mientras carga sus datos, así que al montar todavía no existe y un
  // efecto con [] nunca lo llegaba a medir — los chips acababan en top: 24,
  // encima del monitor.
  const [monNodo, setMonNodo] = useState(null)
  const [monAlto, setMonAlto] = useState(0)
  useEffect(() => {
    if (!monNodo) return
    const mide = () => setMonAlto(monNodo.getBoundingClientRect().height)
    mide()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(mide)
    ro.observe(monNodo)
    return () => ro.disconnect()
  }, [monNodo])

  // Y el alto de los chips de «trabajando», por el mismo motivo: las pestañas
  // van debajo de los dos, y los chips aparecen y desaparecen según haya
  // agentes trabajando. Encadenar la medida evita que se pisen.
  const [chipsNodo, setChipsNodo] = useState(null)
  const [chipsAlto, setChipsAlto] = useState(0)
  useEffect(() => {
    if (!chipsNodo) return setChipsAlto(0)
    const mide = () => setChipsAlto(chipsNodo.getBoundingClientRect().height + 10)
    mide()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(mide)
    ro.observe(chipsNodo)
    return () => ro.disconnect()
  }, [chipsNodo])

  // Qué pestaña lanzó cada trabajo: sin esto, la respuesta de un agente que
  // sigue trabajando aterrizaría en la pestaña que estés mirando, no en la suya.
  const tabDeRolRef = useRef({}) // role → tabId
  const activeTabRef = useRef(null)

  // Aplica un cambio de mensajes a la pestaña DUEÑA del trabajo: a la lista viva
  // si es la que se está mirando, o a su snapshot si es otra.
  const enTab = (role, fn) => {
    const suya = tabDeRolRef.current[role]
    if (!suya || suya === activeTabRef.current) {
      if (chatMinRef.current) setChatMinNuevo(true) // aparcada: avisa de que hay algo dentro
      return setMessages(fn)
    }
    const st = tabStateRef.current[suya]
    if (st) st.messages = fn(st.messages || [])
  }

  // Igual que enTab pero con la pestaña ya resuelta: los subagentes no tienen
  // rol propio —el personaje es prestado— así que se enrutan por su pestaña.
  const enTabId = (tabId, fn) => {
    if (!tabId || tabId === activeTabRef.current) {
      if (chatMinRef.current) setChatMinNuevo(true)
      return setMessages(fn)
    }
    const st = tabStateRef.current[tabId]
    if (st) st.messages = fn(st.messages || [])
  }
  // El rastro de actividad sigue la MISMA regla que los mensajes: va a la
  // pestaña del paso, no a la que estés mirando. Se escribe aparte de
  // `enTabId` porque la activa vive en un ref y no en el estado.
  // Quién trabaja para la pestaña que estás mirando. Un subagente vive en la
  // pestaña de su asiento, no en el mapa de roles despachados — el mismo detalle
  // que hacía que en la pestaña de una apareciera otro trabajando dentro.
  const tabDeAgente = (rol) => {
    const asiento = Object.values(orqRef.current.subs || {}).find((x) => x?.rol === rol)
    return asiento?.tabId || tabDeRolRef.current[rol] || activeTab
  }

  const actividadEnTab = (tabId, paso) => {
    if (!tabId || tabId === activeTabRef.current) {
      actividadRef.current = registra(actividadRef.current, paso)
      return true // hay que reflejarlo si el panel está abierto
    }
    const st = tabStateRef.current[tabId]
    if (st) st.actividad = registra(st.actividad || [], paso)
    return false
  }
  // subId → { rol prestado (o null), pestaña, encargo }. Vive en un ref porque
  // lo leen los manejadores del stream, que no se re-crean por render.
  // Toda la orquestación (quién tiene qué silla, quién espera, quién es invitado)
  // vive en lib/subagentes.js, que es puro y está probado. Aquí solo se guarda
  // su estado y se aplican los efectos que decide.
  const orqRef = useRef(estadoInicial())
  // Título y madre de cada pestaña de subagente. Separado del estado de la
  // orquestación porque esa
  // entrada se borra al terminar, y el historial se sigue guardando después.
  const subMetaRef = useRef({}) // tabId → { title, parentId }
  // Pico de contexto de cada compañero, para poder decir cuánto se trabajó fuera
  // del hilo. Se acumula por turno y se vacía al empezar el siguiente.
  const picoSubRef = useRef({})

  // Abre el sitio de un subagente: su pestaña, su puesto y sus metadatos. Se
  // llama al verlo arrancar y TAMBIÉN al recibir trabajo suyo del que no había
  // constancia — la herramienta de delegación se llama `Agent` en unas sesiones
  // y `Task` en otras, y si el arranque no se reconoce, su trabajo acabaría en
  // la pestaña del principal sin que nada lo delate.
  // Los avisos de los compañeros se juntan en una ventana corta. Cinco avisos
  // seguidos son peores que uno: se ignoran los cinco. Y el caso que más se da
  // es justo ese, porque al cerrarse el turno se cierran de golpe los que
  // quedaran vivos. La ventana es de 4s: retrasar el aviso no cuesta nada
  // —dice «ya puedes leer», no «corre»— y agrupa a los que acaban casi a la vez.
  const avisosSubRef = useRef({ cola: [], timer: null })
  const avisaFinDeSub = (nombre, encargo, fallo) => {
    const b = avisosSubRef.current
    b.cola.push({ nombre, encargo, fallo })
    clearTimeout(b.timer)
    b.timer = setTimeout(() => {
      const lote = b.cola
      b.cola = []
      if (lote.length === 1) {
        const u = lote[0]
        return window.oficina?.notifyCustom?.(`${u.nombre} ${u.fallo ? t('sub.failedShort') : t('sub.doneShort')}`, u.encargo)
      }
      const fallos = lote.filter((x) => x.fallo).length
      window.oficina?.notifyCustom?.(
        t('sub.doneMany', { n: lote.length }),
        lote.map((x) => x.nombre).join(', ') + (fallos ? ` · ${t('sub.someFailed', { n: fallos })}` : '')
      )
    }, 4000)
  }

  // Cierra un subagente: su línea final, su aviso, su guardado y la silla que
  // devuelve. Se llama al recibir su cierre y TAMBIÉN al terminar el turno del
  // que lo lanzó — un subagente no puede sobrevivir a su jefe, y si su cierre no
  // llega se quedaba trabajando para siempre en la escena.
  const cierraSub = (subId, isError) => {
        const r = cierraOrq(orqRef.current, subId)
        const fin = r.cerrado
        if (!fin) return
        orqRef.current = r.estado
        setTabs((prev) => prev.map((x) => (x.id === fin.tabId ? { ...x, done: true } : x)))
        // Una línea de cierre en SU pestaña: atenuarla no basta, porque un
        // subagente que acabó con un mensaje corto se ve igual que uno que
        // sigue trabajando. Y si acabó mal, aquí es donde se ve — el principal
        // solo recibe su resultado, no necesariamente el motivo del fallo.
        const cierre = { role: 'system', text: isError ? t('sub.failed') : t('sub.done') }
        // Un aviso por subagente, con el nombre del personaje que lo hizo: son
        // trabajos separados y cada uno deja su pestaña lista para leer. El del
        // principal sigue saliendo aparte, al cerrar el turno con su resumen.
        avisaFinDeSub(memberOf(fin.rol).name || t('sub.working'), subMetaRef.current[fin.tabId]?.title || fin.desc || '', isError)
        // Guardar en el historial aquí y no por el autosave: ese solo mira la
        // pestaña activa, y la que miras es la del principal. Se lee por el
        // updater cuando la pestaña es la activa, porque `messages` del closure
        // puede venir de un render anterior.
        const guarda = (ms) => {
          window.oficina?.history?.save({
            id: `sub-${subId}`,
            title: subMetaRef.current[fin.tabId]?.title || fin.desc || t('sub.working'),
            // de quién es hija: en el historial se ven anidadas bajo la
            // conversación que las repartió, que es donde tienen sentido
            parentId: subMetaRef.current[fin.tabId]?.parentId || null,
            profile,
            project,
            model,
            sessions: {},
            updatedAt: Date.now(),
            messages: ms.map((m) => ({ role: m.role, text: m.text, who: m.who, usage: m.usage, dur: m.dur })),
          })
        }
        if (fin.tabId === activeTabRef.current) {
          setMessages((ms) => {
            const con = [...ms, cierre]
            guarda(con)
            return con
          })
        } else {
          const st = tabStateRef.current[fin.tabId]
          if (st) {
            st.messages = [...(st.messages || []), cierre]
            guarda(st.messages)
          }
        }
        // el módulo ya decidió quién se levanta, quién hereda y quién se va
        if (r.libera) setRS(r.libera, 'idle')
        if (r.hereda) setRS(r.hereda.rol, 'working')
        if (r.seVa) setInvitados((prev) => prev.filter((x) => x !== r.seVa))
  }

  const abreSub = (subId, desc, role) => {
    const r = abreOrq(orqRef.current, {
      subId,
      desc,
      jefe: role,
      squad: squadRef.current.map((m) => m.id),
      roster: rosterRef.current,
      trabajando: runningRef.current,
    })
    if (!r.nuevo) return r.sub
    orqRef.current = r.estado

    const { tabId } = r.sub
    const titulo = (desc || t('sub.working')).slice(0, 38)
    // convId propio desde que nace: el autosave del historial solo guarda la
    // pestaña ACTIVA y solo si tiene id, y tú estás mirando la del principal.
    tabStateRef.current[tabId] = { messages: [], project, convId: tabId, sessions: {}, queues: {}, editedPaths: [], ultimo: null, tokens: { in: 0, out: 0, cache: 0 } }
    // `fijo`: su título es el encargo y no debe seguir a la conversación. El
    // autotítulo usa el primer mensaje del USUARIO, y aquí no hay ninguno.
    setTabs((prev) => (prev.some((x) => x.id === tabId) ? prev : [...prev, { id: tabId, title: titulo, sub: true, fijo: true }]))
    // La madre es la conversación del que reparte, no «la que estés mirando»:
    // si abres la pestaña del subagente, convIdRef pasa a ser la suya.
    const tabDelJefe = tabDeRolRef.current[role]
    const parentId =
      !tabDelJefe || tabDelJefe === activeTabRef.current ? convIdRef.current : tabStateRef.current[tabDelJefe]?.convId || null
    subMetaRef.current[tabId] = { title: titulo, parentId }
    diagRef.current.push({ t: Date.now(), role: role || '—', kind: 'sub-asigna', info: r.porQue })
    if (r.entraEnEscena) setInvitados((prev) => (prev.includes(r.entraEnEscena) ? prev : [...prev, r.entraEnEscena]))
    if (r.sub.rol) setRS(r.sub.rol, 'working')
    return r.sub
  }


  const profileRef = useRef(profile)
  useEffect(() => {
    profileRef.current = profile
    try {
      if (profile) localStorage.setItem('oficina-profile', profile)
    } catch {}
  }, [profile])
  const [project, setProject] = useState('')
  const [writeMode, setWriteMode] = useState(true)
  const [model, setModel] = useState(FALLBACK_MODEL)
  const [effort, setEffort] = useState('') // '' = el default del CLI
  const [histOpen, setHistOpen] = useState(false)
  const [histList, setHistList] = useState([])
  const [histQuery, setHistQuery] = useState('') // filtro del panel de historial
  const [chatFilter, setChatFilter] = useState(null) // ver solo la conversación de un agente
  const [artsOpen, setArtsOpen] = useState(false)
  const [artsList, setArtsList] = useState([])
  const [artsDir, setArtsDir] = useState('')
  const [sound, setSound] = useState(() => localStorage.getItem('oficina-sound') !== '0')
  // Separado del sonido: iban juntos en el mismo interruptor, así que apagar el
  // «ding» —que en un turno largo cansa— apagaba también los avisos del sistema,
  // que es justo lo que sirve cuando el turno es largo.
  const [notif, setNotif] = useState(() => localStorage.getItem('oficina-notif') !== '0')
  const [theme, setTheme] = useState('clasico') // se carga por perfil al iniciar/cambiar
  const themeLoaded = useRef(false) // evita machacar el guardado antes de hidratar
  // Tema "auto": 🌙 Noche de 19:00 a 07:00, Clásico de día. Un tick por minuto
  // re-evalúa la hora solo mientras el modo auto está elegido.
  const [, setThemeTick] = useState(0)
  useEffect(() => {
    if (theme !== 'auto') return
    const iv = setInterval(() => setThemeTick((n) => n + 1), 60_000)
    return () => clearInterval(iv)
  }, [theme])
  const hourNow = new Date().getHours()
  const effectiveTheme = theme === 'auto' ? (hourNow >= 19 || hourNow < 7 ? 'noche' : 'clasico') : theme
  const [board, setBoard] = useState(() => localStorage.getItem('oficina-board') !== '0')
  // Apariencia del chrome (#119): auto sigue al sistema. Es preferencia del
  // equipo, no del perfil — no se cambia al saltar entre work y private.
  const [appearance, setAppearance] = useState(() => localStorage.getItem('oficina-appearance') || 'auto')
  useEffect(() => {
    localStorage.setItem('oficina-appearance', appearance)
    // sin data-theme manda el @media; con él, la elección del usuario
    if (appearance === 'auto') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = appearance
  }, [appearance])
  // Idioma de la interfaz (#103): arranca en el del sistema. Cambiarlo repinta
  // todo (el diccionario es un módulo, así que basta con forzar el re-render).
  const [lang, setLangState] = useState(getLang)
  const changeLang = (l) => {
    setLang(l)
    setLangState(l)
    window.oficina?.setLang?.(langName())
    showToast(t('toast.langChanged'))
  }
  const [roster, setRoster] = useState([]) // config completa (6 roles)
  // Personajes que un subagente tiene prestados. Pueden ser miembros INACTIVOS
  // del roster: si el squad solo tiene al principal, no habría a quién prestarle
  // silla y el trabajo de los subagentes se vería todo encima del principal.
  // Entran en escena mientras dura el encargo y se van al terminar.
  const [invitados, setInvitados] = useState([])
  const [agentsOpen, setAgentsOpen] = useState(false) // panel 👥 Agentes (squad)
  const [skillsOpen, setSkillsOpen] = useState(false) // panel 🧩 Skills (catálogo por perfil)
  const [mcpOpen, setMcpOpen] = useState(false) // panel 🌐 MCP (servidores por perfil)
  const [hasClaudeMd, setHasClaudeMd] = useState(false)
  const [prefsPanelOpen, setPrefsPanelOpen] = useState(false) // submenu 🎛 Preferencias
  const [statsOpen, setStatsOpen] = useState(false) // panel 📈 Estadísticas
  const [statsData, setStatsData] = useState({})
  const [diagOpen, setDiagOpen] = useState(false) // panel 🔧 Diagnóstico
  // Lo que va haciendo el agente por detrás. En un ref porque llega en ráfagas
  // —varias herramientas por segundo— y re-renderizar en cada una tiraría los
  // fps de la escena; el estado espejo solo se actualiza con el panel abierto.
  const actividadRef = useRef([])
  const [actividad, setActividad] = useState([])
  const [actOpen, setActOpen] = useState(false)
  // Versión descargada y esperando a que la apliques. Va dentro de la app y no
  // solo en una notificación del sistema: si el clic en la notificación no
  // llega, la actualización se quedaba descargada sin forma de aplicarla.
  const [updateLista, setUpdateLista] = useState('')
  const [diagRows, setDiagRows] = useState([])
  const diagRef = useRef([]) // ring buffer de eventos del stream (máx 500)
  const [installedSkills, setInstalledSkills] = useState(null) // null = leyendo
  const [skillBusy, setSkillBusy] = useState(null) // id de la skill en proceso
  const [prefsOpen, setPrefsOpen] = useState(false) // panel ⚙️ Configuración
  const [ctxOpen, setCtxOpen] = useState(false) // dropdown de perfil + proyecto
  // Raíces plegadas en el selector. Se recuerda: con varios workspaces, tener
  // que plegar los mismos en cada arranque cansa enseguida.
  const [plegados, setPlegados] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('oficina-plegados') || '[]'))
    } catch {
      return new Set()
    }
  })
  const alternaPlegado = (ruta) => {
    setPlegados((prev) => {
      const s = new Set(prev)
      if (s.has(ruta)) s.delete(ruta)
      else s.add(ruta)
      try {
        localStorage.setItem('oficina-plegados', JSON.stringify([...s]))
      } catch {}
      return s
    })
  }
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
  const pendingArtifactRef = useRef({})
  const pendingThinkingRef = useRef({}) // razonamiento en curso por agente (#122) // role → true si generó un artifact en este turno
  const toastTimer = useRef(null)
  const sessionsRef = useRef({})
  const convIdRef = useRef(null)
  const logRef = useRef(null)
  const inputRef = useRef(null)

  // squad activo (máx MAX_ACTIVE) con su meta visual; el primero es el principal
  const squad = useMemo(
    () =>
      // Los activos primero y los invitados detrás, nunca al revés: squad[0] es
      // el principal y un invitado colándose delante se lo llevaría por delante.
      [...roster.filter((r) => r.enabled), ...roster.filter((r) => !r.enabled && invitados.includes(r.id))]
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
    // lang: las etiquetas de rol vienen del diccionario, hay que rehacerlas
    [roster, lang, invitados]
  )
  // Para RUTEAR solo cuentan los activos de verdad: un invitado presta su
  // personaje a un subagente, no es alguien a quien puedas encargarle algo.
  const squadRuteable = useMemo(() => squad.filter((m) => !invitados.includes(m.id)), [squad, invitados])
  const principal = squad[0]?.id || 'dev'
  const principalRef = useRef(principal)
  const squadRef = useRef(squad)
  // el roster COMPLETO, para poder sacar suplentes inactivos cuando un subagente
  // necesita personaje y el squad activo no da para más
  const rosterRef = useRef(roster)
  useEffect(() => {
    principalRef.current = principal
    squadRef.current = squad
    rosterRef.current = roster
  }, [principal, squad, roster])
  const memberOf = (id) => {
    const enEscena = squad.find((m) => m.id === id)
    if (enEscena) return enEscena
    // Un subagente puede haber tomado prestado el personaje de un miembro
    // INACTIVO: al terminar se va de la escena, pero sus mensajes siguen en su
    // pestaña y no pueden quedarse con el id del rol como nombre («research»).
    const enRoster = roster.find((r) => r.id === id)
    if (enRoster) return { id, ...metaOf(enRoster), name: enRoster.name }
    return { name: id, emoji: '🤖', color: '#93a6a1', label: id }
  }
  // modelo efectivo de un agente: el suyo propio si lo fijó, si no el global
  const memberModel = (id) => squad.find((m) => m.id === id)?.model || model
  // Mismo criterio para el esfuerzo: el del rol si lo fijó, y si no el global.
  // Un QA que solo corre tests no necesita el mismo que quien implementa.
  const memberEffort = (id) => squad.find((m) => m.id === id)?.effort || effort

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
    const iv = setInterval(() => setClockTick((n) => n + 1), 1000)
    return () => clearInterval(iv)
  }, [running.length])

  // role → "2m 15s"; solo a partir del minuto (antes sería ruido)
  const elapsed = {}
  for (const r of running) {
    const ms = startedAtRef.current[r] ? Date.now() - startedAtRef.current[r] : 0
    if (ms >= 60_000) elapsed[r] = fmtElapsed(ms)
  }

  useEffect(() => {
    setSoundEnabled(sound)
    localStorage.setItem('oficina-sound', sound ? '1' : '0')
  }, [sound])
  useEffect(() => {
    localStorage.setItem('oficina-notif', notif ? '1' : '0')
    window.oficina?.setNotify?.(notif)
  }, [notif])

  // el tema se guarda POR PERFIL (cada cuenta puede tener el suyo), solo tras hidratar
  useEffect(() => {
    if (!themeLoaded.current) return
    localStorage.setItem(`oficina-theme-${profile}`, theme)
  }, [theme, profile])

  // Modelo y permiso se guardan POR PROYECTO (#124): un repo de cliente puede
  // quedarse en solo-lectura mientras el propio sigue en edición. Un proyecto
  // sin valor propio hereda el del perfil, que es también lo último elegido.
  useEffect(() => {
    if (!themeLoaded.current) return
    localStorage.setItem(prefKey('oficina-model', profile), model) // default del perfil
    if (project) localStorage.setItem(prefKey('oficina-model', profile, project), model)
  }, [model, profile, project])
  useEffect(() => {
    if (!themeLoaded.current) return
    const v = writeMode ? '1' : '0'
    localStorage.setItem(prefKey('oficina-write', profile), v)
    if (project) localStorage.setItem(prefKey('oficina-write', profile, project), v)
  }, [writeMode, profile, project])
  // El esfuerzo va con la misma herencia: un repo que solo se consulta no
  // necesita el mismo que uno donde se implementa.
  useEffect(() => {
    if (!themeLoaded.current) return
    localStorage.setItem(prefKey('oficina-effort', profile), effort)
    if (project) localStorage.setItem(prefKey('oficina-effort', profile, project), effort)
  }, [effort, profile, project])
  // calidad gráfica (glow-up #111) y mascota 🦊, por perfil
  const [quality, setQuality] = useState('normal')
  const saveQuality = (v) => {
    setQuality(v)
    localStorage.setItem(`oficina-quality-${profile}`, v)
    showToast(v === 'cine' ? t('toast.qCine') : v === 'ligera' ? t('toast.qLight') : t('toast.qNormal'))
  }
  const [pet, setPet] = useState('')
  const [director, setDirector] = useState(false)
  const saveDirector = (v) => {
    setDirector(v)
    localStorage.setItem(`oficina-director-${profile}`, v ? '1' : '0')
    showToast(v ? t('toast.dirOn') : t('toast.dirOff'))
  }
  useEffect(() => {
    setPet(localStorage.getItem(`oficina-pet-${profile}`) || '')
    setQuality(localStorage.getItem(`oficina-quality-${profile}`) || 'normal')
    setDirector(localStorage.getItem(`oficina-director-${profile}`) === '1')
  }, [profile])
  const savePet = (v) => {
    setPet(v)
    localStorage.setItem(`oficina-pet-${profile}`, v)
    showToast(v ? t('toast.petIn', { pet: PETS.find((p2) => p2.id === v)?.label || t('toast.thePet') }) : t('toast.petOut'))
  }

  useEffect(() => {
    localStorage.setItem('oficina-board', board ? '1' : '0')
    window.oficina?.setBoard?.(board)
  }, [board])

  // el idioma elegido viaja al proceso principal: los agentes contestan en él
  useEffect(() => {
    window.oficina?.setLang?.(langName())
  }, [lang])

  const loadSquad = async (p) => {
    const r = (await window.oficina?.squad?.get(p)) || []
    setRoster(r)
  }

  // respaldo automático semanal de la configuración (#101), silencioso
  useEffect(() => {
    const timer = setTimeout(() => {
      const extras = {}
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('oficina-') && k !== 'oficina-pending-queue' && k !== 'oficina-camera') extras[k] = localStorage.getItem(k)
      }
      window.oficina?.config?.autoBackup?.(extras)
    }, 8000) // sin estorbar el arranque
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (project) window.oficina?.hasClaudeMd?.(project).then(setHasClaudeMd)
  }, [project])

  // los documentos son por perfil: al cambiarlo, la carpeta y el listado cambian
  useEffect(() => {
    if (!profile) return
    window.oficina?.artifacts?.getDir?.(profile).then(setArtsDir)
    window.oficina?.artifacts?.list?.(profile).then((l) => setArtsList(l || []))
    if (histOpen) window.oficina?.history?.list(profile).then((l) => setHistList(l || []))
  }, [profile])

  useEffect(() => {
    window.oficina?.artifacts?.getDir?.(profile).then(setArtsDir)
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

  const refreshArtifacts = async () => setArtsList((await window.oficina?.artifacts?.list?.(profile)) || [])
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
    setPrefsPanelOpen(false)
  }
  // ¿hay algún panel lateral abierto? (el dropdown de contexto tiene su propio backdrop)
  const panelOpen =
    histOpen || artsOpen || prefsOpen || agentsOpen || skillsOpen || mcpOpen || statsOpen || diagOpen || actOpen || prefsPanelOpen || !!diffView
  // Cierra SOLO la capa de arriba: los submenus se apilan sobre Configuración,
  // así que el primer cierre los quita a ellos y deja el panel de abajo abierto.
  // La usan Esc y el clic fuera, para que ambos se comporten igual.
  const closeTopPanel = () => {
    if (diffView) return setDiffView(null)
    if (skillsOpen) return setSkillsOpen(false)
    if (mcpOpen) return setMcpOpen(false)
    if (statsOpen) return setStatsOpen(false)
    if (prefsPanelOpen) return setPrefsPanelOpen(false)
    if (actOpen) return setActOpen(false)
    if (diagOpen) return setDiagOpen(false)
    if (agentsOpen) return closeAgents()
    closePanels()
  }
  const toggleArts = async () => {
    if (!artsOpen) await refreshArtifacts()
    const next = !artsOpen
    closePanels()
    setArtsOpen(next)
  }
  const pickArtsDir = async () => {
    const res = await window.oficina?.artifacts?.pickDir?.(profile)
    if (res?.ok) {
      setArtsDir(res.dir)
      showToast(t('toast.docsDir'))
    }
  }

  useEffect(() => {
    window.oficina?.getConfig?.().then((c) => {
      setCfg(c)
      // se retoma el perfil en el que se estaba: volver siempre al primero
      // obligaba a cambiarlo a mano en cada arranque
      let guardado = null
      try {
        guardado = localStorage.getItem('oficina-profile')
      } catch {}
      const first = c.profiles.includes(guardado) ? guardado : c.profiles[0]
      setProfile(first)
      setProject(c.projectsByProfile[first]?.[0]?.path || '')
      // el modelo persistido gana sobre el default de settings.json
      const proy0 = c.projectsByProfile[first]?.[0]?.path || ''
      setModel(leerPref('oficina-model', first, proy0) || c.defaultModels?.[first] || FALLBACK_MODEL)
      setEffort(leerPref('oficina-effort', first, proy0) || '')
      setWriteMode(leerPref('oficina-write', first, proy0) !== '0')
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
        showToast(t('toast.modelFromCli', { label: modelLabelOf(newDefault) }))
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [cfg, profile, model])

  // El manejador se re-crea en cada render, pero el efecto se suscribía UNA vez
  // y capturaba el del primero: todo lo que no fuera un ref quedaba congelado en
  // el render inicial. `profile`, `project` y `model` se usan al guardar la
  // conversación de un compañero, así que se guardaba con el perfil que hubiera
  // al arrancar la app, no con el de ahora.
  //
  // Se suscribe a un ref que siempre apunta al último manejador: una sola
  // suscripción y closures frescos. Añadir las dependencias no valía —esas
  // funciones se recrean en cada render y el efecto se re-suscribiría sin parar—.
  const manejaEventoRef = useRef(null)
  manejaEventoRef.current = (e) => {
      try {
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
                  : e.kind === 'sub-start'
                    ? `${String(e.subId || '').slice(-6)} · ${String(e.desc || '').slice(0, 40)}`
                    : e.kind === 'sub-done'
                      ? String(e.subId || '').slice(-6)
                      : e.kind === 'init'
                    ? (e.sessionId || '').slice(0, 8)
                    : e.kind === 'system'
                      ? `${e.subtype}${e.fields ? ` · ${e.fields}` : ''}`
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
            showToast(t('toast.suspended'), 8000)
          }
          window.oficina?.refreshUsage?.()
          return
        }
        // Un mensaje de subagente se atribuye al personaje que tiene prestado y va
        // a SU pestaña. Si todavía no tiene puesto, su trabajo se ve igual en su
        // pestaña: lo que espera es la silla, no el turno.
        // Si llega trabajo de un subagente del que no hay constancia, se le abre
        // el sitio aquí mismo en vez de dejarlo caer en la pestaña del principal:
        // así la feature no depende de haber reconocido su arranque.
        const asiento = e.sub?.id ? orqRef.current.subs[e.sub.id] || abreSub(e.sub.id, e.sub.desc, e.role) : null
        const who = asiento?.rol || e.role || principalRef.current
        const isP = !e.sub && who === principalRef.current
        const escribe = (fn) => (asiento ? enTabId(asiento.tabId, fn) : enTab(who, fn))
        // Un subagente sin personaje asignado NO puede tocar el estado del
        // principal: sus mensajes se le atribuyen por descarte, y cada uno lo
        // sacaba de «esperando asignaciones» para ponerlo a «Respondiendo…».
        const marca = (rol, estado) => {
          if (e.sub && !asiento?.rol) return
          setRS(rol, estado)
        }
        // Mientras haya subagentes vivos, el que reparte está esperando. Se
        // reafirma en cada evento suyo y no solo al repartir: basta con que algo
        // le pise el estado una vez para que se quede «Respondiendo…» el resto
        // del trabajo, y eso ya pasó.
        if (e.sub && Object.keys(orqRef.current.subs).length) {
          const jefe = e.role || principalRef.current
          setRS(jefe, 'working')
          // Su globo diría «Trabajando…», que es lo que hacen los otros. El
          // globo muestra el detalle de la herramienta en curso si es suya, así
          // que por ahí se le pone lo que de verdad está haciendo.
          setTool({ role: jefe, name: 'Agent', detail: t('status.delegating') })
          if (jefe === principalRef.current) setStatus(t('status.delegating'))
        }

        if (e.kind === 'sub-start') {
          abreSub(e.subId, e.desc, e.role)
          // El que reparte se queda en 'talking' de su último mensaje y su burbuja
          // sigue diciendo «Respondiendo…» durante todo el trabajo ajeno. No está
          // respondiendo: está esperando. Sigue ocupado —su turno está bloqueado
          // en la herramienta— pero eso se dice de otra forma.
          setRS(e.role, 'working')
          if (e.role === principalRef.current) setStatus(t('status.delegating'))
          return
        }

        if (e.kind === 'sub-done') {
          cierraSub(e.subId, e.isError)
          return
        }

        if (e.kind === 'init') {
          if (e.sessionId) {
            const suya = tabDeRolRef.current[who]
            if (!suya || suya === activeTabRef.current) sessionsRef.current[who] = e.sessionId
            else if (tabStateRef.current[suya]) tabStateRef.current[suya].sessions[who] = e.sessionId
          }
          if (isP) setStatus(t('status.thinking'))
        } else if (e.kind === 'ctx') {
          // El de un compañero NO toca el monitor —tiene su propio contexto— pero
          // se guarda su pico: la suma es el trabajo que no tuvo que caber en
          // este hilo, y es lo único que dice si repartir sirvió de algo.
          if (e.sub?.id) {
            picoSubRef.current[e.sub.id] = Math.max(picoSubRef.current[e.sub.id] || 0, contextoUsado(e.usage))
            return
          }
          // ocupación real del contexto: la de la última llamada a la API
          setCtxUsado(contextoUsado(e.usage))
        } else if (e.kind === 'todos') {
          setAgentTodos((prev) => ({ ...prev, [who]: e.todos }))
        } else if (e.kind === 'tool') {
          // El rastro es de la CONVERSACIÓN. La pestaña se resuelve igual que
          // para los mensajes (`escribe`, arriba): un subagente va a la de su
          // asiento y el resto a la de su rol. Usar solo `tabDeRol` estaba mal:
          // un personaje PRESTADO no está en ese mapa, así que sus pasos caían
          // en la pestaña que estuvieras mirando — abrías la de Nami y veías a
          // Franky trabajando dentro.
          const paso = { t: Date.now(), role: who, name: e.name, detail: e.detail || '', path: e.path || '' }
          const suTab = asiento ? asiento.tabId : tabDeRolRef.current[who]
          if (actividadEnTab(suTab, paso) && actOpen) setActividad(actividadRef.current)
          setTool({ role: who, name: e.name, detail: e.detail || null })
          setAgentTool((prev) => ({ ...prev, [who]: e.name }))
          // ¿editó archivos? su respuesta final ofrecerá «ver cambios» (git diff)
          if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(e.name)) {
            editedRef.current[who] = true
            // la ruta completa se guarda para la vista de cambios: el diff se pide
            // en el repo del archivo, no en la raíz del proyecto (que puede no serlo)
            if (e.path && !editedPathsRef.current.includes(e.path)) editedPathsRef.current.push(e.path)
            if (e.path) (turnoPathsRef.current[who] ||= []).push(e.path)
          }
          // ¿creó un artifact HTML? marcar para adjuntarlo a su respuesta al terminar
          if (e.name === 'Write' && /\.html?$/i.test(e.detail || '')) {
            pendingArtifactRef.current[who] = true
            setTimeout(refreshArtifacts, 400)
          }
          marca(who, 'working')
          if (isP) setStatus(`${toolInfo(e.name)[1]}${e.detail ? ` · ${e.detail}` : ''}…`)
        } else if (e.kind === 'text') {
          setTool((cur) => (cur?.role === who ? null : cur))
          setAgentTool((prev) => {
            if (!prev[who]) return prev
            const copy = { ...prev }
            delete copy[who]
            return copy
          })
          marca(who, 'talking')
          hubotextoRef.current[who] = true
          if (isP) setStatus(t('status.answering'))
          // El de un subagente llega entero (los deltas son solo del principal),
          // así que es un mensaje nuevo y no un trozo que se funde con el anterior.
          if (e.sub) {
            escribe((ms) => [...ms, { role: 'assistant', who, text: e.text, sub: true }])
            return
          }
          escribe((ms) => {
            const idx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && m.streaming)
            if (idx >= 0) {
              const copy = [...ms]
              copy[idx] = { ...copy[idx], text: copy[idx].text + e.text }
              return copy
            }
            return [...ms, { role: 'assistant', who, text: e.text, streaming: true }]
          })
        } else if (e.kind === 'thinking') {
          // se acumula y se engancha al mensaje del agente cuando termine
          pendingThinkingRef.current[who] = (pendingThinkingRef.current[who] || '') + e.text
        } else if (e.kind === 'done') {
          // El resumen de traspaso ES la respuesta de este turno: se guarda para
          // abrirlo en un chat nuevo. No se hace aquí mismo porque cambiar de
          // pestaña ahora leería un `messages` que aún no ha llegado al estado.
          if (traspasoRef.current?.target === who && e.result) {
            const { destino } = traspasoRef.current
            traspasoRef.current = null
            setTraspasoTexto({ texto: e.result, destino })
          }
          // Un subagente no sobrevive al turno del que lo lanzó: si su cierre no
          // llegó —el aviso se pierde, el turno se corta, lo que sea— se quedaba
          // trabajando en la escena para siempre, con su cronómetro corriendo.
          // El fin del turno es la verdad que siempre llega.
          for (const id of subsDe(orqRef.current, who)) cierraSub(id, false)
          const usage = e.usage && usageTotal(e.usage) > 0 ? e.usage : null
          // cuánto tardó: se guarda en el mensaje, junto a los tokens, para poder
          // mirar atrás y no solo verlo pasar en el chip
          const dur = startedAtRef.current[who] ? Date.now() - startedAtRef.current[who] : 0
          const edited = !!editedRef.current[who]
          delete editedRef.current[who]
          const thinking = pendingThinkingRef.current[who] || null
          delete pendingThinkingRef.current[who]
          // Lo que se trabajó FUERA de este hilo: la suma de lo que llegó a
          // ocupar cada compañero. Es la respuesta a «¿sirvió de algo repartir?»
          // — ese contexto habría tenido que caber aquí dentro.
          const fuera = Object.values(picoSubRef.current).reduce((a, b) => a + b, 0)
          picoSubRef.current = {}
          enTab(who, (ms) => {
            const idx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && m.streaming)
            if (idx >= 0) {
              const copy = [...ms]
              copy[idx] = { ...copy[idx], streaming: false, usage, dur, edited, thinking, fuera }
              return copy
            }
            return e.result ? [...ms, { role: 'assistant', who, text: e.result, usage, dur, edited, thinking, fuera }] : ms
          })
          // La ocupación del contexto NO se calcula aquí: el usage del `result` es
          // el acumulado del turno, no lo que ocupa el contexto. Llega por 'ctx',
          // con el usage de cada llamada. Este `usage` sí sirve para el acumulado
          // de tokens de la conversación, que es lo que mide.
          // acumulado de tokens de la conversación (para el monitor de claude)
          if (usage)
            setConvTokens((tok) => ({
              in: tok.in + (usage.input_tokens || 0),
              out: tok.out + (usage.output_tokens || 0),
              cache: tok.cache + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
            }))
          // si generó un artifact este turno, adjuntar su enlace al mensaje del agente
          if (pendingArtifactRef.current[who]) {
            delete pendingArtifactRef.current[who]
            window.oficina?.artifacts?.list?.(profileRef.current).then((list) => {
              const art = list?.[0]
              if (!art) return
              enTab(who, (ms) => {
                const idx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && !m.artifact)
                return idx < 0 ? ms : ms.map((m, i) => (i === idx ? { ...m, artifact: art } : m))
              })
            })
          }
          // ¿hay un handoff pendiente de este rol? guardar su resultado
          const entry = handoffsRef.current.find((h) => h.from === who && h.result == null)
          if (entry) entry.result = (e.result || '').slice(0, 6000) || '(sin salida)'
          // el principal solo camina cuando entrega a un compañero; los demás siempre
          delete tabDeRolRef.current[who]
          setRS(who, isP && !entry ? 'idle' : 'delivering')
          // si entrega a un compañero, camina hacia ÉL (no hacia el principal)
          if (entry) setDeliverTargets((d) => ({ ...d, [who]: entry.to }))
          setTool((cur) => (cur?.role === who ? null : cur))
          setAgentTool((prev) => {
            if (!prev[who]) return prev
            const copy = { ...prev }
            delete copy[who]
            return copy
          })
          setAgentTodos((prev) => {
            if (!prev[who]) return prev
            const copy = { ...prev }
            delete copy[who]
            return copy
          })
          // ¿este turno llegó a pintar algo? Si no, no se anuncia como respuesta:
          // el chip decía «X respondió» y sonaba el ding igual cuando el turno
          // terminaba sin texto, así que parecía que la respuesta se había perdido.
          const respondio = !!hubotextoRef.current[who] || !!(e.result || '').trim()
          delete hubotextoRef.current[who]
          // un turno que acabó MAL no es un turno callado: se dice qué pasó
          if (e.isError) {
            enTab(who, (ms) => [
              ...ms,
              {
                role: 'assistant',
                who,
                error: true,
                text: `⚠️ ${(e.result || '').trim() || t('run.turnError', { motivo: e.subtype || 'error' })}`,
              },
            ])
          }
          // Recarga automática: solo al terminar el turno y con debounce. En cada
          // Write recargaría con el código a medias de un multi-edit.
          const tocadas = turnoPathsRef.current[who] || []
          delete turnoPathsRef.current[who]
          if (tocadas.length && editedRef.current[who] !== undefined) {
            autoRecargaRef.current(tocadas)
          }
          if (respondio) {
            ultimoRef.current = who
            dingSound()
          }
          window.oficina?.refreshUsage?.() // el % de uso quedó desactualizado tras el turno
          // chip transitorio anunciando la respuesta final (con duración si fue larga)
          const doneName = squadRef.current.find((m) => m.id === who)?.name || who
          recordStat(who, usage, dur, memberModel(who), convIdRef.current) // acumulado diario para 📈 Estadísticas
          setDoneChip(
            respondio
              ? `✅ ${doneName} respondió${dur >= 5000 ? ` · ${fmtElapsed(dur)}` : ''}${usage ? ` · 🪙 ${fmtTokens(usageTotal(usage))}` : ''}`
              : e.isError
                ? `⚠️ ${doneName}: ${e.subtype || 'error'}`
                : `⚠️ ${doneName} terminó sin respuesta`
          )
          // sin texto el turno no dejaría rastro en el chat: queda la línea
          if (!respondio && !e.isError)
            enTab(who, (ms) => [...ms, { role: 'system', text: `⚠️ ${doneName} terminó el turno sin decir nada` }])
          clearTimeout(doneChipTimer.current)
          doneChipTimer.current = setTimeout(() => setDoneChip(null), 3500)
          if (isP) setStatus(t('status.waiting'))
        } else if (e.kind === 'stopped') {
          delete tabDeRolRef.current[who]
          delete editedRef.current[who]
          delete hubotextoRef.current[who]
          // tarea cancelada: quita la respuesta a medias y marca tu mensaje como cancelado
          enTab(who, (ms) => {
            const aIdx = ms.findLastIndex((m) => m.role === 'assistant' && m.who === who && m.streaming)
            let out = aIdx < 0 ? ms : ms.filter((_, i) => i !== aIdx)
            const uIdx = out.findLastIndex((m) => m.role === 'user' && m.to === who && !m.cancelled)
            if (uIdx >= 0) out = out.map((m, i) => (i === uIdx ? { ...m, cancelled: true } : m))
            return out
          })
          handoffsRef.current = handoffsRef.current.filter((h) => !(h.from === who && h.result == null))
          setRS(who, 'idle')
          setTool((cur) => (cur?.role === who ? null : cur))
          setAgentTool((prev) => {
            if (!prev[who]) return prev
            const copy = { ...prev }
            delete copy[who]
            return copy
          })
          setAgentTodos((prev) => {
            if (!prev[who]) return prev
            const copy = { ...prev }
            delete copy[who]
            return copy
          })
          buzzSound()
          const name = squadRef.current.find((m) => m.id === who)?.name || who
          setToast(`⏹ ${name}: tarea cancelada`)
          clearTimeout(toastTimer.current)
          toastTimer.current = setTimeout(() => setToast(null), 3500)
          if (isP) setStatus(t('status.waiting'))
        } else if (e.kind === 'error') {
          delete editedRef.current[who]
          delete hubotextoRef.current[who]
          // ¿error transitorio (rate limit, red, timeout)? un reintento
          // automático con backoff — solo UNO por job; si repite, error normal
          const transient = /(\b429\b|\b529\b|rate.?limit|timeout|etimedout|econnreset|enotfound|eai_again|socket hang up|network|overloaded)/i.test(
            `${e.message || ''} ${e.detail || ''}`
          )
          const failedJob = lastJobRef.current[who]
          if (transient && failedJob && !retriedRef.current.has(failedJob.id)) {
            retriedRef.current.add(failedJob.id)
            setRS(who, 'idle')
            setTool((cur) => (cur?.role === who ? null : cur))
            setAgentTool((prev) => {
              const copy = { ...prev }
              delete copy[who]
              return copy
            })
            setAgentTodos((prev) => {
              const copy = { ...prev }
              delete copy[who]
              return copy
            })
            const name = squadRef.current.find((m) => m.id === who)?.name || who
            setToast(`⚠️ ${name}: error transitorio — reintentando en 5s…`)
            clearTimeout(toastTimer.current)
            toastTimer.current = setTimeout(() => setToast(null), 5000)
            setTimeout(() => autoRetryRef.current(who), 5000)
            if (isP) setStatus(t('status.retrying'))
            return
          }
          // el stderr (si vino) se muestra como bloque de código en el mensaje
          const text = e.detail ? `⚠️ ${e.message}\n\n\`\`\`\n${e.detail}\n\`\`\`` : `⚠️ ${e.message}`
          setMessages((ms) => [...ms, { role: 'assistant', who, text, error: true }])
          setRS(who, 'idle')
          setTool((cur) => (cur?.role === who ? null : cur))
          setAgentTool((prev) => {
            if (!prev[who]) return prev
            const copy = { ...prev }
            delete copy[who]
            return copy
          })
          setAgentTodos((prev) => {
            if (!prev[who]) return prev
            const copy = { ...prev }
            delete copy[who]
            return copy
          })
          buzzSound()
          if (isP) setStatus(t('status.waiting'))
        }
    
      } catch (err) {
        // Un fallo aquí abortaba el evento en silencio y dejaba el estado a
        // medias —la pestaña creada pero el subagente sin registrar, o el
        // principal atascado en «Respondiendo…»— sin nada que lo delatara.
        diagRef.current.push({ t: Date.now(), role: e.role || '—', kind: 'error-evento', info: `${e.kind}: ${err?.message || err}` })
        console.error('[oficina] evento', e.kind, err)
      }
  }
  useEffect(() => {
    if (!window.oficina?.onEvent) return
    return window.oficina.onEvent((e) => manejaEventoRef.current?.(e))
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
          new Notification('La Oficina', { body: t('notif.standupReady') })
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
    const timer = setTimeout(() => {
      delivering.forEach((r) => setRS(r, 'idle'))
      setDeliverTargets((d) => {
        const copy = { ...d }
        delivering.forEach((r) => delete copy[r])
        return copy
      })
    }, 30_000)
    return () => clearTimeout(timer)
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
          effort,
          role: h.to,
        })
        .then((res) => {
          if (!res?.ok) {
            setRS(h.to, 'idle')
            showToast(`⚠️ ${res?.error || t('toast.noDeliver')}`)
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
        closeTopPanel()
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
  }, [squad, histOpen, agentsOpen, prefsOpen, findOpen, diffView, skillsOpen, mcpOpen, lightbox, statsOpen, diagOpen, tourOpen, prefsPanelOpen])

  // Clic fuera de un panel abierto = cerrarlo, capa por capa (igual que Esc).
  // Se excluye el HUD: sus botones son toggles y ya cierran lo que abrieron —
  // si el clic los cerrara antes, la barra no podría volver a cerrar nada.
  useEffect(() => {
    if (!panelOpen) return
    // `.act-btn` está aquí por el mismo motivo que `.hud`: es un toggle y ya
    // cierra lo que abre. Sin excluirlo, el `mousedown` cerraba el panel y el
    // `click` posterior —ya con el estado nuevo— lo volvía a abrir, así que
    // parpadeaba y se quedaba abierto.
    const DENTRO = '.drawer, .hud, .act-btn, .ctx-pop, .ctx-backdrop, .snip-pop, .tour, .lightbox'
    const onDown = (e) => {
      if (e.target.closest?.(DENTRO)) return
      closeTopPanel()
    }
    // captura: así se adelanta a los handlers de la escena y del chat
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [panelOpen, diffView, skillsOpen, mcpOpen, statsOpen, prefsPanelOpen, diagOpen, agentsOpen])

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
  // mismo camino para lo que llega arrastrado y para lo que elige el botón 📎
  const addFiles = async (files) => {
    for (const f of files || []) {
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
  const handleDrop = (e) => {
    e.preventDefault()
    addFiles(e.dataTransfer?.files)
  }
  const fileInputRef = useRef(null)
  // pestañas: renombrar con doble click y reordenar arrastrando (#121)
  const [tabRename, setTabRename] = useState(null) // {id, val} | null
  const [tabDrag, setTabDrag] = useState(null)
  const [thinkingOpen, setThinkingOpen] = useState({}) // índices con el razonamiento desplegado
  const commitTabRename = () => {
    if (!tabRename) return
    const val = tabRename.val.trim()
    // el título es del usuario a partir de aquí: `fijo` frena el autotítulo
    if (val) setTabs((prev) => prev.map((x) => (x.id === tabRename.id ? { ...x, title: val, fijo: true } : x)))
    setTabRename(null)
  }
  const moveTab = (destino) => {
    if (!tabDrag || tabDrag === destino) return
    setTabs((prev) => {
      const arr = [...prev]
      const desde = arr.findIndex((x) => x.id === tabDrag)
      const hasta = arr.findIndex((x) => x.id === destino)
      if (desde < 0 || hasta < 0) return prev
      arr.splice(hasta, 0, ...arr.splice(desde, 1))
      return arr
    })
  }

  // aviso transitorio: aparece y se desvanece solo (no ensucia el chat)
  const showToast = (text, ms = 3500) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }

  // El botón «▶ Terminal» de los bloques de código necesita saber dónde correr.
  // Va DESPUÉS de showToast y de project a propósito: el array de dependencias
  // se evalúa durante el render, así que colocarlo antes de sus declaraciones
  // reventaba el arranque con «Cannot access 'project' before initialization»
  // —minificado, y con el stack apuntando a otro chunk, que despista—.
  useEffect(() => {
    configuraTerminal({
      cwd: project,
      correr: async (cmd) => {
        const res = await window.oficina?.terminalRun?.({ cmd, cwd: project })
        if (res?.ok) showToast(t('term.sent'))
        else showToast(`⚠️ ${res?.copiado ? t('term.copied') : res?.error || ''}`, 7000)
      },
    })
  }, [project])


  // Descarta todo lo pendiente de la conversación actual: mensajes en cola y
  // handoffs a medias no deben dispararse dentro de la conversación siguiente.
  const clearConversation = () => {
    setMessages([])
    desaparca() // una conversación nueva se ve; heredar el aparcado la escondería
    setChatFilter(null)
    setConvTokens({ in: 0, out: 0, cache: 0 })
    setCtxUsado(0)
    setAgentTodos({})
    convIdRef.current = null
    sessionsRef.current = {}
    queuesRef.current = {}
    actividadRef.current = []
    setActividad([])
    setQueuedCounts({})
    try {
      localStorage.removeItem('oficina-pending-queue')
    } catch {}
    handoffsRef.current = []
    editedPathsRef.current = []
    ultimoRef.current = null
    setCtxSilenciado(0) // el aviso de contexto se descarta por hilo, no para siempre
    window.oficina?.reset?.()
  }

  // «Conversación nueva»: abre una PESTAÑA nueva y deja la actual donde estaba.
  //
  // Antes vaciaba la pestaña en la que estabas. El hilo no se perdía —el
  // historial guarda en cada mensaje— pero desaparecía de la vista, y con él su
  // pestaña: su proyecto, su modelo y su permiso de edición. Desde que cada
  // pestaña lleva su propio contexto de trabajo, reemplazarla cuesta bastante
  // más que antes, y «nueva» sugiere añadir una, no sustituir la que hay.
  //
  // Si la pestaña ya está vacía no se abre otra en blanco al lado: ya estás en
  // una conversación nueva.
  //
  // Para cuando el usuario la PIDE —el botón + Nueva, ⌘K, /nueva, el Tray—.
  // Vaciar el hilo por un efecto secundario (cerrar la última pestaña, borrar
  // del historial la que tenías abierta) usa `clearConversation` a secas.
  const newChat = async () => {
    if (messages.length) await addTab()
    showToast(t('toast.newChat'))
  }

  // ── Pestañas de conversación (#96) ───────────────────────────────────────
  // Cada pestaña guarda su propio hilo: mensajes, sesiones de Claude, cola y
  // tokens. Cambiar de pestaña con agentes trabajando pondría sus respuestas
  // en el hilo equivocado, así que se bloquea mientras haya tareas en curso.
  // Sin tope de pestañas: cada subagente enseña su trabajo en la suya desde el
  // primer momento. El tope de 5 es de PUESTOS en la escena (la oficina tiene
  // seis sillas y el principal ocupa una); quien no tiene puesto trabaja igual
  // y lo toma en cuanto se libere uno.
  const tabStateRef = useRef({})
  const [tabs, setTabs] = useState(() => [{ id: 'tab-1', title: 'Nueva' }])
  const [activeTab, setActiveTab] = useState('tab-1')
  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  // Conversación aparcada: el hilo sigue vivo y en «Chats activos», pero deja de
  // tapar la escena. Hasta ahora la única forma de quitarlo de la vista era abrir
  // una conversación nueva, que es otra cosa — deja la oficina llena de pestañas
  // vacías para no leer lo que ya leíste.
  //
  // Es estado de la VISTA y no de cada pestaña: solo se puede aparcar la que
  // estás mirando, y volver a cualquier pestaña la trae de vuelta. Guardarlo por
  // pestaña permitiría dejarlas todas aparcadas y no habría nada que mirar.
  const [chatMin, setChatMin] = useState(false)
  // Llegó algo mientras estaba aparcada. El chip de «X respondió» dura 3,5 s: si
  // no estabas delante, sin esto la respuesta queda escondida sin ninguna señal.
  const [chatMinNuevo, setChatMinNuevo] = useState(false)
  const chatMinRef = useRef(false)
  useEffect(() => {
    chatMinRef.current = chatMin
  }, [chatMin])
  // Traerla de vuelta. Se llama desde todo lo que significa «quiero verla»:
  // pinchar una pestaña, abrir una nueva o vaciar la conversación.
  const desaparca = () => {
    setChatMin(false)
    setChatMinNuevo(false)
  }

  // La primera pestaña existe desde el arranque y nunca pasaba por `addTab`, así
  // que se quedaba sin entrada hasta el primer cambio de pestaña.
  useEffect(() => {
    if (!project) return
    // Se asigna siempre, no solo si falta: el proyecto de la pestaña activa ES
    // el que está seleccionado. Si solo se rellenara cuando está vacío, cambiar
    // de proyecto en una pestaña vacía dejaría el valor viejo guardado.
    const st = tabStateRef.current[activeTabRef.current]
    if (st) st.project = project
    else tabStateRef.current[activeTabRef.current] = { messages: [], project, convId: null, sessions: {}, queues: {}, editedPaths: [], ultimo: null, tokens: { in: 0, out: 0, cache: 0 } }
  }, [project])

  const snapshotTab = () => {
    tabStateRef.current[activeTab] = {
      messages,
      // El proyecto es de la conversación, no de la ventana. Cada terminal
      // lleva su `cd` pegado; una pestaña tiene que hacer lo mismo, o al
      // volver a ella se contesta en el directorio equivocado.
      project,
      actividad: actividadRef.current,
      convId: convIdRef.current,
      sessions: { ...sessionsRef.current },
      queues: { ...queuesRef.current },
      editedPaths: [...editedPathsRef.current],
      ultimo: ultimoRef.current,
      tokens: convTokens,
    }
  }
  const restoreTab = async (id) => {
    const st = tabStateRef.current[id] || {}
    // Su proyecto primero: lo que venga después (sesiones, cwd) depende de él.
    const suProyecto = st.project || project
    if (suProyecto !== project) {
      setProject(suProyecto)
      aplicaPrefsDeProyecto(suProyecto)
    }
    setMessages(st.messages || [])
    setChatFilter(null)
    setConvTokens(st.tokens || { in: 0, out: 0, cache: 0 })
    convIdRef.current = st.convId || null
    sessionsRef.current = st.sessions || {}
    queuesRef.current = st.queues || {}
    editedPathsRef.current = st.editedPaths || []
    ultimoRef.current = st.ultimo || null
    actividadRef.current = st.actividad || []
    setActividad(actividadRef.current)
    syncQueues()
    // los agentes que siguen trabajando para OTRA pestaña conservan su sesión:
    // limpiarla aquí haría que su siguiente turno arrancara sin contexto
    const enCurso = {}
    const suyoDe = {} // proyecto de cada rol que trabaja para otra pestaña
    for (const [rol, tabId] of Object.entries(tabDeRolRef.current)) {
      if (tabId && tabId !== id) {
        enCurso[rol] = tabStateRef.current[tabId]?.sessions?.[rol]
        const proy = tabStateRef.current[tabId]?.project
        if (proy) suyoDe[rol] = proy
      }
    }
    // `suProyecto`, no `project`: `setProject` es asíncrono y aquí la variable
    // todavía vale la de la pestaña que acabamos de dejar. Registrar la sesión
    // bajo el proyecto equivocado es exactamente lo que hacía que el hilo
    // arrancara de cero sin avisar.
    await window.oficina?.setSession?.({
      sessions: { ...enCurso, ...(st.sessions || {}) },
      profile,
      cwd: suProyecto,
      cwds: suyoDe,
    })
  }
  const switchTab = async (id) => {
    // Pinchar una pestaña es pedir verla, así que la desaparca — y vale también
    // para la activa, que si no sería la única sin forma de volver.
    desaparca()
    if (id === activeTab) return
    snapshotTab()
    setActiveTab(id)
    await restoreTab(id)
  }
  /// El proyecto de una pestaña: la activa lo tiene en el estado, las demás en
  /// su instantánea.
  const proyectoDeTab = (id) => (id === activeTab ? project : tabStateRef.current[id]?.project || '')

  useEffect(() => {
    window.oficina?.onUpdateReady?.((d) => setUpdateLista(d?.version || '?'))
  }, [])

  const addTab = async (suProyecto = project) => {
    snapshotTab()
    const id = `tab-${Date.now()}`
    // Se registra YA, no al abandonarla: hasta ahora el estado de una pestaña
    // solo se escribía al salir de ella, así que si volvías antes de haber
    // salido no había proyecto que restaurar y se quedaba el de la otra.
    tabStateRef.current[id] = { messages: [], project: suProyecto, convId: null, sessions: {}, queues: {}, editedPaths: [], ultimo: null, tokens: { in: 0, out: 0, cache: 0 } }
    setTabs((prev) => [...prev, { id, title: t('hud.new') }])
    setActiveTab(id)
    clearConversation()
    return id
  }
  const closeTab = async (e, id) => {
    e.stopPropagation()
    // la última no se cierra: se vacía. Sin aviso — cerrar no es crear
    if (tabs.length === 1) return clearConversation()
    if (busy && id === activeTab) return showToast(t('toast.busy'))
    delete tabStateRef.current[id] // el hilo ya está guardado en el historial
    const resto = tabs.filter((x) => x.id !== id)
    setTabs(resto)
    if (id === activeTab) {
      const siguiente = resto[resto.length - 1].id
      setActiveTab(siguiente)
      await restoreTab(siguiente)
    }
  }
  // el título de la pestaña sigue al primer mensaje del hilo
  useEffect(() => {
    const primero = messages.find((m) => m.role === 'user')?.text?.slice(0, 22)
    setTabs((prev) => prev.map((x) => (x.id === activeTab && !x.fijo ? { ...x, title: primero || t('hud.new') } : x)))
  }, [messages, activeTab])

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
      showToast(t('toast.readMode'))
      return
    }
    if (await hasGit(project)) {
      showToast(t('toast.writeMode'))
    } else {
      showToast(t('toast.noGitWrite'), 6000)
    }
  }

  // Escritorio de cada cuenta: sus pestañas y todo lo que cuelga de ellas. Se
  // guarda al salir y se restaura al volver, así que cambiar de cuenta no
  // interrumpe lo que tenías abierto en la otra.
  const escritoriosRef = useRef({})

  // Traspaso de hilo antes de que el contexto se llene. El aviso se descarta por
  // conversación: si lo cierras, no vuelve a salir en este hilo — pero al abrir
  // uno nuevo empieza de cero, porque ahí la decisión es otra.
  // Hasta qué nivel se descartó el aviso: 0 ninguno, 1 el del 85%, 2 el urgente.
  // Guardar el NIVEL y no un booleano es lo que hace que vuelva a salir cuando
  // la situación empeora, en vez de silenciarse para todo el hilo.
  const [ctxSilenciado, setCtxSilenciado] = useState(0)
  const traspasoRef = useRef(null) // rol al que se le pidió el resumen
  const [traspasoTexto, setTraspasoTexto] = useState(null)
  const nivelCtx = nivelTraspaso(ctxUsado, model)
  const avisaContexto = nivelCtx > ctxSilenciado && messages.length > 0

  useEffect(() => {
    if (!traspasoTexto) return
    ;(async () => {
      // «aquí» vacía el hilo en esta misma pestaña: lo que libera el contexto es
      // arrancar una sesión nueva, así que no basta con borrar los mensajes.
      // La pestaña, su nombre y su sitio se quedan.
      if (traspasoTexto.destino === 'aqui') clearConversation()
      else await addTab()
      // se deja en el composer y NO se envía: es un resumen generado por un
      // modelo sobre una conversación larga, y merece una lectura antes de
      // convertirse en el punto de partida del hilo nuevo
      setInput(traspasoTexto.texto)
      inputRef.current?.focus()
      showToast(t('ctx.ready'), 7000)
      setTraspasoTexto(null)
    })()
  }, [traspasoTexto])

  // A dónde va el resumen. Abrir otra pestaña conserva el hilo viejo para
  // consultarlo; seguir aquí conserva la pestaña, su sitio y su nombre. Son dos
  // necesidades distintas y ninguna sustituye a la otra.
  const pedirTraspaso = (destino = 'nuevo') => {
    // se le pide a quien viene trabajando en el hilo: es quien tiene el contexto
    const target = ultimoRef.current || principal
    if (roleStates[target]) return showToast(t('ctx.busy'))
    if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
    traspasoRef.current = { target, destino }
    setCtxSilenciado(2) // ya se pidió: no volver a insistir en este hilo
    showToast(t('ctx.asking'))
    dispatchJob({
      id: crypto.randomUUID(),
      target,
      text: t('ctx.prompt'),
      display: t('ctx.prompt'),
      prompt: t('ctx.prompt'),
      atts: [],
    })
  }

  const changeProfile = async (p) => {
    if (p === profile) return
    // Cambiar de cuenta con el squad trabajando dejaría ese trabajo huérfano: su
    // stream sigue vivo, y al volver aterrizaría con las sesiones de otra cuenta.
    if (busy) return showToast(t('toast.profileBusy'))
    // guardar el escritorio de la cuenta que se deja
    snapshotTab()
    escritoriosRef.current[profile] = {
      tabs,
      activeTab,
      estados: tabStateRef.current,
      tabDeRol: tabDeRolRef.current,
      orq: orqRef.current,
      subMeta: subMetaRef.current,
      invitados,
    }
    setProfile(p)
    const proy = cfg?.projectsByProfile?.[p]?.[0]?.path || ''
    setProject(proy)
    setModel(leerPref('oficina-model', p, proy) || cfg?.defaultModels?.[p] || FALLBACK_MODEL)
    setEffort(leerPref('oficina-effort', p, proy) || '')
    setWriteMode(leerPref('oficina-write', p, proy) !== '0')
    setTheme(localStorage.getItem(`oficina-theme-${p}`) || 'clasico') // tema por cuenta

    const suyo = escritoriosRef.current[p]
    if (suyo) {
      // volver a una cuenta la deja como la dejaste, con sus pestañas y su hilo
      tabStateRef.current = suyo.estados || {}
      tabDeRolRef.current = suyo.tabDeRol || {}
      orqRef.current = suyo.orq || estadoInicial()
      subMetaRef.current = suyo.subMeta || {}
      setInvitados(suyo.invitados || [])
      setTabs(suyo.tabs)
      setActiveTab(suyo.activeTab)
      const st = (suyo.estados || {})[suyo.activeTab] || {}
      setMessages(st.messages || [])
      desaparca() // el aparcado es de la vista, no viaja con la cuenta
      setChatFilter(null)
      setConvTokens(st.tokens || { in: 0, out: 0, cache: 0 })
      convIdRef.current = st.convId || null
      sessionsRef.current = st.sessions || {}
      queuesRef.current = st.queues || {}
      editedPathsRef.current = st.editedPaths || []
      ultimoRef.current = st.ultimo || null
      syncQueues()
      // las sesiones se restauran con la cuenta NUEVA, no con la del closure:
      // `profile` todavía no ha cambiado en este render
      await window.oficina?.setSession?.({ sessions: st.sessions || {}, profile: p, cwd: proy })
    } else {
      // primera vez en esta cuenta: escritorio limpio
      tabStateRef.current = {}
      tabDeRolRef.current = {}
      orqRef.current = estadoInicial()
      subMetaRef.current = {}
      setInvitados([])
      setTabs([{ id: 'tab-1', title: t('hud.new') }])
      setActiveTab('tab-1')
      clearConversation()
    }
    window.oficina?.refreshUsage?.() // refrescar el % de uso al cambiar de cuenta
    loadSquad(p) // cada cuenta tiene su squad
  }
  // Preferencias que dependen del proyecto: modelo, permiso de edición (#124) y
  // esfuerzo. Se aplican tanto al elegir proyecto como al volver a una pestaña,
  // y por eso están fuera de `selectProject`: volver a una pestaña NO debe
  // borrar su conversación, y `selectProject` sí la borra.
  const aplicaPrefsDeProyecto = (v) => {
    const suEdicion = leerPref('oficina-write', profile, v) !== '0'
    setModel(leerPref('oficina-model', profile, v) || cfg?.defaultModels?.[profile] || FALLBACK_MODEL)
    setWriteMode(suEdicion)
    setEffort(leerPref('oficina-effort', profile, v) || '')
    return suEdicion
  }

  const selectProject = async (v) => {
    if (v === project) return
    // Cambiar de proyecto con una conversación viva NO la pisa: se queda en su
    // pestaña y el proyecto nuevo abre otra. Antes `clearConversation()` borraba
    // el hilo y sus sesiones, así que pasar de desarrollo a release perdía la
    // conversación de desarrollo — justo el caso de tener un clon por workflow.
    if (messages.length) await addTab(v)
    else clearConversation()
    setProject(v)
    const suEdicion = aplicaPrefsDeProyecto(v)
    // edición activa + proyecto sin git = sin red de seguridad
    if (suEdicion && !(await hasGit(v))) {
      showToast(t('toast.noGitOpen'), 6000)
    }
  }
  // Quitar un proyecto de la lista del perfil. No toca el disco.
  const removeProjectFlow = async (p) => {
    const r = await window.oficina?.removeProject?.({ profile, path: p.path })
    if (!r?.ok) return showToast(r?.error || t('toast.removeProjectFail'), 5000)
    const c = await window.oficina?.getConfig?.()
    if (c) setCfg(c)
    // si era el que estabas usando, hay que irse a otro: seguir apuntando a un
    // proyecto que ya no está en la lista deja la barra mintiendo
    if (p.path === project) {
      const queda = c?.projectsByProfile?.[profile]?.[0]?.path
      if (queda) selectProject(queda)
    }
    showToast(t('toast.removedProject', { name: p.name.replace(/^(🗂|📌)\s*/, '') }))
  }

  // "➕ Agregar proyecto…": picker de carpeta; se persiste por perfil
  const addProjectFlow = async () => {
    const res = await window.oficina?.addProject?.(profile)
    if (res?.ok) {
      setCfg((await window.oficina?.getConfig?.()) || cfg)
      setProject(res.path)
      clearConversation()
      const git = !writeMode || (await hasGit(res.path))
      showToast(git ? t('toast.projAdded', { name: res.name }) : t('toast.projAddedNoGit', { name: res.name }), git ? 3500 : 6000)
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
    setScanResult(res?.ok ? { repo: res.repo, skills: res.skills } : { error: res?.error || t('err.noReadRepo') })
  }
  const createSkill = async () => {
    const res = await window.oficina?.skills?.create(profile, skillForm.name, skillForm.desc)
    if (res?.ok) {
      showToast(t('toast.skillCreated', { id: res.id }))
      setSkillForm(null)
      refreshSkills()
    } else showToast(`⚠️ ${res?.error || t('toast.noCreate')}`)
  }

  // ── Plugins del perfil (claude plugin CLI) ────────────────────────────────
  const [pluginData, setPluginData] = useState(null) // null | {loading} | {error} | {installed, available, marketplaces}
  const [pluginBusy, setPluginBusy] = useState(null)
  const [mktUrl, setMktUrl] = useState('')
  const [pluginQuery, setPluginQuery] = useState('')
  const refreshPlugins = async () => {
    setPluginData({ loading: true })
    const [lst, mkts] = await Promise.all([window.oficina?.plugins?.list(profile), window.oficina?.plugins?.marketplaces(profile)])
    if (!lst?.ok) setPluginData({ error: lst?.error?.slice(0, 200) || t('err.noPluginCli') })
    else setPluginData({ installed: lst.installed, available: lst.available, marketplaces: mkts?.ok ? mkts.marketplaces : [] })
  }
  const addMkt = async () => {
    if (!mktUrl.trim()) return
    setPluginBusy('mkt')
    const res = await window.oficina?.plugins?.addMarketplace(profile, mktUrl)
    setPluginBusy(null)
    if (res?.ok) {
      showToast(t('toast.srcAdded'))
      setMktUrl('')
      refreshPlugins()
    } else showToast(`⚠️ ${res?.error?.slice(0, 160) || t('toast.noAdd')}`, 6000)
  }
  const removeMkt = async (name) => {
    setPluginBusy(name)
    const res = await window.oficina?.plugins?.removeMarketplace(profile, name)
    setPluginBusy(null)
    showToast(res?.ok ? t('toast.srcRemoved') : `⚠️ ${res?.error?.slice(0, 160) || t('toast.noRemove')}`)
    refreshPlugins()
  }
  const installPlugin = async (id) => {
    setPluginBusy(id)
    const res = await window.oficina?.plugins?.install(profile, id)
    setPluginBusy(null)
    if (res?.ok) showToast(t('toast.plugInstalled', { name: id.split('@')[0] }))
    else showToast(`⚠️ ${res?.error?.slice(0, 160) || t('toast.noInstall')}`, 6000)
    refreshPlugins()
  }
  const uninstallPlugin = async (id) => {
    setPluginBusy(id)
    const res = await window.oficina?.plugins?.uninstall(profile, id)
    setPluginBusy(null)
    showToast(res?.ok ? t('toast.plugRemoved') : `⚠️ ${res?.error?.slice(0, 160) || t('toast.noUninstall')}`)
    refreshPlugins()
  }
  const installSkill = async (s) => {
    setSkillBusy(s.id)
    const res = await window.oficina?.skills?.install(profile, s.id, s.repo)
    setSkillBusy(null)
    if (res?.ok) showToast(t('toast.skillInstalled', { name: s.name }))
    else showToast(`⚠️ ${res?.error || t('toast.noInstall')}`, 6000)
    refreshSkills()
  }
  // «🔄 Actualizar todo»: re-instala (git pull + copia) las del catálogo
  const [skillsUpdating, setSkillsUpdating] = useState(false)
  const updateAllSkills = async () => {
    const known = (installedSkills || []).map((x) => SKILL_CATALOG.find((s) => s.id === x.id)).filter(Boolean)
    const propias = (installedSkills || []).length - known.length
    if (!known.length) {
      showToast(propias ? t('toast.onlyOwnSkills', { n: propias }) : t('toast.noCatalogSkills'))
      return
    }
    setSkillsUpdating(true)
    let ok = 0
    for (const [i, s] of known.entries()) {
      showToast(t('toast.updatingSkill', { name: s.name, i: i + 1, total: known.length }), 20000)
      const res = await window.oficina?.skills?.install(profile, s.id, s.repo)
      if (res?.ok) ok++
    }
    setSkillsUpdating(false)
    showToast(`${t('toast.updatedSkills', { ok, s: plural(ok) })}${propias ? t('toast.updatedSkillsOwn', { n: propias, s: plural(propias) }) : ''}`, 6000)
    refreshSkills()
  }

  const removeSkill = async (id) => {
    setSkillBusy(id)
    const res = await window.oficina?.skills?.remove(profile, id)
    setSkillBusy(null)
    showToast(res?.ok ? t('toast.skillRemoved') : `⚠️ ${res?.error || t('toast.noRemove')}`)
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
    if (res?.ok) showToast(t('toast.mcpConnected', { name: entry.name }))
    else showToast(`⚠️ ${res?.error?.slice(0, 160) || t('toast.noAdd')}`, 6000)
    refreshMcp()
  }
  const removeMcp = async (name) => {
    setMcpBusy(name)
    const res = await window.oficina?.mcp?.remove(profile, name)
    setMcpBusy(null)
    showToast(res?.ok ? t('toast.serverRemoved') : `⚠️ ${res?.error?.slice(0, 160) || t('toast.noRemove')}`)
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
      showToast(t('toast.badEnv', { bad }))
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
    if (res?.ok) showToast(t('toast.exported', { file: res.path.split('/').pop() }))
    else if (!res?.canceled) showToast(`⚠️ ${res?.error || t('toast.noExport')}`)
  }
  // Copiar la configuración de otro perfil al de ahora, sin pasar por un archivo:
  // exportar/importar sirve para respaldar y migrar, no para esto.
  // Copiar de otro perfil sin pasar por un archivo, eligiendo QUÉ se lleva:
  // llevarse todo a ciegas puede pisar un squad bueno con uno vacío.
  const copyProfileConfig = async () => {
    const otros = (cfg?.profiles || []).filter((p) => p !== profile)
    if (!otros.length) return showToast(t('toast.noOtherProfile'))
    const desde = otros[0]
    const resumen = await window.oficina?.config?.profileSummary?.(desde)
    setCopyView({ desde, resumen, partes: { squad: true, personas: true, proyectos: false } })
  }

  const cambiaOrigen = async (desde) => {
    const resumen = await window.oficina?.config?.profileSummary?.(desde)
    setCopyView((v) => (v ? { ...v, desde, resumen } : v))
  }

  const haceCopia = async () => {
    const { desde, partes } = copyView || {}
    if (!partes || !Object.values(partes).some(Boolean)) return showToast(t('copy.nothing'))
    const res = await window.oficina?.config?.copyProfile?.({ desde, hacia: profile, partes })
    if (!res?.ok) {
      if (!res?.canceled) showToast(`⚠️ ${res?.error || ''}`, 6000)
      return
    }
    setCopyView(null)
    // lo que falló se dice aparte y en primer plano: un «copiado» a secas con
    // algo que no se copió es peor que un error, porque te lo crees
    if (res.fallidos?.length) showToast(t('copy.failed', { que: res.fallidos.join(', ') }), 10000)
    showToast(t('copy.done', { hacia: profile, que: (res.hechos || []).join(', ') }), 9000)
  }

  const importConfig = async () => {
    // si hay respaldos automáticos, ofrecerlos antes del selector de archivo
    const bks = (await window.oficina?.config?.backups?.()) || []
    if (bks.length) {
      const ultimo = new Date(bks[0].at).toLocaleDateString(locale(), { day: '2-digit', month: 'short' })
      const usarBackup = window.confirm(t('confirm.backups', { n: bks.length, s: plural(bks.length), last: ultimo }))
      if (!usarBackup) return
    }
    const res = await window.oficina?.config?.import()
    if (!res?.ok) {
      if (!res?.canceled) showToast(`⚠️ ${res?.error || t('toast.noImport')}`, 6000)
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
        showToast(t('toast.installingSkill', { name: cat.name, profile: prof }), 10000)
        await window.oficina?.skills?.install(prof, cat.id, cat.repo)
      }
    }
    const notes = []
    if (missing.length) notes.push(t('note.skillsNotMigrated', { list: [...new Set(missing)].join(', ') }))
    if (res.mcpSkipped?.length) notes.push(t('note.mcpReconnect', { list: res.mcpSkipped.join(', ') }))
    if (notes.length) {
      try {
        localStorage.setItem('oficina-import-note', notes.join(' · '))
      } catch {}
    }
    // recarga completa: tema, modelo, squad de ambos perfiles, plantillas y
    // preferencias se releen desde cero — importar de verdad importa TODO
    showToast(t('toast.imported'))
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
      showToast(t('toast.needOneAgent'))
      return
    }
    if (!target.enabled && draftEnabled >= MAX_ACTIVE) {
      showToast(t('toast.squadFull', { max: MAX_ACTIVE }))
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
    showToast(t('toast.avatarSet'))
  }
  // Modelo propio de un agente: aplica y persiste al instante (como el avatar).
  const setMemberModel = async (id, mdl) => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, model: mdl || null } : r)))
    if (!roster.some((r) => r.id === id)) return // rol aún no guardado: queda en el draft
    const updated = roster.map((r) => (r.id === id ? { ...r, model: mdl || null } : r))
    setRoster(updated)
    await window.oficina?.squad?.save(profile, updated)
    const name = updated.find((r) => r.id === id)?.name || id
    showToast(mdl ? t('toast.memberModel', { name, label: modelLabelOf(mdl) }) : t('toast.memberModelGlobal', { name }))
  }
  const setMemberEffort = async (id, ef) => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, effort: ef || null } : r)))
    if (!roster.some((r) => r.id === id)) return // rol aún no guardado: queda en el draft
    const updated = roster.map((r) => (r.id === id ? { ...r, effort: ef || null } : r))
    setRoster(updated)
    await window.oficina?.squad?.save(profile, updated)
    const name = updated.find((r) => r.id === id)?.name || id
    showToast(ef ? t('toast.memberEffort', { name, label: t(`effort.${ef}`) }) : t('toast.memberEffortGlobal', { name }))
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
      showToast(t('toast.needRoleName'))
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
      showToast(t('toast.roleUpdated', { name }))
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
    showToast(t('toast.roleCreated', { name }))
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
    showToast(t('toast.presetApplied', { label: preset.label }))
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
    showToast(t('toast.rolesRestored'))
  }

  const saveSquad = async () => {
    const clean = draft.map((r) => ({ ...r, name: r.name.trim() || metaOf(r).label }))
    // sin personajes duplicados entre los activos
    const active = clean.filter((r) => r.enabled)
    if (new Set(active.map(effectiveAvatar)).size !== active.length) {
      showToast(t('toast.dupAvatar'))
      return
    }
    // sin nombres duplicados entre los activos: el ruteo por nombre ("Ana, haz X")
    // sería ambiguo — siempre ganaría el primero
    const names = active.map((r) => norm(r.name))
    if (new Set(names).size !== names.length) {
      showToast(t('toast.dupName'))
      return
    }
    await window.oficina?.squad?.save(profile, clean)
    setRoster(clean)
    setAgentsOpen(false)
    showToast(
      t('toast.squadSaved', {
        list: clean
          .filter((r) => r.enabled)
          .slice(0, MAX_ACTIVE)
          .map((r) => `${metaOf(r).emoji} ${r.name}`)
          .join(' · '),
      })
    )
  }

  // ── Historial ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (busy || !messages.length || !convIdRef.current) return
    // Una conversación de subagente no tiene mensaje de usuario del que sacar
    // título, así que el autosave la guardaba como «conversación» y sin madre,
    // pisando el guardado bueno en cuanto abrías su pestaña. Sus metadatos son
    // los de su encargo y se conservan.
    const meta = subMetaRef.current[activeTabRef.current]
    const title = meta?.title || messages.find((m) => m.role === 'user')?.text.slice(0, 60) || 'conversación'
    window.oficina?.history?.save({
      id: convIdRef.current,
      title,
      parentId: meta?.parentId || null,
      profile,
      project,
      model,
      sessions: { ...sessionsRef.current },
      updatedAt: Date.now(),
      // `dur` viaja con el mensaje: si no, al reabrir la conversación del
      // historial se verían los tokens pero no lo que tardó
      messages: messages.map(({ role, text, who, to, artifact, atts, usage, dur }) => ({
        role,
        text,
        who,
        to,
        artifact,
        atts,
        usage,
        dur,
      })),
    })
  }, [busy, messages, profile, project, model])

  const toggleHist = async () => {
    if (!histOpen) {
      setHistList((await window.oficina?.history?.list(profile)) || [])
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
    const timer = setTimeout(async () => setHistContent((await window.oficina?.history?.search(q, profile)) || {}), 300)
    return () => clearTimeout(timer)
  }, [histQuery, histOpen])

  // lo que ve el panel: filtrado y anidado (lib/historial.js, con sus tests)
  const histAnidado = paraElPanel(histList, histQuery, histContent)

  // renombrar inline
  const [renaming, setRenaming] = useState(null) // {id, val} | null
  const commitRename = async () => {
    if (!renaming) return
    const { id, val } = renaming
    setRenaming(null)
    if (!val.trim()) return
    await window.oficina?.history?.rename(id, val)
    setHistList((await window.oficina?.history?.list(profile)) || [])
  }

  const togglePin = async (e, h) => {
    e.stopPropagation()
    await window.oficina?.history?.pin(h.id, !h.pinned)
    setHistList((await window.oficina?.history?.list(profile)) || [])
    showToast(h.pinned ? t('toast.unpinned') : t('toast.pinned'))
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
    tabStateRef.current[activeTab] = null // el hilo de esta pestaña se reemplaza
    showToast(Object.keys(saved).length ? t('toast.resumed') : t('toast.loaded'))
  }

  const deleteConvo = async (e, id) => {
    e.stopPropagation()
    const res = await window.oficina?.history?.remove(id)
    // se avisa de las hijas que cayeron con ella: borrar más de lo que se ve
    // marcado no puede pasar en silencio
    if (res?.hijas) showToast(t('toast.convChildrenDeleted', { n: res.hijas }))
    // si borraste la que tenías abierta, el hilo se va con ella; sin aviso de
    // «conversación nueva», que además se solaparía con el de las hijas
    if (id === convIdRef.current) clearConversation()
    setHistList((await window.oficina?.history?.list(profile)) || [])
  }

  const exportConvo = async (e, id) => {
    e.stopPropagation()
    const res = await window.oficina?.history?.export(id)
    if (res?.ok) showToast(t('toast.convExported', { file: res.path.split('/').pop() }))
    else if (!res?.canceled) showToast(t('toast.noConvExport'))
  }

  // ── Plantillas de prompts: snippets por perfil, accesibles con / ─────────
  const [snippets, setSnippets] = useState([])
  const [snipForm, setSnipForm] = useState(null) // formulario de nueva plantilla
  useEffect(() => {
    const raw = localStorage.getItem(`oficina-snippets-${profile}`)
    if (raw === null) {
      // perfil sin plantillas guardadas nunca: sembrar los ejemplos (borrables);
      // si el usuario las borra todas queda '[]' y no se re-siembran
      const seed = seedSnippets().map((s) => ({ ...s, id: crypto.randomUUID() }))
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

  // ── Dónde correr la app ────────────────────────────────────────────────────
  // Los dispositivos y los emuladores son de la MÁQUINA, no del proyecto: al
  // cambiar de carpeta o de perfil se conservan y solo se recalcula lo que sí
  // depende del proyecto —cuál es y qué configuraciones ofrece—, que se lee del
  // disco al instante. Antes se tiraba todo y había que esperar a que
  // `flutter devices` volviera a arrancar el toolchain (~8s).
  useEffect(() => {
    let vivo = true
    let timer = null
    if (!project) {
      setFlutterProj(null)
      setNpmProj(null)
      setMakeProj(null)
      setTargets(null)
      setDevicesView(null)
      return
    }
    // web/escritorio: sin dispositivos, el objetivo es un script del package.json
    window.oficina?.npmProject?.(project).then((n) => vivo && setNpmProj(n?.esNpm ? n : null))
    window.oficina?.makeProject?.(project).then((mk) => vivo && setMakeProj(mk?.esMake ? mk : null))
    window.oficina?.flutterProject?.(project).then((r) => {
      if (!vivo) return
      setFlutterProj(r || null)
      // la configuración elegida era del proyecto anterior: si allá no existe, fuera
      const nombres = (r?.configs || []).map((c) => c.name)
      setConfig((c) => (c && nombres.includes(c) ? c : ''))
      // el proceso principal SIEMPRE manda las listas ya filtradas para este
      // proyecto (vacías si no es Flutter): tomarlas tal cual, porque conservar
      // las anteriores dejaba a la vista los dispositivos del proyecto viejo
      const parcheProyecto = (prev) =>
        prev
          ? {
              ...prev,
              proyecto: r?.proyecto || null,
              proyectos: r?.proyectos || [],
              configs: r?.configs || [],
              plataformas: r?.plataformas || [],
              devices: r?.devices || [],
              emulators: r?.emulators || [],
            }
          : prev
      setTargets(parcheProyecto)
      if (!r?.esFlutter) {
        // sin proyecto Flutter el botón desaparece: el panel no puede quedarse
        // abierto y huérfano, y el vigía no tiene nada que vigilar
        setDevicesView(null)
        window.oficina?.flutterWatch?.({ on: false })
        return
      }
      // si el panel está abierto, se actualiza en el sitio en vez de quedarse
      // mostrando el proyecto anterior hasta cerrarlo y volver a abrirlo
      setDevicesView((v) => (v && !v.loading ? parcheProyecto(v) : v))
      window.oficina?.flutterWatchCwd?.(project)
      {
        // revalidar por detrás: pudo cambiarse el cable o el SDK del proyecto
        timer = setTimeout(() => {
          window.oficina?.flutterTargets?.(project).then((tg) => {
            if (!vivo || !tg?.ok) return
            setTargets(tg)
            setDevicesView((v) => (v && !v.loading ? tg : v))
          })
        }, 2500)
      }
    })
    return () => {
      vivo = false
      clearTimeout(timer)
    }
  }, [project, profile])

  // Eventos del `flutter run`: progreso de compilación, arranque, logs y parada.
  useEffect(() => {
    const parche = (id, campos) =>
      setRuns((rs) => (rs[id] ? { ...rs, [id]: { ...rs[id], ...campos } } : rs))
    const off = window.oficina?.onFlutterEvent?.((e) => {
      const id = e.deviceId
      if (e.kind === 'run-start') parche(id, { appId: e.appId, fase: 'compilando' })
      else if (e.kind === 'run-started') parche(id, { fase: 'corriendo', progreso: null })
      else if (e.kind === 'run-progress') parche(id, { progreso: e.progreso })
      else if (e.kind === 'run-url') parche(id, { url: e.url })
      else if (e.kind === 'run-error') parche(id, { error: e.error })
      else if (e.kind === 'run-stop') {
        setRuns((rs) => {
          if (!rs[id]) return rs
          const copia = { ...rs }
          delete copia[id]
          return copia
        })
        setFoco((f) => (f === id ? null : f))
        showToast(t('run.stopped'))
      } else if (e.kind === 'devices') {
        // enchufar o desenchufar: la lista se mantiene sola
        const fresco = { devices: e.devices || [], emulators: e.emulators || [] }
        setTargets((tg) => (tg ? { ...tg, ...fresco } : tg))
        setDevicesView((v) => (v && !v.loading ? { ...v, ...fresco } : v))
      } else if (e.kind === 'run-log') {
        setRunLogs((l) => [...l.slice(-400), { deviceId: id, texto: e.texto }])
      }
    })
    return off
  }, [])

  // Se guarda en un ref porque la llama el listener del stream, montado una vez.
  const autoRecargaRef = useRef(() => {})
  useEffect(() => {
    autoRecargaRef.current = (rutas) => {
      if (!autoReload || !Object.keys(runs).length) return
      clearTimeout(autoTimerRef.current)
      autoTimerRef.current = setTimeout(async () => {
        const res = await window.oficina?.flutterAutoReload?.({ cwd: project, paths: rutas })
        if (res?.sinCorridas) return
        if (res?.accion === 'recompilar') return showToast(t('run.needsRebuild', { motivo: res.motivo }), 8000)
        if (!res?.resultados) return
        const fallos = res.resultados.filter((r) => !r.ok)
        setRuns((prev) => {
          const copia = { ...prev }
          for (const r of res.resultados) if (copia[r.deviceId]) copia[r.deviceId] = { ...copia[r.deviceId], error: r.ok ? null : r.error || null }
          return copia
        })
        if (fallos.length) showToast(`⚠️ ${t('run.reloadFailed', { error: (fallos[0].error || '').slice(0, 90) })}`, 7000)
        else if (res.accion === 'restart') showToast(t('run.autoRestarted', { motivo: res.motivo || '' }), 5000)
        else showToast(t('run.autoReloaded', { motivo: res.motivo || 'reload' }))
      }, 1500)
    }
  }, [autoReload, runs, project])

  const correrEn = (d) => correrEnCon(d, config || undefined)

  const correrEnCon = async (d, cfgNombre) => {
    if (runs[d.id]) return showToast(t('run.busy'))
    // dos corridas de la misma plataforma comparten el directorio de build y se
    // pisan; lo hace cumplir el proceso principal, que es quien sabe qué corre
    setRuns((rs) => ({
      ...rs,
      [d.id]: { fase: 'compilando', device: d.name, platform: d.platform, appId: null, progreso: null, config: cfgNombre || null },
    }))
    const res = await window.oficina?.flutterRun?.({ cwd: project, deviceId: d.id, config: cfgNombre, platform: d.platform, deviceName: d.name })
    if (!res?.ok) {
      setRuns((rs) => {
        const copia = { ...rs }
        delete copia[d.id]
        return copia
      })
      showToast(res?.mismaPlataforma ? t('run.samePlatform', { device: res.device }) : `⚠️ ${res?.error || t('run.busy')}`, 8000)
    } else {
      setDevicesView(null) // el panel ya cumplió: manda la barra
    }
  }

  // El resultado es por dispositivo: un reload puede fallar en uno y no en otro.
  const aplicaResultados = (res, completa) => {
    const rs = res?.resultados || []
    setRuns((prev) => {
      const copia = { ...prev }
      for (const r of rs) if (copia[r.deviceId]) copia[r.deviceId] = { ...copia[r.deviceId], recargando: false, error: r.ok ? null : r.error || null }
      return copia
    })
    const fallos = rs.filter((r) => !r.ok)
    if (!fallos.length) return showToast(completa ? t('run.restarted') : t('run.reloaded'))
    if (rs.length > 1) showToast(`⚠️ ${t('run.partial', { n: fallos.length, total: rs.length })}`, 7000)
    else showToast(`⚠️ ${t('run.reloadFailed', { error: (fallos[0].error || '').slice(0, 90) })}`, 7000)
  }

  const recargar = async (completa) => {
    const objetivo = foco || undefined
    setRuns((rs) => {
      const copia = { ...rs }
      for (const id of Object.keys(copia)) if (!objetivo || id === objetivo) copia[id] = { ...copia[id], error: null, recargando: true }
      return copia
    })
    aplicaResultados(await window.oficina?.flutterReload?.({ completa, deviceId: objetivo }), completa)
  }

  const detener = async () => {
    await window.oficina?.flutterStop?.({ deviceId: foco || undefined })
  }

  // Cerrar un emulador que ya está arriba. Después se refresca la lista: el
  // dispositivo tiene que desaparecer de «disponibles ahora».
  const cerrarEmulador = async (em) => {
    setDevicesView((v) => (v ? { ...v, cerrando: em.id, error: null } : v))
    const res = await window.oficina?.flutterStopEmulator?.({ platform: em.platform, deviceId: em.deviceId })
    if (!res?.ok) {
      setDevicesView((v) => (v ? { ...v, cerrando: null, error: res?.error || null } : v))
      return
    }
    showToast(t('dev.emuClosed', { name: em.name }))
    // apagar tarda un momento en reflejarse en la lista de dispositivos
    await new Promise((r) => setTimeout(r, 2500))
    const t2 = await window.oficina?.flutterTargets?.(project)
    if (t2?.ok) setTargets(t2)
    setDevicesView((v) => (v ? (t2?.ok ? t2 : { ...v, cerrando: null }) : v))
  }

  // Refrescar NO es lo mismo que abrir: reutilizar el toggle cerraba el panel al
  // pulsar el botón de refrescar. Y si la consulta falla, el spinner tiene que
  // apagarse igual o se queda girando para siempre.
  const refrescaDevices = async () => {
    setDevicesView((v) => (v ? { ...v, refrescando: true, error: null } : v))
    try {
      const res = await window.oficina?.flutterTargets?.(project)
      if (res?.ok) {
        setTargets(res)
        setDevicesView((v) => (v ? res : v))
      } else {
        setDevicesView((v) =>
          v?.devices ? { ...v, refrescando: false, error: res?.error || null } : { error: res?.error || t('dev.none') }
        )
      }
    } catch (err) {
      setDevicesView((v) => (v ? { ...v, refrescando: false, error: String(err?.message || err).slice(0, 200) } : v))
    }
  }

  const correrScript = async (sc) => {
    const clave = `npm:${sc.name}`
    if (runs[clave]) return showToast(t('run.busy'))
    setRuns((rs) => ({ ...rs, [clave]: { fase: 'compilando', device: sc.name, tipo: 'npm', appId: null } }))
    const res = await window.oficina?.npmRun?.({ cwd: project, script: sc.name })
    if (!res?.ok) {
      setRuns((rs) => {
        const copia = { ...rs }
        delete copia[clave]
        return copia
      })
      showToast(`⚠️ ${res?.error || ''}`)
    } else {
      setDevicesView(null)
    }
  }

  const correrTarget = async (tg) => {
    const clave = `make:${tg.name}`
    if (runs[clave]) return showToast(t('run.busy'))
    // los que piden argumentos no se lanzan a ciegas: se preguntan
    const vars = {}
    for (const a of tg.args || []) {
      const v = window.prompt(t('make.needsArg', { target: tg.name, arg: a }), '')
      if (!v) return
      vars[a] = v
    }
    setRuns((rs) => ({ ...rs, [clave]: { fase: 'corriendo', device: tg.name, tipo: 'make', appId: null } }))
    const res = await window.oficina?.makeRun?.({ cwd: project, target: tg.name, vars })
    if (!res?.ok) {
      setRuns((rs) => {
        const copia = { ...rs }
        delete copia[clave]
        return copia
      })
      showToast(`⚠️ ${res?.error || ''}`)
    } else {
      setDevicesView(null)
    }
  }

  const openDevices = async () => {
    if (devicesView) {
      setDevicesView(null)
      window.oficina?.flutterWatch?.({ on: false })
      return
    }
    // un proyecto npm no tiene dispositivos que descubrir: se abre directo con
    // sus scripts, sin arrancar el toolchain ni el vigía
    if (!flutterProj?.esFlutter) return setDevicesView({ npm: npmProj, make: makeProj })
    // el vigía de enchufar/desenchufar vive con el panel: es un proceso Dart y
    // tenerlo siempre arriba costaría memoria para nada
    window.oficina?.flutterWatch?.({ cwd: project, on: true })
    // con la precarga hecha se abre con datos y se revalida por detrás; sin ella
    // (proyecto recién elegido) toca esperar
    setDevicesView(targets ? { ...targets, refrescando: true } : { loading: true })
    await refrescaDevices()
  }

  // Lanzar un emulador. El comando vuelve al disparar, no cuando el emulador ya
  // arrancó, así que después se sondea la lista hasta que aparezca el nuevo
  // dispositivo — si no, la UI diría «listo» con la pantalla todavía negra.
  const launchEmulator = async (em) => {
    const antes = new Set((devicesView?.devices || []).map((d) => d.id))
    setDevicesView((v) => (v ? { ...v, lanzando: em.id, error: null, aviso: null } : v))
    const res = await window.oficina?.flutterLaunchEmulator?.({ cwd: project, id: em.id })
    if (!res?.ok) {
      setDevicesView((v) => (v ? { ...v, lanzando: null, error: res?.error || t('dev.none') } : v))
      return
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      const t2 = await window.oficina?.flutterTargets?.(project)
      if (!t2?.ok) continue
      setTargets(t2)
      const nuevo = t2.devices.find((d) => !antes.has(d.id))
      setDevicesView((v) => (v ? { ...t2, lanzando: nuevo ? null : em.id } : v))
      if (nuevo) {
        showToast(t('dev.booted', { name: nuevo.name }))
        return
      }
    }
    setDevicesView((v) => (v ? { ...v, lanzando: null, aviso: t('dev.slowBoot') } : v))
  }

  // ── La rama en la que estás ───────────────────────────────────────────────
  //
  // El proyecto que se elige aquí suele ser la carpeta PADRE —la raíz del
  // workspace, para que los agentes carguen el contexto de ai-context— y el repo
  // de verdad está dentro. Así que la rama no se puede leer del proyecto: la
  // resuelve el main, que sabe elegir el repo (ver `repoEnJuego`).
  const [rama, setRama] = useState(null)
  // Cuál de los dos desplegables está abierto: 'repo', 'rama' o ninguno. Uno
  // solo, no dos banderas: abiertos a la vez se taparían entre ellos.
  const [gitOpen, setGitOpen] = useState(null)
  // Las ramas del repo, pedidas al abrir y no antes: son un `for-each-ref` por
  // repo y en el arranque no las mira nadie.
  const [ramas, setRamas] = useState(null)
  // Cuál de los repos de dentro elegiste para este proyecto. Por proyecto y por
  // cuenta, como el modelo o el permiso de edición: en un workspace trabajas
  // siempre en el mismo repo, y volver a elegirlo cada vez sería absurdo.
  const repoPrefKey = (p = project) => prefKey('oficina-repo', profile, p)
  const refrescaRama = async (cwd = project) => {
    if (!cwd) return setRama(null)
    const r = await window.oficina?.gitBranch?.({
      cwd,
      paths: editedPathsRef.current,
      // se lee directo y no con `leerPref`: la herencia del perfil traería la
      // ruta del repo de OTRO proyecto, que aquí no significa nada
      preferido: localStorage.getItem(repoPrefKey(cwd)) || '',
    })
    setRama(r?.ok ? r : null)
  }
  const eligeRepo = (dir) => {
    try {
      localStorage.setItem(repoPrefKey(), dir)
    } catch {}
    setGitOpen(null)
    setRamas(null) // son las del repo anterior
    refrescaRama(project)
  }
  // Filtro de la lista de ramas. Hace falta de verdad: en el repo del usuario hay
  // 131 ramas locales, y una lista de 131 nombres «feature/AWC-…» no se lee, se
  // busca. Se filtra aquí y no en git para que escribir no lance un proceso por
  // tecla.
  const [ramaQuery, setRamaQuery] = useState('')
  const abreRamas = async () => {
    if (gitOpen === 'rama') return setGitOpen(null)
    setGitOpen('rama')
    setRamaQuery('')
    setRamas({ cargando: true })
    const r = await window.oficina?.gitBranches?.({ root: rama?.root })
    setRamas(r?.ok ? r : { error: r?.error || t('git.noBranches') })
  }
  // Cuántas ramas se pintan de una vez. Con el filtro delante, más que esto no
  // aporta: si lo que buscas no está en las primeras, se escribe.
  const RAMAS_VISIBLES = 40
  const ramasFiltradas = (() => {
    const todas = ramas?.ramas || []
    const q = ramaQuery.trim().toLowerCase()
    const hay = q ? todas.filter((n) => n.toLowerCase().includes(q)) : todas
    return { visibles: hay.slice(0, RAMAS_VISIBLES), resto: Math.max(0, hay.length - RAMAS_VISIBLES), total: hay.length }
  })()
  // Cambiar de rama es un checkout de verdad: toca los archivos del disco.
  //
  // Con agentes trabajando NO se hace. Están leyendo y escribiendo en ese árbol,
  // y cambiarlo debajo de ellos rompe el turno sin dejar rastro de por qué.
  // Preferible negarse y decirlo.
  const cambiaRama = async (nombre) => {
    if (busy) return showToast(t('git.busy'), 5000)
    const r = await window.oficina?.gitCheckout?.({ root: rama?.root, rama: nombre })
    if (!r?.ok) {
      // el motivo viene de git: «local changes would be overwritten», etc. Se
      // muestra tal cual y con tiempo de leerlo, porque dice qué hacer.
      showToast(`⚠️ ${r?.error || t('git.switchFailed')}`, 9000)
      return
    }
    setGitOpen(null)
    setRamas(null)
    showToast(t('git.switched', { rama: nombre }))
    refrescaRama(project)
  }
  // Cuándo se vuelve a mirar. Una rama cambia por FUERA de esta app —haces
  // checkout en la terminal, o lo hace un agente en modo edición—, así que si
  // solo se leyera al elegir proyecto el HUD acabaría mintiendo:
  // al cambiar de proyecto o pestaña, al volver a la ventana, y al terminar un
  // turno (que es cuando un agente pudo haber cambiado de rama).
  useEffect(() => {
    refrescaRama(project)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, activeTab])
  useEffect(() => {
    if (!busy) refrescaRama(project)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])
  useEffect(() => {
    const alVolver = () => refrescaRama(project)
    window.addEventListener('focus', alVolver)
    return () => window.removeEventListener('focus', alVolver)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  // ── Vista de diff: cambios pendientes del proyecto (git diff HEAD) ───────
  const openDiff = async () => {
    setDiffView({ loading: true })
    const res = await window.oficina?.gitDiff?.({ cwd: project, paths: editedPathsRef.current })
    if (!res?.ok) setDiffView({ error: res?.error || t('err.noDiff') })
    else setDiffView({ diff: res.diff, untracked: res.untracked || [], repos: res.repos || [] })
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
      showToast(t('toast.needSlack'))
      openPrefs()
      return
    }
    // los reportes: mensajes del squad entre el arranque del standup y su cierre
    const start = messages.slice(0, idx).findLastIndex((m) => m.role === 'system' && /Standup diario/.test(m.text || ''))
    const reports = messages.slice(Math.max(start, 0), idx).filter((m) => m.role === 'assistant' && !m.error)
    if (!reports.length) {
      showToast(t('toast.noStandup'))
      return
    }
    const body = reports.map((m) => `### ${memberOf(m.who).name} (${memberOf(m.who).label})\n${(m.text || '').slice(0, 700)}`).join('\n\n')
    const target = squad.find((m) => m.id === 'pr')?.id || principal
    routeJob({
      id: crypto.randomUUID(),
      target,
      text: t('slack.shareStandup'),
      display: t('slack.shareDisplay', { chan }),
      prompt: t('prompt.shareStandup', { chan, body }),
      atts: [],
    })
  }

  // ── Standup programado: /standup solo a la hora configurada (días hábiles)
  const [standupAt, setStandupAt] = useState(() => localStorage.getItem('oficina-standup') || '')
  const saveStandupAt = (v) => {
    setStandupAt(v)
    localStorage.setItem('oficina-standup', v)
    showToast(v ? t('toast.standupOn', { h: v }) : t('toast.standupOff'))
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
          : routeMessage(text, squadRuteable, principal, ultimoRef.current)
        routeJob({ id: crypto.randomUUID(), target, text, display: `🔗 ${text}`, prompt: text, atts: [] })
        showToast(t('toast.deepLink', { name: memberOf(target).name }))
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
        if (window.confirm(t('confirm.standupCatchUp', { at }))) {
          scheduledStandupRef.current = true
          standupCmdRef.current()
        }
      }
    }
    const timer = setTimeout(() => check(true), 4000)
    const iv = setInterval(() => check(false), 30000)
    return () => {
      clearTimeout(timer)
      clearInterval(iv)
    }
  }, [])

  // ── Comandos locales ─────────────────────────────────────────────────────
  const handleLocalCommand = (text) => {
    const [cmd, ...rest] = text.split(/\s+/)
    if (cmd === '/model') {
      const arg = rest[0]?.toLowerCase()
      if (!arg) {
        showToast(t('toast.currentModel', { label: modelLabelOf(model) }))
        return true
      }
      const resolved = MODEL_ALIASES[arg] ?? arg
      setModel(resolved)
      showToast(t('toast.modelSet', { label: modelLabelOf(resolved) }))
      return true
    }
    // «/correr …» — lanzar sin abrir el panel. Si lo que se nombra es un
    // emulador que no está arriba, se arranca primero y se espera a que aparezca
    // como dispositivo; luego corre la app.
    if (cmd === '/correr' || cmd === '/run') {
      const frase = rest.join(' ')
      // sin Flutter pero con package.json, el objetivo es un script
      if (!flutterProj?.esFlutter) {
        if (!npmProj?.esNpm) {
          showToast(t('cmd.runNotRunnable'))
          return true
        }
        ;(async () => {
          const r = await window.oficina?.npmInterpreta?.({ cwd: project, texto: frase })
          if (!r?.ok) return showToast(`⚠️ ${r?.error || ''}`)
          // mismo criterio que con los dispositivos: ante la duda, no adivinar
          if (r.ambiguo) {
            setDevicesView({ npm: npmProj })
            return showToast(t('cmd.runScriptAmbiguous', { list: r.candidatos.map((c) => c.name).join(' · ') }), 8000)
          }
          if (!r.objetivo) {
            setDevicesView({ npm: npmProj })
            return showToast(t('cmd.runPickDevice', { config: '' }), 8000)
          }
          setMessages((ms) => [...ms, { role: 'system', text: t('cmd.runScript', { script: r.objetivo.name }) }])
          correrScript(r.objetivo)
        })()
        return true
      }
      showToast(t('cmd.runLooking'))
      ;(async () => {
        const r = await window.oficina?.flutterInterpretaCorrer?.({ cwd: project, texto: frase })
        if (!r?.ok) return showToast(`⚠️ ${r?.error || ''}`)
        if (r.config) setConfig(r.config.name)
        const cfgTxt = r.config ? ` · ${r.config.name}` : ''
        // Abrir el panel en vez de adivinar: lanzar en el dispositivo equivocado
        // cuesta una compilación de minutos, y el panel ya lista todo con su
        // botón de correr. La configuración interpretada queda preseleccionada.
        const alPanel = (aviso) => {
          setTargets(r)
          setDevicesView({ ...r, refrescando: false })
          showToast(aviso, 8000)
        }
        if (r.ambiguo) {
          return alPanel(t('cmd.runAmbiguous', { list: r.candidatos.map((c) => c.name).join(' · ') }))
        }
        let objetivo = r.objetivo
        // sin pistas: si hay un solo físico, es obvio a qué se refería
        if (!objetivo) {
          const fisicos = r.devices.filter((d) => d.tipo === 'fisico')
          if (fisicos.length === 1) objetivo = { tipo: 'dispositivo', item: fisicos[0] }
        }
        if (!objetivo) return alPanel(t('cmd.runPickDevice', { config: cfgTxt }))

        if (objetivo.tipo === 'emulador') {
          const em = objetivo.item
          if (!em.corriendo) {
            showToast(t('cmd.runBooting', { name: em.name }), 6000)
            const res = await window.oficina?.flutterLaunchEmulator?.({ cwd: project, id: em.id })
            if (!res?.ok) return showToast(t('cmd.runBootFailed', { name: em.name, error: res?.error || '' }), 8000)
          }
          // el emulador tarda en estar listo: se espera a que aparezca
          const antes = new Set(r.devices.map((d) => d.id))
          for (let i = 0; i < 20; i++) {
            await new Promise((res2) => setTimeout(res2, 4000))
            const tg = await window.oficina?.flutterTargets?.(project)
            if (!tg?.ok) continue
            setTargets(tg)
            const nuevo = tg.devices.find((d) => !antes.has(d.id)) || tg.devices.find((d) => d.tipo === 'emulador')
            if (nuevo) {
              setMessages((ms) => [
                ...ms,
                { role: 'system', text: t('cmd.runResolved', { device: nuevo.name, config: cfgTxt }) },
              ])
              return correrEnCon(nuevo, r.config?.name)
            }
          }
          return showToast(t('dev.slowBoot'), 8000)
        }
        setMessages((ms) => [
          ...ms,
          { role: 'system', text: t('cmd.runResolved', { device: objetivo.item.name, config: cfgTxt }) },
        ])
        correrEnCon(objetivo.item, r.config?.name)
      })()
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
        showToast(t('toast.allBusy'))
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
            ?.ask({ prompt: standupPrompt(), profile, cwd: project, writeMode: false, model: memberModel(m.id), effort: memberEffort(m.id), role: m.id, standup: true })
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
    showToast(t('toast.queuedFor', { name: memberOf(job.target).name }))
  }
  const dispatchJob = async (job) => {
    lastJobRef.current[job.target] = job
    tabDeRolRef.current[job.target] = activeTabRef.current // de quién es esta respuesta // para el botón Reintentar tras un error
    if (job.handoffTo) handoffsRef.current.push({ from: job.target, to: job.handoffTo, original: job.text, result: null })
    setMessages((ms) => {
      const has = ms.some((m) => m.jobId === job.id)
      const cleared = ms.map((m) => (m.jobId === job.id ? { ...m, queued: false } : m))
      return has ? cleared : [...cleared, { role: 'user', text: job.display, to: job.target, atts: job.atts, jobId: job.id }]
    })
    setRS(job.target, 'listening')
    popSound()
    if (job.target === principal) setStatus(t('status.thinking'))
    const res = await window.oficina.ask({
      prompt: job.prompt,
      profile,
      cwd: project,
      writeMode,
      model: memberModel(job.target),
      effort: memberEffort(job.target),
      role: job.target,
      standup: job.standup,
      // Repartir solo si lo pediste: la app ya no autoriza a delegar por su
      // cuenta. Ver `pideReparto`.
      repartir: !!job.repartir,
      // El repo que muestra el selector de rama: con él, el main carga su
      // CONTEXT.md de ai-context en la persona en vez de confiar en que el
      // agente vaya a buscarlo.
      repoActivo: rama?.root || '',
    })
    if (!res?.ok) {
      setMessages((ms) => [...ms, { role: 'assistant', who: job.target, text: `⚠️ ${res?.error || 'Error desconocido'}` }])
      setRS(job.target, 'idle')
      if (job.target === principal) setStatus(t('status.waiting'))
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
    if (!window.confirm(t('confirm.resumeQueue', { n, s: plural(n) }))) return
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
    showToast(t('toast.resumingQueue', { n: jobs.length, s: plural(jobs.length) }))
  }, [pendingRestore])

  // ── Estadísticas: acumulado diario por agente (tareas, tokens, tiempo) ───
  // Lo que se apunta de cada turno. Los cuatro últimos —entrada/salida, modelo,
  // hora y conversación— se añadieron con el panel nuevo, así que los días
  // anteriores no los tienen y todo lo que los lee trata su ausencia como normal
  // (ver lib/estadisticas.js). No se pudieron rellenar hacia atrás: el historial
  // guarda UNA fecha por conversación, y repartir sus tokens por días con eso
  // habría sido dibujar un gráfico inventado.
  const recordStat = (who, usage, ms, modelo, convId) => {
    try {
      const all = JSON.parse(localStorage.getItem('oficina-stats')) || {}
      // Fecha LOCAL, no UTC: con toISOString, a partir de las 19:00 en Bogotá el
      // trabajo de hoy se apuntaba al día siguiente.
      const day = claveDia(new Date())
      const d = (all[day] ||= { tasks: 0, tokens: 0, ms: 0, agents: {} })
      const a = (d.agents[who] ||= { tasks: 0, tokens: 0, ms: 0 })
      const entrada = usage ? (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) : 0
      const salida = usage ? usage.output_tokens || 0 : 0
      const tok = usage ? usageTotal(usage) : 0
      d.tasks += 1
      d.tokens += tok
      d.ms += ms
      d.in = (d.in || 0) + entrada
      d.out = (d.out || 0) + salida
      a.tasks += 1
      a.tokens += tok
      a.ms += ms
      // El modelo del turno, no el que esté seleccionado ahora: un tripulante
      // puede tener el suyo propio.
      if (modelo) {
        const m = ((d.modelos ||= {})[modelo] ||= { in: 0, out: 0, tasks: 0 })
        m.in += entrada
        m.out += salida
        m.tasks += 1
      }
      d.horas ||= {}
      d.horas[new Date().getHours()] = (d.horas[new Date().getHours()] || 0) + 1
      // Las conversaciones se guardan como conjunto y se cuentan al leer: un
      // contador se pasaría de largo con varios turnos del mismo hilo.
      if (convId) (d.convs ||= {})[convId] = 1
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
      .map((r) => `${new Date(r.t).toLocaleTimeString(locale())} · ${r.role} · ${r.kind}${r.info ? ` · ${r.info}` : ''}`)
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
        showToast(t('toast.quota', { pct: Math.round(pct), reset: fmtReset(s.claude.session.resetsAt) }), 6000)
      }
    })
  }

  // Aviso de colisión (#99): dos agentes editando el MISMO repo pueden
  // pisarse (git add -A cruzados, el mismo archivo a la vez). No se bloquea
  // —a veces es lo que quieres—, pero se advierte una vez por tarea.
  const warnCollision = (target) => {
    if (!writeMode) return
    // Solo cuentan los que trabajan en ESTE directorio: ver `quienColisiona`.
    const otros = quienColisiona({
      target,
      running,
      roleStates,
      proyecto: project,
      proyectoDe: (r) => proyectoDeTab(tabDeRolRef.current[r]),
    })
    if (!otros.length) return
    const quien = otros.map((r) => memberOf(r).name).join(', ')
    showToast(t('toast.collision', { who: quien, project: project.split('/').pop() }), 6000)
  }

  // sitúa un job: si el agente está libre y sin cola → va; si no → encola
  const routeJob = (job) => {
    // un agente solo hace un trabajo a la vez: si ya está en otra pestaña, se
    // dice, en vez de encolarlo donde no se va a ver
    if (
      decideDespacho({
        target: job.target,
        tabDeRol: tabDeRolRef.current,
        activa: activeTabRef.current,
        ocupado: !!roleStates[job.target],
        enCola: queuesRef.current[job.target]?.length > 0,
      }).accion === 'otra-pestana'
    ) {
      return showToast(t('toast.otherTab', { name: memberOf(job.target).name }), 6000)
    }
    atBottomRef.current = true // enviar algo re-engancha el auto-scroll
    checkQuota()
    warnCollision(job.target)
    const { accion } = decideDespacho({
      target: job.target,
      tabDeRol: tabDeRolRef.current,
      activa: activeTabRef.current,
      ocupado: !!roleStates[job.target],
      enCola: queuesRef.current[job.target]?.length > 0,
    })
    if (accion === 'encolar') enqueueJob(job)
    else dispatchJob(job)
  }

  // Reintenta el último job de un rol (tras un error).
  const retryJob = (who) => {
    const job = lastJobRef.current[who]
    if (job) routeJob({ ...job, id: crypto.randomUUID() })
  }

  // Saca un mensaje de la cola antes de que se despache (✕ en el chip "en cola").
  // Quita del chat un mensaje que se canceló. Un turno detenido o sacado de la
  // cola deja constancia de algo que NUNCA pasó, y en un hilo largo eso se
  // acumula. Se borra por jobId, que arrastra también la respuesta a medias si
  // quedara alguna.
  //
  // El historial se corrige solo: el autosave guarda la lista completa en cada
  // cambio. La excepción es quedarse sin mensajes —ahí el autosave hace
  // early-return— y entonces la conversación se borra, porque una entrada vacía
  // en el historial es justo el ruido que se está quitando.
  const borraMensaje = (m) => {
    setMessages((ms) => {
      const out = ms.filter((x) => (m.jobId ? x.jobId !== m.jobId : x !== m))
      if (!out.length && convIdRef.current) {
        window.oficina?.history?.remove(convIdRef.current)
        convIdRef.current = null
      }
      return out
    })
  }

  const cancelQueued = (m) => {
    const q = queuesRef.current[m.to]
    if (q) queuesRef.current[m.to] = q.filter((j) => j.id !== m.jobId)
    syncQueues()
    setMessages((ms) => ms.map((x) => (x.jobId === m.jobId ? { ...x, queued: false, cancelled: true } : x)))
    showToast(t('toast.dequeued'))
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
      showToast(t('toast.noElectron'))
      return
    }
    // "@todos <mensaje>": el mismo prompt a todos los agentes libres a la vez
    const bcast = /^@?todos[\s,:]+/i.exec(text)
    if (bcast) {
      const rest = text.slice(bcast[0].length).trim()
      if (!rest) {
        showToast(t('toast.needBcastText'))
        return
      }
      const free = squad.filter((m) => !roleStates[m.id] && !(queuesRef.current[m.id]?.length > 0))
      if (!free.length) {
        showToast(t('toast.allBusy'))
        return
      }
      if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
      // un solo jobId compartido: el mensaje del usuario se pinta una vez
      checkQuota()
      const sharedId = crypto.randomUUID()
      free.forEach((m, i) =>
        setTimeout(() => dispatchJob({ id: sharedId, target: m.id, text: rest, display: t('toast.bcastPrefix', { text: rest }), prompt: rest, atts: [] }), i * 400)
      )
      showToast(t('toast.bcastSent', { n: free.length, s: plural(free.length) }))
      setInput('')
      setAttachments([])
      setRefs([])
      if (inputRef.current) inputRef.current.style.height = 'auto'
      return
    }
    const target = routeMessage(text, squadRuteable, principal, ultimoRef.current)
    if (!convIdRef.current) convIdRef.current = crypto.randomUUID()
    const handoffTo = detectHandoff(text, squad, target)
    // adjuntos: imágenes (Read) y carpetas/archivos del disco (Glob/Read)
    const atts = attachments
    const rfs = refs
    let prompt = text || (rfs.length ? 'Haz un breve resumen de los documentos.' : 'Describe y analiza las imágenes adjuntas.')
    // «/repartir …»: forzar el reparto en vez de esperar a que el modelo lo vea.
    // Se le quita el prefijo a lo que se muestra —el chat enseña lo que pediste,
    // no la instrucción interna— pero el encargo que viaja sí la lleva.
    // `/repartir …` o pedirlo con palabras. Sin esto el agente NO reparte:
    // antes se le autorizaba en cada mensaje y un encargo con una lista de
    // tareas dentro se repartía solo.
    const repartir = pideReparto(prompt)
    const conComando = /^\/repartir\s+/i.test(prompt)
    if (conComando) {
      prompt = prompt.replace(/^\/repartir\s+/i, '')
      prompt =
        `Reparte este encargo entre compañeros con la herramienta Agent, una parte independiente por cada uno, ` +
        `en vez de hacerlo tú solo. Si de verdad no se puede partir, dilo en una frase y hazlo tú.\n\n${prompt}`
    }
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
      display: (conComando ? text.replace(/^\/repartir\s+/i, '') : text) || (rfs.length ? '📁' : '🖼'),
      prompt,
      repartir,
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
            title={t('ctx.title')}
          >
            <span className="ctx-ico">{profile === 'work' ? <IconWork size={16} /> : profile === 'private' ? <IconPrivate size={16} /> : <IconPerson size={16} />}</span> {profile}
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
                        // El PROYECTO se puede cambiar con gente trabajando: el
                        // proceso ya arrancó con su directorio y su hilo se queda
                        // en su pestaña. La CUENTA no: cambia el
                        // CLAUDE_CONFIG_DIR, el squad y el escritorio entero.
                        disabled={busy && p !== profile}
                        title={busy && p !== profile ? t('ctx.profileBusy') : ''}
                        onClick={() => changeProfile(p)}
                      >
                        <span className="ctx-ico">
                          {p === 'work' ? <IconWork size={15} /> : p === 'private' ? <IconPrivate size={15} /> : <IconPerson size={15} />}
                        </span>
                        {p}
                      </button>
                    ))}
                  </div>
                )}
                {projects
                  .filter((p) => !(p.padre && plegados.has(p.padre)))
                  .map((p) => {
                    const hijos = projects.filter((x) => x.padre === p.path).length
                    return (
                  <div key={p.path} className={p.padre ? 'ctx-row hijo' : 'ctx-row'}>
                    {/* La flecha pliega la raíz. Va antes del nombre y es un botón
                        aparte: pulsar el nombre debe SELECCIONAR el proyecto, no
                        plegarlo. */}
                    {hijos > 0 ? (
                      <button
                        type="button"
                        className={plegados.has(p.path) ? 'ctx-caret-btn' : 'ctx-caret-btn abierto'}
                        title={plegados.has(p.path) ? t('ctx.expand') : t('ctx.collapse')}
                        aria-expanded={!plegados.has(p.path)}
                        onClick={(e) => {
                          e.stopPropagation()
                          alternaPlegado(p.path)
                        }}
                      >
                        <IconChevron size={12} />
                      </button>
                    ) : (
                      <span className="ctx-caret-hueco" />
                    )}
                    <button
                      type="button"
                      className={p.path === project ? 'ctx-item on' : 'ctx-item'}
                      title={p.path}
                      onClick={() => {
                        selectProject(p.path)
                        setCtxOpen(false)
                      }}
                    >
                      <span className="ctx-ico">
                        {p.name.startsWith('📌') ? <IconPin size={15} /> : <IconFolder size={15} />}
                      </span>
                      {p.name.replace(/^(🗂|📌)\s*/, '')}
                      {/* Cuántos esconde: plegado sin esto parece una carpeta vacía */}
                      {hijos > 0 && plegados.has(p.path) && <span className="ctx-cuenta">{hijos}</span>}
                    </button>
                    {/* Quitarlo de la lista. No borra nada del disco: solo deja de
                        ofrecerlo, y por eso el aviso lo dice explícitamente. */}
                    <button
                      type="button"
                      className="ctx-del"
                      title={t('ctx.removeProject')}
                      aria-label={t('ctx.removeProject')}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeProjectFlow(p)
                      }}
                    >
                      <IconClose size={11} />
                    </button>
                  </div>
                    )
                  })}
                <button
                  type="button"
                  className="ctx-item ctx-add"
                  onClick={async () => {
                    await addProjectFlow()
                    setCtxOpen(false)
                  }}
                >
                  <span className="ctx-ico"><IconAdd size={15} /></span>
                  {t('ctx.addProject')}
                </button>
              </div>
            </>
          )}
        </div>
        {/* La rama, al lado del proyecto porque es el mismo dato: dónde estás
            trabajando. El nombre del repo solo se muestra si NO es el proyecto
            elegido —el caso de la raíz del workspace con el repo dentro—; cuando
            coinciden, repetirlo sería ruido. */}
        {rama && (
          <div className="gitwrap">
            {/* Selector de REPO. Solo cuando el proyecto es una carpeta con
                varios repos dentro: si el proyecto ES el repo no hay nada que
                elegir, y un desplegable de una sola opción es un botón que
                miente. */}
            {(rama.dentro?.length || 0) > 1 && (
              <button
                type="button"
                className={gitOpen === 'repo' ? 'gitsel on' : 'gitsel'}
                onClick={() => setGitOpen((o) => (o === 'repo' ? null : 'repo'))}
                title={t('git.repoSelTitle')}
              >
                <span className="gitsel-txt">{rama.repo}</span>
                <span className="ctx-caret">▾</span>
              </button>
            )}
            {/* Selector de RAMA. Siempre: aunque el repo sea único, cambiar de
                rama sigue teniendo sentido. */}
            <button
              type="button"
              className={[gitOpen === 'rama' ? 'gitsel on' : 'gitsel', rama.suelta ? 'suelta' : ''].filter(Boolean).join(' ')}
              onClick={abreRamas}
              title={rama.suelta ? t('git.detachedTitle', { repo: rama.repo, sha: rama.rama }) : t('git.branchSelTitle', { repo: rama.repo, rama: rama.rama })}
            >
              <IconBranch size={12} />
              <span className="gitsel-txt">{rama.rama}</span>
              <span className="ctx-caret">▾</span>
            </button>
            {gitOpen && (
              <>
                <div className="ctx-backdrop" onClick={() => setGitOpen(null)} />
                <div className={gitOpen === 'repo' ? 'git-pop' : 'git-pop derecha'}>
                  {gitOpen === 'repo' ? (
                    <>
                      <div className="git-pop-head">{t('git.pickHead')}</div>
                      {rama.dentro.map((r) => (
                        <button
                          key={r.dir}
                          type="button"
                          className={r.dir === rama.root ? 'git-item on' : 'git-item'}
                          onClick={() => eligeRepo(r.dir)}
                        >
                          <span className="git-item-repo">{r.repo}</span>
                          <span className={r.suelta ? 'git-item-rama suelta' : 'git-item-rama'}>
                            <IconBranch size={11} /> {r.rama}
                          </span>
                        </button>
                      ))}
                    </>
                  ) : (
                    <>
                      <div className="git-pop-head">{t('git.branchesHead', { repo: rama.repo })}</div>
                      {ramas?.cargando && <div className="git-pop-msg">{t('git.loading')}</div>}
                      {ramas?.error && <div className="git-pop-msg err">{ramas.error}</div>}
                      {(ramas?.ramas?.length || 0) > 8 && (
                        <input
                          className="git-filtro"
                          autoFocus
                          placeholder={t('git.filterPh', { n: ramas.ramas.length })}
                          value={ramaQuery}
                          onChange={(e) => setRamaQuery(e.target.value)}
                          onKeyDown={(e) => {
                            // Enter con un solo resultado cambia a esa rama: con el
                            // filtro escrito, apuntar con el ratón es un paso de más.
                            if (e.key === 'Enter' && ramasFiltradas.total === 1 && ramasFiltradas.visibles[0] !== ramas.actual) {
                              cambiaRama(ramasFiltradas.visibles[0])
                            }
                            if (e.key === 'Escape') setGitOpen(null)
                            e.stopPropagation() // que Esc no cierre además otros paneles
                          }}
                        />
                      )}
                      {ramasFiltradas.visibles.map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={n === ramas.actual ? 'git-item on' : 'git-item'}
                          onClick={() => (n === ramas.actual ? setGitOpen(null) : cambiaRama(n))}
                          title={n}
                        >
                          <span className="git-item-repo">{n}</span>
                          {n === ramas.actual && <span className="git-item-rama">{t('git.here')}</span>}
                        </button>
                      ))}
                      {/* Lo que no cabe se dice, en vez de recortar en silencio */}
                      {ramasFiltradas.resto > 0 && <div className="git-pop-msg">{t('git.more', { n: ramasFiltradas.resto })}</div>}
                      {!ramas?.cargando && !ramas?.error && ramasFiltradas.total === 0 && (
                        <div className="git-pop-msg">{t('git.noMatch', { q: ramaQuery.trim() })}</div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <div className="hud-actions">
          {/* secundarias en ícono-solo (tooltip); la primaria es "+ Nueva" */}
          {/* solo con un proyecto Flutter delante: en un microservicio no pinta nada */}
          {(flutterProj?.esFlutter || npmProj?.esNpm || makeProj?.esMake) && (
            <button
              type="button"
              className={devicesView ? 'iconbtn devbtn on' : 'iconbtn devbtn'}
              aria-label={t('hud.devicesLabel')}
              onClick={openDevices}
              title={t('hud.devices')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" />
                <line x1="10" y1="18.5" x2="14" y2="18.5" />
              </svg>
            </button>
          )}
          <button type="button" className="iconbtn" aria-label={t('hud.docsLabel')} onClick={toggleArts} title={t('hud.docs')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </button>
          {/* Historial y Configuración se pueden abrir mientras el squad trabaja:
              sus controles internos ya se deshabilitan solos cuando aplica */}
          <button type="button" className="iconbtn" aria-label={t('hud.history')} onClick={toggleHist} title={t('hud.historyKey')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button type="button" className="primarybtn" aria-label={t('hud.newChat')} onClick={newChat} disabled={busy} title={t('hud.newChatKey')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{t('hud.new')}</span>
          </button>
          <button type="button" className="iconbtn gearspin" aria-label={t('hud.settings')} onClick={openPrefs} title={t('hud.settingsKey')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <div className="stage">
        <SysMonitor
          innerRef={setMonNodo}
          profile={profile}
          model={model}
          modelLabel={modelLabelOf(model)}
          tokens={convTokens}
          contexto={ctxUsado}
        />
        {/* Quién está trabajando: contenedor propio, justo debajo del monitor.
            El alto del monitor cambia (sesión, semana, aviso de cuota), así que
            se mide en vez de fijar un top a ojo. */}
        {running.filter((r) => roleStates[r] !== 'delivering').length > 0 && (
          <div className="stopbar" ref={setChipsNodo} style={{ top: 14 + monAlto + 10, visibility: monAlto ? 'visible' : 'hidden' }}>
            <div className="mon-title">
              <IconPerson size={13} /> {t('mon.workers')}
            </div>
            {running
              .filter((r) => roleStates[r] !== 'delivering')
              .map((r) => (
                <button
                  key={r}
                  className="stopchip"
                  onClick={() => window.oficina?.stop?.(r)}
                  title={t('chat.stop', { name: memberOf(r).name })}
                >
                  ⏹ {memberOf(r).name}
                  {elapsed[r] ? ` · ${elapsed[r]}` : ''}
                </button>
              ))}
          </div>
        )}
        <Suspense fallback={null}>
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
          petHeight={PETS.find((p2) => p2.id === pet)?.height || 0.55}
          quality={quality}
          director={director}
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
        </Suspense>

        {prefsOpen && (
          <div className="drawer">
            <div className="drawer-head">
              <b>{t('panel.settings')}</b>
              <button onClick={() => setPrefsOpen(false)}><IconClose size={16} /></button>
            </div>

            {/* navegación: filas de menú (ícono · label · chevron) */}
            <div className="menu-group">
              <button type="button" className="menu-item" onClick={openAgents}>
                <span className="mi-icon"><IconAgents /></span>
                <span className="mi-label">{t('menu.agents')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={async () => {
                  const r = await window.oficina?.openClaudeMd?.(project)
                  showToast(r?.ok ? t('toast.claudeMdOpen') : t('toast.noClaudeMd'))
                  setHasClaudeMd(true)
                }}
              >
                <span className="mi-icon"><IconBook /></span>
                {/* el ✓ distingue «abrir el que ya existe» de «crear uno nuevo» */}
                <span className="mi-label">
                  {t('menu.claudeMd')}
                  {hasClaudeMd && <IconCheck size={13} />}
                </span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              <button type="button" className="menu-item" onClick={openSkills}>
                <span className="mi-icon"><IconSkills /></span>
                <span className="mi-label">{t('menu.skills')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              <button type="button" className="menu-item" onClick={openMcp}>
                <span className="mi-icon"><IconMcp /></span>
                <span className="mi-label">{t('menu.mcp')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              <button type="button" className="menu-item" onClick={openStats}>
                <span className="mi-icon"><IconStats /></span>
                <span className="mi-label">{t('menu.stats')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              <button type="button" className="menu-item" onClick={openDiag}>
                <span className="mi-icon"><IconDiag /></span>
                <span className="mi-label">{t('menu.diag')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              <button type="button" className="menu-item" onClick={() => window.oficina?.openHelp?.(getLang())}>
                <span className="mi-icon"><IconBook /></span>
                <span className="mi-label">{t('menu.guide')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  closePanels()
                  setTourOpen(true)
                }}
              >
                <span className="mi-icon"><IconTour /></span>
                <span className="mi-label">{t('menu.tour')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={async () => {
                  const res = await window.oficina?.openTerminal?.(project)
                  showToast(res?.ok ? t('toast.openingTerm', { app: res.app }) : t('toast.noTerm'))
                }}
              >
                <span className="mi-icon"><IconTerminal /></span>
                <span className="mi-label">{t('menu.terminal')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              {(cfg?.profiles?.length || 0) > 1 && (
              <button type="button" className="menu-item" onClick={copyProfileConfig}>
                <span className="mi-icon"><IconCopy /></span>
                <span className="mi-label">{t('menu.copyProfile')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              )}
              <button type="button" className="menu-item" onClick={exportConfig}>
                <span className="mi-icon"><IconExport /></span>
                <span className="mi-label">{t('menu.export')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              <button type="button" className="menu-item" onClick={importConfig}>
                <span className="mi-icon"><IconImport /></span>
                <span className="mi-label">{t('menu.import')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              <button type="button" className="menu-item" onClick={() => setPrefsPanelOpen(true)}>
                <span className="mi-icon"><IconTune /></span>
                <span className="mi-label">{t('menu.prefs')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
              {/* Buscar a mano. Existe porque esperar a que la app pregunte sola
                  no se distingue de que el auto-update esté roto: hasta que algo
                  contesta, las dos situaciones se ven exactamente igual. */}
              <button
                type="button"
                className="menu-item"
                onClick={async () => {
                  showToast(t('upd.checking'))
                  const r = await window.oficina?.checkUpdate?.()
                  if (r?.estado === 'descargando') return showToast(t('upd.downloading', { v: r.version }))
                  if (r?.estado === 'lista') return showToast(t('upd.ready', { v: r.version }))
                  if (r?.estado === 'aldia') return showToast(t('upd.uptodate', { v: r.version }))
                  if (r?.estado === 'nodisponible') return showToast(t('upd.unavailable'), 6000)
                  showToast(t('upd.checkFailed', { err: r?.error || '?' }), 7000)
                }}
              >
                <span className="mi-icon"><IconDownload /></span>
                <span className="mi-label">{t('menu.update')}</span>
                <span className="mi-chev"><IconChevron /></span>
              </button>
            </div>


            <div className="menu-foot">La Oficina{appVersion ? ` · v${appVersion}` : ''}</div>
          </div>
        )}

        <ActividadPanel
          open={actOpen}
          onClose={() => setActOpen(false)}
          pasos={actividad}
          proyecto={project}
          memberOf={memberOf}
          trabajando={busy}
          conversacion={project ? project.split('/').pop() : ''}
        />
        <DiagPanel open={diagOpen} onClose={() => setDiagOpen(false)} rows={diagRows} text={diagText} memberOf={memberOf} onRefresh={openDiag} toast={showToast} />

        {prefsPanelOpen && (
          <div className="drawer over">
            <div className="drawer-head">
              <b>{t('panel.prefs')}</b>
              <button onClick={() => setPrefsPanelOpen(false)} title={t('panel.back')}><IconClose size={16} /></button>
            </div>
            <div className="menu-group">
            <div className="pref-row">
              <span className="pref-label">{t('pref.appearance')}</span>
              <select className="sel pref-sel" value={appearance} onChange={(e) => setAppearance(e.target.value)}>
                <option value="auto">{t('pref.appAuto')}</option>
                <option value="light">{t('pref.appLight')}</option>
                <option value="dark">{t('pref.appDark')}</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.lang')}</span>
              <select className="sel pref-sel" value={lang} onChange={(e) => changeLang(e.target.value)}>
                {LANGS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.model')}</span>
              <select className="sel pref-sel" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
                {[...new Set([model, ...Object.keys(MODEL_OPTIONS)])].map((id) => (
                  <option key={id} value={id}>
                    {modelLabelOf(id)}
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row" title={t('pref.effortTitle')}>
              <span className="pref-label">{t('pref.effort')}</span>
              {/* vacío = no se pasa --effort y manda el default del CLI, que es
                  lo que hacía la app hasta ahora: así actualizar no cambia el
                  comportamiento de nadie sin que lo pida */}
              <select className="sel pref-sel" value={effort} onChange={(e) => setEffort(e.target.value)} disabled={busy}>
                <option value="">{t('pref.effortAuto')}</option>
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {t(`effort.${e}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.intro')}</span>
              <select className="sel pref-sel" value={introOn ? '1' : '0'} onChange={(e) => saveIntro(e.target.value === '1')}>
                <option value="1">{t('pref.introOn')}</option>
                <option value="0">{t('pref.introOff')}</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.quality')}</span>
              <select className="sel pref-sel" value={quality} onChange={(e) => saveQuality(e.target.value)}>
                <option value="cine">{t('pref.qCine')}</option>
                <option value="normal">{t('pref.qNormal')}</option>
                <option value="ligera">{t('pref.qLight')}</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.camera')}</span>
              <select className="sel pref-sel" value={director ? '1' : '0'} onChange={(e) => saveDirector(e.target.value === '1')}>
                <option value="0">{t('pref.camFixed')}</option>
                <option value="1">{t('pref.camDirector')}</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.pet')}</span>
              <select className="sel pref-sel" value={pet} onChange={(e) => savePet(e.target.value)}>
                <option value="">{t('pref.noPet')}</option>
                {PETS.map((p2) => (
                  <option key={p2.id} value={p2.id}>
                    {p2.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.slack')}</span>
              <input
                className="sel pref-sel"
                placeholder={t('pref.slackPh')}
                value={slackChannel}
                onChange={(e) => saveSlackChannel(e.target.value)}
              />
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.standup')}</span>
              <select className="sel pref-sel" value={standupAt} onChange={(e) => saveStandupAt(e.target.value)}>
                <option value="">{t('pref.standupOff')}</option>
                {['08:00', '08:30', '09:00', '09:30', '10:00', '11:00', '12:00'].map((h) => (
                  <option key={h} value={h}>
                    {t('pref.weekdays', { h })}
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.perm')}</span>
              <select
                className="sel pref-sel"
                value={writeMode ? 'write' : 'read'}
                onChange={(e) => setWritePermission(e.target.value === 'write')}
                disabled={busy}
              >
                <option value="write">{t('pref.permWrite')}</option>
                <option value="read">{t('pref.permRead')}</option>
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.theme')}</span>
              <select className="sel pref-sel" value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="auto">{t('pref.themeAuto')}</option>
                {Object.entries(THEMES).map(([id, th]) => (
                  <option key={id} value={id}>
                    {th.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.docs')}</span>
              <button type="button" className="pref-toggle" onClick={pickArtsDir} title={artsDir}>
                <IconFolder size={13} /> …{artsDir.slice(-30) || t('pref.defaultFolder')}
              </button>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.board')}</span>
              <button
                type="button"
                className={board ? 'pref-toggle on' : 'pref-toggle'}
                onClick={() => setBoard((b) => !b)}
                title={t('pref.boardTitle')}
              >
                <>
                <IconBoard size={13} /> {board ? t('pref.boardOn') : t('pref.boardOff')}
              </>
              </button>
              <button
                type="button"
                className="newchat"
                style={{ flex: 'none' }}
                onClick={async () => {
                  const res = await window.oficina?.openBoard?.(project)
                  showToast(res?.ok ? t('toast.openingBoard') : t('toast.restartApp'))
                }}
                title={t('pref.boardOpenTitle')}
              >
                {t('pref.boardOpen')}
              </button>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.sound')}</span>
              <button
                type="button"
                className={sound ? 'pref-toggle on' : 'pref-toggle'}
                onClick={() => setSound((s) => !s)}
                title={sound ? t('pref.soundOnTitle') : t('pref.soundOffTitle')}
              >
                {sound ? <IconBell size={13} /> : <IconBellOff size={13} />} {sound ? t('pref.soundOn') : t('pref.soundOff')}
              </button>
            </div>
            <div className="pref-row">
              <span className="pref-label">{t('pref.notif')}</span>
              <button
                type="button"
                className={notif ? 'pref-toggle on' : 'pref-toggle'}
                onClick={() => setNotif((s) => !s)}
                title={notif ? t('pref.notifOnTitle') : t('pref.notifOffTitle')}
              >
                {notif ? <IconBell size={13} /> : <IconBellOff size={13} />} {notif ? t('pref.notifOn') : t('pref.notifOff')}
              </button>
            </div>
            </div>
          </div>
        )}

        <StatsPanel open={statsOpen} onClose={() => setStatsOpen(false)} data={statsData} memberOf={memberOf} />

        {mcpOpen && (
          <div className="drawer over">
            <div className="drawer-head">
              <b>{t('panel.mcp')} · {profile}</b>
              <button onClick={() => setMcpOpen(false)} title={t('panel.back')}><IconClose size={16} /></button>
            </div>
            <div className="skills-note">{t('mcp.note')}</div>
            {mcpList === null && <div className="hist-empty">{t('mcp.loading')}</div>}
            {mcpList !== null && (
              <>
                {mcpList.length === 0 && (
                  <div className="hist-empty">{t('mcp.empty')}</div>
                )}
                {MCP_CATALOG.map((s) => {
                  const inst = mcpList.some((x) => x.name === s.id)
                  return (
                    <div key={s.id} className="hist-item skill-item">
                      <div className="skill-info">
                        <div className="hist-title">
                          {s.name} {inst && <span className="skill-ok"><IconCheck size={12} /> {t('mcp.connected')}</span>}
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
                          <span className="skill-busy"><IconSpinner /></span>
                        ) : inst ? (
                          <button title={t('mcp.remove')} onClick={() => removeMcp(s.id)}><IconTrash size={14} /></button>
                        ) : s.manual ? (
                          <button
                            className="skill-manual"
                            title={t('mcp.howToTitle')}
                            onClick={() => window.open(s.link)}
                          >
                            {t('mcp.howTo')}
                          </button>
                        ) : s.needsEnv ? (
                          <button
                            className="skill-install"
                            title={t('mcp.needsEnv', { env: s.needsEnv })}
                            onClick={() => setMcpForm({ name: s.id, target: s.cmd.join(' '), envs: `${s.needsEnv}=` })}
                          >
                            {t('mcp.connectDots')}
                          </button>
                        ) : (
                          <button className="skill-install" onClick={() => addMcp(s)}>{t('mcp.connect')}</button>
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
                          {x.name} <span className="skill-ok"><IconCheck size={12} /> {t('mcp.connected')}</span>
                        </div>
                        <div className="hist-meta">{x.spec}</div>
                      </div>
                      <div className="art-actions">
                        {mcpBusy === x.name ? (
                          <span className="skill-busy"><IconSpinner /></span>
                        ) : (
                          <button title={t('mcp.remove')} onClick={() => removeMcp(x.name)}><IconTrash size={14} /></button>
                        )}
                      </div>
                    </div>
                  ))}
                {/* lo que ve el CLI: conectores de la cuenta claude.ai y servers
                    configurados desde la terminal (solo lectura desde aquí) */}
                <div className="menu-sec">{t('mcp.fromAccount')}</div>
                {mcpAccount?.loading && <div className="hist-empty">{t('mcp.cliLoading')}</div>}
                {mcpAccount?.error && <div className="hist-empty"><IconWarn size={13} /> {mcpAccount.error}</div>}
                {mcpAccount?.servers &&
                  (() => {
                    const extra = mcpAccount.servers.filter((s) => !mcpList.some((x) => x.name === s.name))
                    if (!extra.length) return <div className="hist-empty">{t('mcp.nothingElse')}</div>
                    return extra.map((s) => (
                      <div key={s.name} className="hist-item skill-item">
                        <div className="skill-info">
                          <div className="hist-title">
                            {s.name}{' '}
                            <span className={s.status.startsWith('✔') ? 'skill-ok' : 'mcp-warn'}>
                              {s.status.startsWith('✔') ? t('mcp.connected') : s.status.replace(/^!\s*/, t('mcp.attention'))}
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
                      placeholder={t('mcp.namePh')}
                      value={mcpForm.name}
                      onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
                      autoFocus
                    />
                    <input
                      placeholder={t('mcp.targetPh')}
                      value={mcpForm.target}
                      onChange={(e) => setMcpForm({ ...mcpForm, target: e.target.value })}
                    />
                    <textarea
                      placeholder={t('mcp.envsPh')}
                      rows={2}
                      value={mcpForm.envs || ''}
                      onChange={(e) => setMcpForm({ ...mcpForm, envs: e.target.value })}
                    />
                    <div className="snip-form-row">
                      <button type="button" onClick={() => setMcpForm(null)}>{t('common.cancel')}</button>
                      <button
                        type="button"
                        className="snip-save"
                        disabled={!mcpForm.name.trim() || !mcpForm.target.trim()}
                        onClick={addMcpCustom}
                      >
                        {t('mcp.connect')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="snip-new" onClick={() => setMcpForm({ name: '', target: '' })}>
                    <IconAdd size={14} /> {t('mcp.other')}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {skillsOpen && (
          <div className="drawer over">
            <div className="drawer-head">
              <b>{t('panel.skills')} · {profile}</b>
              <button onClick={() => setSkillsOpen(false)} title={t('panel.back')}><IconClose size={16} /></button>
            </div>
            <div className="skills-note">
              {t('skills.note', { dir: profile === 'work' ? '~/.claude-work' : '~/.claude-private' })}
            </div>
            {installedSkills?.length > 0 && (
              <div className="diag-actions">
                <button type="button" className="skill-manual" onClick={updateAllSkills} disabled={skillsUpdating}>
                  {skillsUpdating ? t('skills.updating') : t('skills.updateAll')}
                </button>
              </div>
            )}
            {installedSkills === null && <div className="hist-empty">{t('skills.loading')}</div>}
            {installedSkills !== null && (
              <>
                {installedSkills.length === 0 && (
                  <div className="hist-empty">{t('skills.empty')}</div>
                )}
                {SKILL_CATALOG.map((s) => {
                  const inst = installedSkills.some((x) => x.id === s.id)
                  return (
                    <div key={s.id} className="hist-item skill-item">
                      <div className="skill-info">
                        <div className="hist-title">
                          {s.name} {inst && <span className="skill-ok"><IconCheck size={12} /> {t('skills.installed')}</span>}
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
                          <span className="skill-busy"><IconSpinner /></span>
                        ) : inst ? (
                          <>
                            <button title={t('skills.updateTitle')} onClick={() => installSkill(s)}><IconRefresh size={14} /></button>
                            <button title={t('skills.remove')} onClick={() => removeSkill(s.id)}><IconTrash size={14} /></button>
                          </>
                        ) : (
                          <button className="skill-install" onClick={() => installSkill(s)}>{t('skills.install')}</button>
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
                          {x.id} <span className="skill-ok"><IconCheck size={12} /> {t('skills.installed')}</span>
                        </div>
                        <div className="hist-meta">{x.desc || t('skills.own')}</div>
                      </div>
                      <div className="art-actions">
                        {skillBusy === x.id ? (
                          <span className="skill-busy"><IconSpinner /></span>
                        ) : (
                          <button title={t('skills.remove')} onClick={() => removeSkill(x.id)}><IconTrash size={14} /></button>
                        )}
                      </div>
                    </div>
                  ))}

                {/* instalar desde cualquier repo de GitHub */}
                <div className="menu-sec">{t('skills.fromRepo')}</div>
                <div className="skill-scan">
                  <input
                    placeholder={t('skills.repoPh')}
                    value={scanUrl}
                    onChange={(e) => setScanUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && scanRepo()}
                  />
                  <button type="button" className="skill-install" onClick={scanRepo} disabled={scanResult?.loading}>
                    {scanResult?.loading ? '⏳' : t('skills.search')}
                  </button>
                </div>
                {scanResult?.error && <div className="hist-empty"><IconWarn size={13} /> {scanResult.error}</div>}
                {scanResult?.skills?.length === 0 && <div className="hist-empty">{t('skills.noSkillMd')}</div>}
                {scanResult?.skills?.map((s) => {
                  const inst = installedSkills.some((x) => x.id === s.id)
                  return (
                    <div key={s.id} className="hist-item skill-item">
                      <div className="skill-info">
                        <div className="hist-title">
                          {s.id} {inst && <span className="skill-ok"><IconCheck size={12} /> {t('skills.installed')}</span>}
                        </div>
                        <div className="hist-meta">{s.desc || t('skills.from', { repo: scanResult.repo })}</div>
                      </div>
                      <div className="art-actions">
                        {skillBusy === s.id ? (
                          <span className="skill-busy"><IconSpinner /></span>
                        ) : (
                          <button className="skill-install" onClick={() => installSkill({ id: s.id, repo: scanResult.repo, name: s.id })}>
                            {inst ? t('skills.update') : t('skills.install')}
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
                      placeholder={t('skills.namePh')}
                      value={skillForm.name}
                      onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })}
                      autoFocus
                    />
                    <textarea
                      placeholder={t('skills.whenPh')}
                      rows={2}
                      value={skillForm.desc}
                      onChange={(e) => setSkillForm({ ...skillForm, desc: e.target.value })}
                    />
                    <div className="snip-form-row">
                      <button type="button" onClick={() => setSkillForm(null)}>{t('common.cancel')}</button>
                      <button type="button" className="snip-save" disabled={!skillForm.name.trim()} onClick={createSkill}>
                        {t('skills.createOpen')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="snip-new" onClick={() => setSkillForm({ name: '', desc: '' })}>
                    <IconAdd size={14} /> {t('skills.create')}
                  </button>
                )}

                {/* plugins: paquetes completos vía claude plugin CLI */}
                <div className="menu-sec">{t('plug.title')}</div>
                <div className="skills-note">{t('plug.note')}</div>
                {pluginData?.loading && <div className="hist-empty">{t('plug.loading')}</div>}
                {pluginData?.error && <div className="hist-empty"><IconWarn size={13} /> {pluginData.error}</div>}
                {pluginData?.installed && (
                  <>
                    <div className="skill-scan">
                      <input
                        placeholder={t('plug.addSourcePh')}
                        value={mktUrl}
                        onChange={(e) => setMktUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addMkt()}
                      />
                      <button type="button" className="skill-install" onClick={addMkt} disabled={pluginBusy === 'mkt'}>
                        {pluginBusy === 'mkt' ? '⏳' : t('plug.add')}
                      </button>
                    </div>
                    {pluginData.marketplaces.map((m) => (
                      <div key={m.name} className="hist-item skill-item">
                        <div className="skill-info">
                          <div className="hist-title">{m.name}</div>
                          <div className="hist-meta">{m.repo}</div>
                        </div>
                        <div className="art-actions">
                          {pluginBusy === m.name ? (
                            <span className="skill-busy"><IconSpinner /></span>
                          ) : (
                            m.name !== 'claude-plugins-official' && (
                              <button title={t('plug.removeSource')} onClick={() => removeMkt(m.name)}><IconTrash size={14} /></button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                    {pluginData.installed.map((p) => (
                      <div key={p.id} className="hist-item skill-item">
                        <div className="skill-info">
                          <div className="hist-title">
                            {p.name} <span className="skill-ok"><IconCheck size={12} /> {t('plug.installed')}</span>
                          </div>
                          <div className="hist-meta">{p.desc}</div>
                        </div>
                        <div className="art-actions">
                          {pluginBusy === p.id ? (
                            <span className="skill-busy"><IconSpinner /></span>
                          ) : (
                            <button title={t('plug.uninstall')} onClick={() => uninstallPlugin(p.id)}><IconTrash size={14} /></button>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="skill-scan">
                      <input
                        placeholder={t('plug.searchPh', { n: pluginData.available.length })}
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
                                <span className="skill-tag">{p.marketplace}</span>
                                {p.installs > 0 && <span className="skill-tag">{t('plug.installs', { n: fmtTokens(p.installs) })}</span>}
                              </div>
                            </div>
                            <div className="art-actions">
                              {pluginBusy === p.id ? (
                                <span className="skill-busy"><IconSpinner /></span>
                              ) : pluginData.installed.some((x) => x.name === p.name) ? (
                                <span className="skill-ok"><IconCheck size={13} /></span>
                              ) : (
                                <button className="skill-install" onClick={() => installPlugin(p.id)}>{t('skills.install')}</button>
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
              <b>{t('panel.agents')}</b>
              <button onClick={closeAgents} title={t('panel.back')}><IconClose size={16} /></button>
            </div>
            <div className="preset-row">
              {SQUAD_PRESETS.map((p) => (
                <button key={p.id} type="button" className="preset-chip" onClick={() => applyPreset(p)} title={t('ag.presetTitle', { roles: p.roles.join(', ') })}>
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
                    title={t('ag.drag')}
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
                  <span className="squad-label">{r.custom ? t('ag.custom') : metaOf(r).label}</span>
                  {/* columna de ancho fijo para ✏️/🗑: así el switch queda
                      alineado verticalmente en todas las filas */}
                  <span className="squad-tools">
                    {r.custom && (
                      <button
                        type="button"
                        className="squad-del"
                        onClick={() => startEditRole(r)}
                        title={t('ag.editRole')}
                      >
                        <IconEdit size={14} />
                      </button>
                    )}
                    {canDelete(r) && (
                      <button
                        type="button"
                        className="squad-del"
                        onClick={() => deleteRole(r.id)}
                        title={r.custom ? t('ag.delCustom') : t('ag.delRole')}
                      >
                        <IconTrash size={13} />
                      </button>
                    )}
                  </span>
                  {/* switch al borde derecho, misma columna en todas las filas */}
                  <label className="switch" title={r.enabled ? t('ag.disable') : t('ag.enable')}>
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
                    <IconPerson3D size={13} /> {avatarLabel(effectiveAvatar(r))}
                  </button>
                  <button
                    type="button"
                    className="squad-avatar-btn"
                    onClick={() => window.oficina?.openPersona?.(profile, r.id, r.name)}
                    title={t('ag.personaTitle')}
                  >
                    <IconEdit size={13} /> {t('ag.persona')}
                  </button>
                  <select
                    className="squad-avatar-btn squad-model"
                    value={r.model || ''}
                    onChange={(e) => setMemberModel(r.id, e.target.value)}
                    title={t('ag.modelTitle')}
                  >
                    <option value="">{t('ag.globalModel')}</option>
                    {Object.keys(MODEL_OPTIONS).map((id) => (
                      <option key={id} value={id}>
                        {modelLabelOf(id)}
                      </option>
                    ))}
                  </select>
                  <select
                    className="squad-avatar-btn squad-model"
                    value={r.effort || ''}
                    onChange={(e) => setMemberEffort(r.id, e.target.value)}
                    title={t('ag.effortTitle')}
                  >
                    <option value="">{t('ag.globalEffort')}</option>
                    {EFFORTS.map((ef) => (
                      <option key={ef} value={ef}>
                        {t(`effort.${ef}`)}
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
                  placeholder={t('ag.newNamePh')}
                  value={nr.name}
                  maxLength={16}
                  onChange={(e) => setNr((v) => ({ ...v, name: e.target.value }))}
                />
                <input
                  className="add-role-in"
                  placeholder={t('ag.newFocusPh')}
                  value={nr.focus}
                  onChange={(e) => setNr((v) => ({ ...v, focus: e.target.value }))}
                />
                <input
                  className="add-role-in"
                  placeholder={t('ag.newKwPh')}
                  value={nr.kw}
                  onChange={(e) => setNr((v) => ({ ...v, kw: e.target.value }))}
                />
                <div className="add-role-row">
                  <input
                    className="add-role-emoji"
                    placeholder="🛠"
                    value={nr.emoji}
                    maxLength={2}
                    onChange={(e) => setNr((v) => ({ ...v, emoji: e.target.value }))}
                  />
                  <input
                    type="color"
                    className="add-role-color"
                    value={nr.color}
                    onChange={(e) => setNr((v) => ({ ...v, color: e.target.value }))}
                    title={t('ag.colorTitle')}
                  />
                  <select
                    className="add-role-avatar"
                    value={nr.avatar}
                    onChange={(e) => setNr((v) => ({ ...v, avatar: e.target.value }))}
                    title={t('ag.avatar3d')}
                  >
                    <option value="">{t('ag.avatarAuto')}</option>
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
                  title={t('ag.modelOwnTitle')}
                >
                  <option value="">{t('ag.modelGlobalIs', { label: modelLabelOf(model) })}</option>
                  {Object.keys(MODEL_OPTIONS).map((id) => (
                    <option key={id} value={id}>
                      {modelLabelOf(id)}
                    </option>
                  ))}
                </select>
                <div className="add-role-actions">
                  <button type="button" className="add-role-ok" onClick={addRole}>
                    {editingId ? t('ag.saveChanges') : t('ag.createRole')}
                  </button>
                  <button
                    type="button"
                    className="add-role-cancel"
                    onClick={() => (setAddingRole(false), setNr(NEW_ROLE), setEditingId(null))}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button className="squad-add" type="button" onClick={() => setAddingRole(true)}>
                <IconAdd size={14} /> {t('ag.addRole')}
              </button>
            )}
            {missingBuiltins.length > 0 && (
              <button className="squad-add" type="button" onClick={restoreDefaults} title={t('ag.restoreTitle')}>
                <IconRestore size={14} /> {t('ag.restore', { n: missingBuiltins.length })}
              </button>
            )}
            <button className="squad-save" onClick={saveSquad}>
              {t('ag.saveSquad', { n: draftEnabled, max: MAX_ACTIVE })}
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
                  <b>{t('panel.avatarOf', { name: r.name })}</b>
                  <button onClick={() => setAvatarPicker(null)}><IconClose size={16} /></button>
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
                        title={isTaken ? t('ag.avatarTaken') : avatarLabel(a)}
                      >
                        <AvatarThumb file={a} />
                        <div className="avatar-name">
                          {avatarLabel(a)}
                          {isTaken ? t('ag.inUse') : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

        {/* Barra de las apps corriendo: pastilla flotante sobre la escena, al
            estilo de la del editor. Un chip por dispositivo; las acciones van a
            todos salvo que se enfoque uno. Solo lleva lo que el daemon soporta
            de verdad — pausa y stepping necesitan un debug adapter. */}
        {Object.keys(runs).length > 0 &&
          (() => {
            const ids = Object.keys(runs)
            const activos = foco ? [foco] : ids
            const listos = activos.filter((id) => runs[id]?.fase === 'corriendo')
            const puedeRecargar = listos.length > 0 && !activos.some((id) => runs[id]?.recargando)
            const conError = ids.find((id) => runs[id]?.error)
            const compilando = ids.find((id) => runs[id]?.fase !== 'corriendo')
            return (
              <div className="runbar">
                {ids.map((id) => {
                  const r = runs[id]
                  return (
                    <button
                      type="button"
                      key={id}
                      className={[
                        'runbar-chip',
                        r.fase === 'corriendo' ? 'on' : '',
                        foco === id ? 'foco' : '',
                        r.error ? 'malo' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setFoco((f) => (f === id ? null : id))}
                      title={`${
                        r.fase === 'corriendo' ? t('run.running', { device: r.device }) : t('run.compiling')
                      }${r.config ? ` · ${r.config}` : ''}`}
                    >
                      <span className="runbar-dot" />
                      {r.device}
                    </button>
                  )
                })}
                {ids.length > 1 && <span className="runbar-scope">{foco ? runs[foco]?.device : t('run.all')}</span>}
                <span className="runbar-label">
                  {compilando ? runs[compilando]?.progreso?.mensaje || t('run.compiling') : ''}
                </span>
                <span className="runbar-sep" />
                <button
                  type="button"
                  className={autoReload ? 'runbar-btn auto on' : 'runbar-btn auto'}
                  onClick={() => {
                    setAutoReload((v) => !v)
                    showToast(autoReload ? t('run.autoOff') : t('run.autoOn'))
                  }}
                  title={t('run.auto')}
                  aria-label={t('run.auto')}
                  aria-pressed={autoReload}
                >
                  <IconBolt size={13} />
                  <span className="runbar-auto-txt">auto</span>
                </button>
                <button
                  type="button"
                  className="runbar-btn reload"
                  onClick={() => recargar(false)}
                  disabled={!puedeRecargar}
                  title={t('run.reload')}
                  aria-label={t('run.reload')}
                >
                  <IconBolt size={15} />
                </button>
                <button
                  type="button"
                  className="runbar-btn restart"
                  onClick={() => recargar(true)}
                  disabled={!puedeRecargar}
                  title={t('run.restart')}
                  aria-label={t('run.restart')}
                >
                  <IconRestartApp size={15} />
                </button>
                <button
                  type="button"
                  className="runbar-btn stop"
                  onClick={detener}
                  title={listos.length ? t('run.stop') : t('run.cancel')}
                  aria-label={listos.length ? t('run.stop') : t('run.cancel')}
                >
                  <IconStopSquare size={15} />
                </button>
                {runs[foco || ids[0]]?.url && (
                  <button
                    type="button"
                    className="runbar-btn"
                    onClick={() => window.open(runs[foco || ids[0]].url, '_blank')}
                    title={t('run.devtools')}
                    aria-label={t('run.devtools')}
                  >
                    <IconLink size={15} />
                  </button>
                )}
                <button
                  type="button"
                  className={verLogs ? 'runbar-btn on' : 'runbar-btn'}
                  onClick={() => setVerLogs((v) => !v)}
                  title={t('run.logs')}
                  aria-label={t('run.logs')}
                  aria-expanded={verLogs}
                >
                  <IconBoard size={15} />
                </button>
                {conError && <span className="runbar-error">{runs[conError].error.slice(0, 70)}</span>}
                {/* la salida: cuando una compilación falla, el motivo está aquí */}
                {verLogs && (
                  <pre className="runbar-logs">
                    {runLogs.length
                      ? runLogs
                          .slice(-200)
                          .map((l) => (ids.length > 1 ? `[${runs[l.deviceId]?.device || l.deviceId}] ${l.texto}` : l.texto))
                          .join('\n')
                      : t('run.compiling')}
                  </pre>
                )}
              </div>
            )
          })()}

        {/* Copiar de otro perfil: se elige el origen y QUÉ se lleva, con lo que
            hay en cada uno a la vista para no pisar algo bueno con algo vacío */}
        {copyView && (
          <div className="drawer copy-drawer">
            <div className="drawer-head">
              <b>{t('copy.title')}</b>
              <button onClick={() => setCopyView(null)}><IconClose size={16} /></button>
            </div>
            <label className="dev-config">
              <span>{t('copy.from')}</span>
              <select value={copyView.desde} onChange={(e) => cambiaOrigen(e.target.value)}>
                {(cfg?.profiles || [])
                  .filter((p) => p !== profile)
                  .map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
              </select>
            </label>
            <div className="dev-group">{t('copy.what')}</div>
            {[
              ['squad', 'copy.squad', 'copy.squadHint', copyView.resumen?.squad],
              ['personas', 'copy.personas', 'copy.personasHint', copyView.resumen?.personas],
              ['proyectos', 'copy.projects', 'copy.projectsHint', copyView.resumen?.proyectos],
            ].map(([clave, etiqueta, pista, n]) => (
              <label key={clave} className="copy-row">
                <input
                  type="checkbox"
                  checked={!!copyView.partes[clave]}
                  onChange={(e) =>
                    setCopyView((v) => ({ ...v, partes: { ...v.partes, [clave]: e.target.checked } }))
                  }
                />
                <span className="copy-name">{t(etiqueta)}</span>
                <span className="copy-hint">{t(pista)}</span>
                <span className="copy-count">
                  {n ? t('copy.has', { n, profile: copyView.desde }) : t('copy.none', { profile: copyView.desde })}
                </span>
              </label>
            ))}
            <p className="dev-sdk">{t('copy.note')}</p>
            <button type="button" className="dev-launch" onClick={haceCopia}>
              <IconCopy size={11} /> {t('copy.do', { hacia: profile })}
            </button>
          </div>
        )}

        {devicesView && (
          <div className="drawer dev-drawer">
            <div className="drawer-head">
              <b>
                {makeProj?.esMake && !flutterProj?.esFlutter && !npmProj?.esNpm
                  ? t('make.title')
                  : npmProj?.esNpm && !flutterProj?.esFlutter
                  ? t('npm.title')
                  : t('panel.devices', {
                      project: (devicesView.proyecto || project || '').split('/').pop() || t('panel.theProject'),
                    })}
              </b>
              <button
                type="button"
                className="iconbtn"
                onClick={refrescaDevices}
                title={t('dev.refresh')}
                disabled={devicesView.loading || devicesView.refrescando}
              >
                {devicesView.refrescando ? <IconSpinner size={14} /> : <IconRefresh size={15} />}
              </button>
              <button onClick={() => setDevicesView(null)}>
                <IconClose size={16} />
              </button>
            </div>
            {devicesView.loading && <div className="hist-empty">{t('dev.loading')}</div>}
            {devicesView.error && (
              <div className="hist-empty">
                <IconWarn size={13} /> {devicesView.error}
              </div>
            )}
            {/* web/escritorio: el objetivo es un script, no un dispositivo */}
            {npmProj?.esNpm && (
              <>
                <div className="dev-sdk">{t('npm.manager', { gestor: npmProj.gestor })}</div>
                <div className="dev-sdk">{t('npm.noHotReload')}</div>
                <div className="dev-group">{t('npm.runs')}</div>
                {npmProj.scripts
                  .filter((sc) => sc.corre)
                  .map((sc) => (
                    <div key={sc.name} className="dev-row fisico">
                      <span className="dev-kind">script</span>
                      <span className="dev-name">{sc.name}</span>
                      <span className="dev-meta">{sc.cmd.slice(0, 40)}</span>
                      <button
                        type="button"
                        className="dev-launch"
                        onClick={() => correrScript(sc)}
                        disabled={!!runs[`npm:${sc.name}`]}
                      >
                        <IconPlay size={11} /> {t('npm.run')}
                      </button>
                    </div>
                  ))}
              </>
            )}
            {/* Targets del Makefile, agrupados por módulo: 127 en una lista
                plana no se leen, y el proyecto ya los organiza así */}
            {makeProj?.esMake && (
              <>
                <div className="dev-sdk">{t('make.total', { n: makeProj.total, g: makeProj.grupos.length })}</div>
                {makeProj.grupos.map((g) => (
                  <div key={g.modulo}>
                    <button
                      type="button"
                      className="make-mod"
                      onClick={() => setMakeAbierto((v) => ({ ...v, [g.modulo]: !v[g.modulo] }))}
                      aria-expanded={!!makeAbierto[g.modulo]}
                    >
                      <span>{makeAbierto[g.modulo] ? '▾' : '▸'}</span>
                      {g.modulo}
                      <span className="make-count">{g.items.length}</span>
                    </button>
                    {makeAbierto[g.modulo] &&
                      g.items.map((tg) => (
                        <div key={tg.name} className="dev-row fisico">
                          <span className="dev-name">{tg.name}</span>
                          <span className="dev-meta">
                            {tg.desc.slice(0, 60)}
                            {tg.args.length > 0 && ` · ${tg.args.join(', ')}`}
                            {tg.argsOpt.length > 0 && ` · ${tg.argsOpt.join(', ')} (${t('make.optional')})`}
                          </span>
                          <button
                            type="button"
                            className="dev-launch"
                            onClick={() => correrTarget(tg)}
                            disabled={!!runs[`make:${tg.name}`]}
                          >
                            <IconPlay size={11} /> {t('make.run')}
                          </button>
                        </div>
                      ))}
                  </div>
                ))}
              </>
            )}
            {devicesView.devices && (
              <>
                {devicesView.via && <div className="dev-sdk">{t('dev.sdk', { via: devicesView.via })}</div>}
                {/* se listan solo los objetivos que el proyecto puede compilar:
                    decir en cuáles corre evita que la ausencia parezca un fallo */}
                {devicesView.plataformas?.length > 0 && (
                  <div className="dev-sdk">{t('dev.platforms', { list: devicesView.plataformas.join(' · ') })}</div>
                )}
                {devicesView.proyectos?.length > 1 && (
                  <div className="dev-sdk">
                    {t('dev.otherProject', {
                      list: devicesView.proyectos
                        .slice(1)
                        .map((p) => p.split('/').pop())
                        .join(' · '),
                    })}
                  </div>
                )}
                {/* las mismas configuraciones que ofrece el editor: sin esto,
                    «correr» solo serviría para el flavor por defecto */}
                {devicesView.configs?.length > 0 && (
                  <label className="dev-config">
                    <span>{t('run.config')}</span>
                    <select value={config} onChange={(e) => setConfig(e.target.value)}>
                      <option value="">{t('run.configDefault')}</option>
                      {devicesView.configs.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="dev-group">{t('dev.connected')}</div>
                {devicesView.devices.length === 0 && <div className="hist-empty">{t('dev.none')}</div>}
                {devicesView.devices.map((d) => (
                  <div key={d.id} className={`dev-row ${d.tipo}`}>
                    <span className="dev-kind">{t(`dev.${d.tipo}`)}</span>
                    <span className="dev-name">{d.name}</span>
                    <span className="dev-meta">
                      {d.sdk || d.platform}
                      {!d.hotReload && ` · ${t('dev.noHotReload')}`}
                    </span>
                    <button
                      type="button"
                      className="dev-launch"
                      onClick={() => correrEn(d)}
                      disabled={!!runs[d.id]}
                      title={t('dev.runTitle', { device: d.name })}
                    >
                      <IconPlay size={11} /> {t('dev.run')}
                    </button>
                  </div>
                ))}
                <div className="dev-group">{t('dev.launchable')}</div>
                {devicesView.emulators.length === 0 && <div className="hist-empty">{t('dev.noEmus')}</div>}
                {devicesView.emulators.map((e) => (
                  <div key={e.id} className="dev-row emulador">
                    <span className="dev-kind">{t('dev.emulador')}</span>
                    <span className="dev-name">{e.name}</span>
                    <span className="dev-meta">
                      {e.platform}
                      {e.corriendo && ` · ${t('dev.emuRunning')}`}
                    </span>
                    {e.corriendo ? (
                      <button
                        type="button"
                        className="dev-launch cerrar"
                        onClick={() => cerrarEmulador(e)}
                        disabled={devicesView.cerrando === e.id}
                        title={t('dev.stopEmuTitle', { name: e.name })}
                      >
                        {devicesView.cerrando === e.id ? (
                          <>
                            <IconSpinner size={12} /> {t('dev.stoppingEmu')}
                          </>
                        ) : (
                          <>
                            <IconStopSquare size={11} /> {t('dev.stopEmu')}
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="dev-launch"
                        onClick={() => launchEmulator(e)}
                        disabled={!!devicesView.lanzando}
                        title={t('dev.launch')}
                      >
                        {devicesView.lanzando === e.id ? (
                          <>
                            <IconSpinner size={12} /> {t('dev.launching')}
                          </>
                        ) : (
                          t('dev.launch')
                        )}
                      </button>
                    )}
                  </div>
                ))}
                {devicesView.aviso && <div className="dev-sdk">{devicesView.aviso}</div>}
              </>
            )}
          </div>
        )}

        {diffView && (
          <div className="drawer diff-drawer">
            <div className="drawer-head">
              {/* con el proyecto en una carpeta padre, el diff sale de los repos
                  de dentro: se nombran ellos, no la carpeta */}
              <b>
                {t('panel.changesIn', {
                  project: diffView.repos?.length
                    ? diffView.repos.join(' · ')
                    : project?.split('/').pop() || t('panel.theProject'),
                })}
              </b>
              <button onClick={() => setDiffView(null)}><IconClose size={16} /></button>
            </div>
            {diffView.loading && <div className="hist-empty">{t('diff.loading')}</div>}
            {diffView.error && <div className="hist-empty"><IconWarn size={13} /> {diffView.error}</div>}
            {diffView.diff !== undefined && !diffView.diff && !diffView.untracked?.length && (
              <div className="hist-empty">{t('diff.none')}</div>
            )}
            {diffView.untracked?.length > 0 && (
              <div className="diff-untracked"><IconFile size={13} /> {t('diff.untracked')} {diffView.untracked.join(' · ')}</div>
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
              <b>{t('panel.docs')}</b>
              <button onClick={() => setArtsOpen(false)}><IconClose size={16} /></button>
            </div>
            {artsList.length === 0 && <div className="hist-empty">{t('docs.empty')}</div>}
            {artsList.map((a) => (
              <div key={a.path} className="hist-item art-item">
                <div onClick={() => window.oficina?.artifacts?.open?.(a.path, profile)} style={{ cursor: 'pointer' }}>
                  <div className="hist-title"><IconLink size={13} /> {prettyArtifact(a.name)}</div>
                  <div className="hist-meta">
                    {a.at ? new Date(a.at).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </div>
                <div className="art-actions">
                  <button
                    onClick={() => {
                      setRefs((r) => (r.some((x) => x.path === a.path) ? r : [...r, { path: a.path, name: a.name, isDir: false }]))
                      setArtsOpen(false)
                      showToast(t('toast.docInCtx'))
                      inputRef.current?.focus()
                    }}
                    title={t('docs.useCtx')}
                  >
                    <IconChat size={13} />
                  </button>
                  <button onClick={() => window.oficina?.artifacts?.reveal?.(a.path, profile)} title={t('docs.reveal')}><IconReveal size={14} /></button>
                  <button
                    onClick={async () => {
                      const r = await window.oficina?.artifacts?.zip?.(a.path, profile)
                      showToast(r?.ok ? t('toast.zipDone') : t('toast.zipCancel'))
                    }}
                    title={t('docs.zip')}
                  >
                    <IconZip size={14} />
                  </button>
                  <button
                    className="danger"
                    onClick={async () => {
                      const r = await window.oficina?.artifacts?.delete?.(a.path, profile)
                      if (r?.canceled) return
                      if (r?.ok) {
                        setArtsList((l) => l.filter((x) => x.path !== a.path))
                        showToast(t('toast.docDeleted'))
                      } else showToast(t('toast.noDocDelete'))
                    }}
                    title={t('docs.delete')}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {histOpen && (
          <div className="drawer">
            <div className="drawer-head">
              <b>{t('panel.history')}</b>
              <button onClick={() => setHistOpen(false)}><IconClose size={16} /></button>
            </div>
            {histList.length > 0 && (
              <input
                className="hist-search"
                placeholder={t('hist.searchPh')}
                value={histQuery}
                onChange={(e) => setHistQuery(e.target.value)}
                autoFocus
              />
            )}
            {histAnidado.length === 0 && (
              <div className="hist-empty">{histList.length ? t('hist.noResults') : t('hist.empty')}</div>
            )}
            {histAnidado.map((h) => (
              <div
                key={h.id}
                className={h.parentId ? 'hist-item hija' : 'hist-item'}
                onClick={() => renaming?.id !== h.id && loadConvo(h.id)}
              >
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
                    {h.pinned && <IconPin size={12} />}
                    {h.title}
                  </div>
                )}
                {histContent[h.id] && <div className="hist-meta hist-excerpt"><IconSearchSmall size={12} /> {histContent[h.id]}</div>}
                <div className="hist-meta">
                  <span className="ctx-ico">{h.profile === 'work' ? <IconWork size={12} /> : <IconPrivate size={12} />}</span>{h.project?.split('/').pop()} · {h.count} {t('hist.msgs')} ·{' '}
                  {h.updatedAt
                    ? new Date(h.updatedAt).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : ''}
                </div>
                <button
                  className="hist-export hist-ren"
                  title={t('hist.rename')}
                  aria-label={t('hist.renameA')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenaming({ id: h.id, val: h.title || '' })
                  }}
                >
                  <IconEdit size={14} />
                </button>
                <button
                  className="hist-export hist-pin"
                  title={h.pinned ? t('hist.unpin') : t('hist.pin')}
                  style={h.pinned ? { opacity: 0.8 } : undefined}
                  onClick={(e) => togglePin(e, h)}
                >
                  <IconPin size={13} />
                </button>
                <button className="hist-export" title={t('hist.export')} aria-label={t('hist.exportA')} onClick={(e) => exportConvo(e, h.id)}>
                  <IconDownload size={14} />
                </button>
                <button className="hist-del" title={t('hist.delete')} aria-label={t('hist.deleteA')} onClick={(e) => deleteConvo(e, h.id)}>
                  <IconTrash size={14} />
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

        {doneChip && (
          <div className="toolchip" key={doneChip}>
            {doneChip}
          </div>
        )}

        {/* Aviso de contexto casi lleno. Con acción, no solo con alarma: sin el
            botón el usuario sabe que va a perder el hilo pero no qué hacer. */}
        {avisaContexto && (
          <div className="ctxwarn">
            <span className="ctxwarn-txt">{nivelCtx >= 2 ? t('ctx.atLimit') : t('ctx.nearLimit')}</span>
            <button type="button" className="ctxwarn-go" onClick={() => pedirTraspaso('nuevo')} title={t('ctx.handoffTitle')}>
              {t('ctx.handoff')}
            </button>
            <button type="button" className="ctxwarn-go" onClick={() => pedirTraspaso('aqui')} title={t('ctx.handoffHereTitle')}>
              {t('ctx.handoffHere')}
            </button>
            <button type="button" className="ctxwarn-x" onClick={() => setCtxSilenciado(nivelCtx)}>
              {t('ctx.later')}
            </button>
          </div>
        )}

        {(messages.length > 0 || tabs.length > 1) && (
          <div
            className="tabbar"
            style={{ top: 14 + monAlto + 10 + chipsAlto, maxHeight: `calc(100% - ${14 + monAlto + 10 + chipsAlto + 90}px)`, visibility: monAlto ? 'visible' : 'hidden' }}
          >
            <div className="mon-title">
              <IconChat size={13} /> {t('mon.chats')}
            </div>
            {tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                className={[tb.id === activeTab ? 'tab on' : 'tab', tabDrag === tb.id ? 'dragging' : '', tb.sub ? 'sub' : '', tb.done ? 'done' : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => switchTab(tb.id)}
                onDoubleClick={() => setTabRename({ id: tb.id, val: tb.title })}
                title={tabRename?.id === tb.id ? '' : `${tb.title} — ${t('chat.renameHint')}`}
                draggable={!tabRename}
                onDragStart={() => setTabDrag(tb.id)}
                onDragEnd={() => setTabDrag(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => moveTab(tb.id)}
              >
                {tabRename?.id === tb.id ? (
                  <input
                    className="tab-rename"
                    value={tabRename.val}
                    autoFocus
                    maxLength={28}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setTabRename({ id: tb.id, val: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitTabRename()
                      if (e.key === 'Escape') setTabRename(null)
                      e.stopPropagation() // que Esc no cierre además los paneles
                    }}
                    onBlur={commitTabRename}
                  />
                ) : (
                  <>
                    <span className="tab-title">{tb.title}</span>
                    {/* En qué proyecto trabaja esta pestaña. Con varias abiertas en
                        proyectos distintos, sin esto hay que adivinar. Solo se
                        muestra si no es el de la pestaña activa: repetirlo en todas
                        sería ruido. */}
                    {proyectoDeTab(tb.id) && proyectoDeTab(tb.id) !== project && (
                      <span className="tab-proj">{proyectoDeTab(tb.id).split('/').pop()}</span>
                    )}
                    {/* Aparcar: solo en la que estás mirando, que es la única que
                        tapa la escena. Si ya está aparcada, el mismo botón la trae
                        de vuelta y se queda visible como recordatorio de que el
                        hilo sigue ahí. */}
                    {tb.id === activeTab && messages.length > 0 && (
                      <span
                        className={chatMin ? 'tab-min on' : 'tab-min'}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (chatMin) desaparca()
                          else setChatMin(true)
                        }}
                        title={chatMin ? t('chat.unmin') : t('chat.min')}
                      >
                        {chatMinNuevo && <span className="tab-min-dot" />}
                        <IconMinimize size={11} />
                      </span>
                    )}
                    <span className="tab-x" onClick={(e) => closeTab(e, tb.id)} title={t('chat.closeTab')}>
                      <IconClose size={11} />
                    </span>
                  </>
                )}
              </button>
            ))}
            <button type="button" className="tab tab-add" onClick={addTab} title={t('chat.newTab')} aria-label={t('chat.newTab')}>
              <IconAdd size={14} />
            </button>
          </div>
        )}
        {messages.length > 0 && !chatMin && (
          <div className="chat chat-tabbed" ref={logRef} onScroll={onLogScroll} onMouseUp={onChatMouseUp}>
            {findOpen && (
              <div className="find-bar">
                <input
                  ref={findInputRef}
                  placeholder={t('chat.findPh')}
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
                <button type="button" onClick={() => gotoHit(findIdx - 1)} title={t('chat.prev')}><IconArrowUp size={14} /></button>
                <button type="button" onClick={() => gotoHit(findIdx + 1)} title={t('chat.next')}><IconArrowDown size={14} /></button>
                <button type="button" onClick={() => setFindOpen(false)} title={t('chat.closeEsc')}><IconClose size={16} /></button>
              </div>
            )}
            {chatFilter && (
              <div className="chat-filter">
                {t('chat.onlyAgent')} {memberOf(chatFilter).emoji} {memberOf(chatFilter).name}
                <button type="button" onClick={() => setChatFilter(null)}><IconClose size={12} /> {t('chat.seeAll')}</button>
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
                    title={chatFilter === m.who ? t('chat.seeAllTitle') : t('chat.onlyOf', { name: memberOf(m.who).name })}
                  >
                    {memberOf(m.who).emoji} {memberOf(m.who).name}
                  </div>
                )}
                {m.role === 'user' && m.to && m.to !== principal && <div className="who to">→ {memberOf(m.to).name}</div>}
                {m.role === 'user' && m.queued && (
                  <div className="who to">
                    <IconClock size={12} /> {t('chat.queued')}
                    <button type="button" className="queue-cancel" onClick={() => cancelQueued(m)} title={t('chat.dequeue')}>
                      <IconClose size={12} />
                    </button>
                  </div>
                )}
                {m.role === 'user' && m.cancelled && (
                  <div className="who to">
                    ⏹ {t('chat.cancelled')}
                    <button
                      type="button"
                      className="queue-cancel"
                      title={t('chat.editResend')}
                      onClick={() => {
                        setInput(m.text)
                        inputRef.current?.focus()
                        requestAnimationFrame(() => autoGrow(inputRef.current))
                      }}
                    >
                      <IconEdit size={13} /> {t('chat.edit')}
                    </button>
                    <button type="button" className="queue-cancel" title={t('chat.removeMsg')} onClick={() => borraMensaje(m)}>
                      <IconTrash size={13} />
                    </button>
                  </div>
                )}
                {m.role === 'user' && m.atts?.length > 0 && (
                  <div className="msg-atts">
                    {m.atts.map((a, j) =>
                      typeof a === 'string' ? <span key={j}><IconImage size={12} /> {a}</span> : <AttThumb key={j} att={a} onZoom={setLightbox} />
                    )}
                  </div>
                )}
                {m.thinking && (
                  <div className="thinking">
                    <button
                      type="button"
                      className="thinking-head"
                      onClick={() => setThinkingOpen((o) => ({ ...o, [i]: !o[i] }))}
                    >
                      <IconBulb size={13} />
                      {t('chat.thinking')}
                      <span className={thinkingOpen[i] ? 'thinking-caret open' : 'thinking-caret'}>
                        <IconChevron size={16} />
                      </span>
                    </button>
                    {thinkingOpen[i] && <div className="thinking-body">{m.thinking}</div>}
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
                {(m.usage || m.dur > 0 || m.fuera > 0) && (
                  <div className="msg-tokens" title={m.usage ? usageTitle(m.usage) : ''}>
                    {m.usage && t('chat.tokens', { n: fmtTokens(usageTotal(m.usage)) })}
                    {m.usage && m.dur > 0 && ' · '}
                    {m.dur > 0 && <span title={t('chat.tookTitle')}>⏱ {fmtElapsed(m.dur)}</span>}
                    {/* lo que se trabajó fuera de este hilo: es la respuesta a
                        «¿sirvió repartir?», y sin el dato se reparte a ciegas */}
                    {m.fuera > 0 && (
                      <>
                        {' · '}
                        <span title={t('chat.outsideTitle')}>👥 {t('chat.outside', { n: fmtTokens(m.fuera) })}</span>
                      </>
                    )}
                  </div>
                )}
                {m.role === 'assistant' && !m.streaming && !m.error && (
                  <button
                    type="button"
                    className="msg-copy"
                    title={t('chat.copy')}
                    aria-label={t('chat.copy')}
                    onClick={() => {
                      navigator.clipboard.writeText(m.text)
                      showToast(t('toast.answerCopied'))
                    }}
                  >
                    <IconCopy size={12} />
                  </button>
                )}
                {m.role === 'user' && !m.queued && (
                  <button
                    type="button"
                    className="msg-copy msg-edit"
                    title={t('chat.editResend')}
                    aria-label={t('chat.editResendA')}
                    onClick={() => {
                      setInput(m.text)
                      const el = inputRef.current
                      if (el) {
                        el.focus()
                        requestAnimationFrame(() => autoGrow(el))
                      }
                    }}
                  >
                    <IconEdit size={14} />
                  </button>
                )}
                {m.artifact && (
                  <button className="artifact-btn" onClick={() => window.oficina?.artifacts?.open?.(m.artifact.path, profile)}>
                    <IconLink size={13} /> {t('chat.open')} · {prettyArtifact(m.artifact.name)}
                  </button>
                )}
                {m.edited && (
                  <button className="artifact-btn" onClick={openDiff}>
                    <IconDiff size={13} /> {t('chat.diff')}
                  </button>
                )}
                {m.role === 'system' && m.standupShare && (
                  <button className="artifact-btn" onClick={() => shareStandup(i)}>
                    <IconShare size={13} /> {t('chat.share')}
                  </button>
                )}
                {m.error && lastJobRef.current[m.who] && i === messages.findLastIndex((x) => x.who === m.who) && (
                  <button className="artifact-btn" onClick={() => retryJob(m.who)}>
                    <IconRetry size={13} /> {t('chat.retry')}
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
        <div className="lightbox" onClick={() => setLightbox(null)} title={t('chat.lightbox')}>
          <img src={lightbox} alt="" />
        </div>
      )}

      {introOpen && (
        <Suspense fallback={<div className="intro" />}>
        <Intro
          onDone={() => {
            setIntroOpen(false)
            setIntroFade(true) // la oficina emerge del negro, no aparece de golpe
            setTimeout(() => setIntroFade(false), 1700) // hasta que el velo termine
          }}
        />
        </Suspense>
      )}
      {introFade && <div className="intro-veil" />}
      {quote && (
        <button type="button" className="quote-btn" style={{ left: quote.x, top: quote.y }} onClick={useQuote}>
          <IconChat size={13} /> {t('chat.quote')}
        </button>
      )}
      {tourOpen && <Tour onDone={endTour} />}

      {(attachments.length > 0 || refs.length > 0) && (
        <div className="attachbar">
          {attachments.map((a, i) => (
            <span key={a.path} className="attachchip">
              <AttThumb att={a} onZoom={setLightbox} />
              <button type="button" onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}><IconClose size={16} /></button>
            </span>
          ))}
          {refs.map((r, i) => (
            <span key={r.path} className="attachchip">
              {r.isDir ? <IconFolder size={12} /> : <IconFile size={12} />} {r.name}
              <button type="button" onClick={() => setRefs((arr) => arr.filter((_, j) => j !== i))}><IconClose size={16} /></button>
            </span>
          ))}
        </div>
      )}

      {/* plantilla con {{variables}}: pedir los valores antes de insertar */}
      {snipVars && (
        <div className="snip-pop">
          <div className="skills-note">{t('snip.varsNote')}</div>
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
              <button type="button" onClick={() => setSnipVars(null)}>{t('common.cancel')}</button>
              <button type="button" className="snip-save" onClick={insertSnipVars}>
                {t('snip.insert')}
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
                title={t('snip.delete')}
                onClick={(e) => {
                  e.stopPropagation()
                  saveSnippets(snippets.filter((x) => x.id !== s.id))
                }}
              >
                <IconClose size={12} />
              </button>
            </div>
          ))}
          {!snipMatches.length && (
            <div className="snip-empty">{snippets.length ? t('snip.none') : t('snip.empty')}</div>
          )}
          {snipForm ? (
            <div className="snip-form">
              <input
                placeholder={t('snip.namePh')}
                value={snipForm.name}
                onChange={(e) => setSnipForm({ ...snipForm, name: e.target.value })}
                autoFocus
              />
              <textarea
                placeholder={t('snip.textPh')}
                rows={3}
                value={snipForm.text}
                onChange={(e) => setSnipForm({ ...snipForm, text: e.target.value })}
              />
              <div className="snip-form-row">
                <button type="button" onClick={() => setSnipForm(null)}>{t('common.cancel')}</button>
                <button
                  type="button"
                  className="snip-save"
                  disabled={!snipForm.name.trim() || !snipForm.text.trim()}
                  onClick={() => {
                    const name = snipForm.name.trim().replace(/^\//, '').replace(/\s+/g, '-').toLowerCase()
                    saveSnippets([...snippets.filter((x) => x.name !== name), { id: crypto.randomUUID(), name, text: snipForm.text.trim() }])
                    setSnipForm(null)
                    showToast(t('toast.snipSaved', { name }))
                  }}
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="snip-new" onClick={() => setSnipForm({ name: snipQuery || '', text: '' })}>
              <IconAdd size={13} /> {t('snip.new')}
            </button>
          )}
        </div>
      )}
      {updateLista && (
        <div className="upd-bar">
          <span className="upd-dot" />
          {t('upd.ready', { v: updateLista })}
          <button
            type="button"
            onClick={async () => {
              const r = await window.oficina?.installUpdate?.()
              // Si falla, decirlo: antes el error se perdía y la app se quedaba
              // igual, como si el botón no hiciera nada.
              if (!r?.ok) showToast(`⚠️ ${r?.error || t('upd.failed')}`, 7000)
            }}
          >
            {t('upd.install')}
          </button>
          <button type="button" className="upd-x" onClick={() => setUpdateLista('')} title={t('upd.later')}>
            <IconClose size={12} />
          </button>
        </div>
      )}
      {/* Qué está haciendo por detrás. Aparece mientras trabaja y SIGUE ahí al
          terminar: el rastro es tan útil para supervisar en vivo como para
          revisar después qué tocó. */}
      {(busy || actividadRef.current.length > 0) && (
        <button
          type="button"
          className={[busy ? 'act-btn on' : 'act-btn', actOpen ? 'abierto' : ''].filter(Boolean).join(' ')}
          // Alterna: el mismo botón que lo abre lo cierra. Un botón que solo
          // abre deja al usuario buscando la ✕ del panel, y aquí lo normal es
          // asomarse y volver al chat.
          aria-expanded={actOpen}
          onClick={() => {
            if (actOpen) return setActOpen(false)
            setActividad(actividadRef.current)
            setActOpen(true)
          }}
          title={actOpen ? t('act.close') : t('act.open')}
        >
          <span className="act-btn-dot" />
          {(() => {
            const aqui = running.filter((r) => roleStates[r] && roleStates[r] !== 'delivering' && tabDeAgente(r) === activeTab)
            // Con uno se dice su nombre, que es lo que estás mirando. Con varios
            // el nombre sobra: lo que quieres saber es cuántos hay dentro.
            if (aqui.length === 1) return t('act.watchingWho', { name: memberOf(aqui[0]).name })
            if (aqui.length > 1) return t('act.watchingN', { n: aqui.length })
            // Ya terminó: el rastro sigue sirviendo para revisar qué tocó.
            const ultimo = actividadRef.current[actividadRef.current.length - 1]
            return ultimo?.role ? t('act.didWho', { name: memberOf(ultimo.role).name }) : t('act.watching')
          })()}
          {(() => {
            const r = resumenActividad(actividadRef.current)
            return r.pasos ? (
              <span className="act-btn-n">
                {r.pasos}
                {r.archivos.length ? ` · ${r.archivos.length} 📄` : ''}
              </span>
            ) : null
          })()}
        </button>
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
              ? t('composer.permWrite')
              : t('composer.permRead')
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
        {/* adjuntar: arrastrar y ⌘V seguían funcionando, pero no se descubrían */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = '' // permite volver a elegir el mismo archivo
          }}
        />
        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title={t('composer.attach')}
          aria-label={t('composer.attach')}
        >
          <IconClip size={18} />
        </button>
        {/* La caja envuelve el textarea para poder poner el botón de borrar
            DENTRO del campo. Se lleva el flex y el ancho máximo que antes tenía
            el textarea, para que la fila del composer no cambie de reparto. */}
        <div className={input ? 'composer-caja con-borrar' : 'composer-caja'}>
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
              ? t('composer.busy', { names: running.map((r) => memberOf(r).name).join(', ') })
              : squad.length > 1
                ? t('composer.placeholder', { name: memberOf(squad[1]?.id).name, n: squad.length })
                : t('composer.placeholderSolo')
          }
          autoFocus
        />
        {/* Solo cuando hay algo que borrar: un botón siempre visible que la
            mayoría del tiempo no hace nada es ruido en el sitio donde escribes.
            Borra el TEXTO, no los adjuntos —cada chip tiene su propia ✕— y
            devuelve el foco a la caja, que es donde ibas a seguir. */}
        {input && (
          <button
            type="button"
            className="composer-borrar"
            onClick={() => {
              setInput('')
              // la caja crece con el contenido: al vaciarla hay que devolverle su
              // altura de una línea, o se queda abierta y vacía
              if (inputRef.current) {
                inputRef.current.style.height = 'auto'
                inputRef.current.focus()
              }
            }}
            title={t('composer.clear')}
            aria-label={t('composer.clear')}
          >
            <IconClose size={14} />
          </button>
        )}
        </div>
        <button type="submit">{t('composer.send')}</button>
      </form>
    </div>
  )
}

