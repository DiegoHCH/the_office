<div align="center">

# 🏢 La Oficina

**Un cliente visual 3D para [Claude Code](https://claude.com/claude-code) — escribe en una oficina isométrica en vez de la terminal, con un squad de agentes que trabaja por ti… en paralelo.**

Cada personaje es una sesión real de Claude Code con su propio rol, memoria y contexto. Corre con **tu suscripción** (no la API de pago) → **$0 por token**.

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/react--three--fiber-000?logo=three.js&logoColor=white)
![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-000?logo=apple&logoColor=white)
![Cost](https://img.shields.io/badge/API-%240-2dd4bf)

</div>

---

## ✨ Qué es

**La Oficina** convierte tu equipo de Claude Code en una tripulación visible en un diorama 3D. En lugar de escribir en Warp, escribes en una app de escritorio: cada agente es un tripulante sentado en su escritorio que se para a escuchar, teclea, camina a entregarte el trabajo y se toma un café cuando no hay nada que hacer.

Por debajo, la app ejecuta el binario `claude` en **modo headless** con el login de tu suscripción — **sin `ANTHROPIC_API_KEY`**, así que no factura por token; consume el cupo de tu plan igual que la terminal.

## 🎬 Funcionalidades

- **👥 Squad configurable (hasta 6)** — catálogo de roles: Dev, Research, UI/UX, QA, Docs, **Revisor de PR (Robin)** y **Publicador (Franky)**. Nombres y avatares 3D personalizables por cuenta (galería de 46 personajes).
- **➕🗑️ Crear y eliminar roles desde la app** — arma roles propios (nombre, foco/especialidad, palabras clave de ruteo, emoji, color y personaje 3D) y borra los que no uses. Dev, Research, Revisor PR y Publicador quedan protegidos; UI/UX, QA, Docs y los personalizados se pueden eliminar.
- **🔎 Robin, dueño del flujo de PR** — corre tus skills de PR de punta a punta (self-review + `push` + `gh pr create` + tracking en Jira/Slack vía conectores MCP), igual que desde la consola.
- **🚀 Franky publica artifacts** — sube tus artifacts a **GitHub Pages** (crea el repo si no existe, genera el índice y devuelve la URL), siempre con confirmación previa porque quedan públicos.
- **⚡ Tareas en paralelo** — cada agente tiene su propia sesión de Claude Code. Le hablas a varios a la vez y trabajan simultáneamente; si uno está ocupado, tu mensaje se **encola**.
- **🤝 Colaboración real (handoffs)** — *"Nami, investiga X y pásaselo a Luffy"*: el resultado de uno se encadena como contexto en la sesión del otro, y el personaje **camina** a entregárselo.
- **🔗 Artifacts locales** — pide una página/dashboard y se genera un HTML autocontenido (con imágenes de la web) que abres en la app; panel con el listado, carpeta configurable, revelar en Finder y exportar a zip.
- **📎 Adjuntar contexto** — arrastra **carpetas y archivos** (no solo imágenes) para que el agente los lea; pega/arrastra imágenes al chat.
- **📋 Standup** — `/standup` y cada agente retoma su última sesión y reporta en qué quedó (memoria persistente).
- **🎭 Vida ambiental** — frases por rol, música, paseos y visitas entre ellos cuando están libres; caminatas con **detección de obstáculos** (rodean los escritorios) y sillas que **giran al pararse/sentarse**.
- **🎨 Escena** — oficina isométrica amplia con **6 puestos**, 4 temas (Clásico, Noche con lámparas de piso y **apliques de pared**, Playa, Sakura), estados de mirada y personalidad editable por personaje (`.md`).
- **🛠 Herramientas con feedback** — ves en vivo qué archivo edita o qué comando corre cada agente; botón ⏹ para detener; 🔘 respuesta rápida a menús de opciones.
- **🎛 Control** — perfiles (work/private), selector de proyecto, modelo y modo edición/lectura; historial retomable con contexto; notificaciones y atajos; monitor de recursos + % de uso de Claude.
- **🖥 Escape a la terminal** — un botón abre Warp (o la terminal por defecto) en el proyecto, para lo que la app no cubre (plan mode, `/login`, supervisión paso a paso).

## 🧱 Stack

| Capa | Tecnología |
|---|---|
| App de escritorio | **Electron 33** |
| UI | **React 18** + **Vite 5** |
| Escena 3D | **React Three Fiber** + **@react-three/drei** (Three.js) |
| Markdown | react-markdown + remark-gfm |
| Empaquetado | electron-builder (DMG) |
| Motor de IA | binario **Claude Code** en modo headless (`-p --output-format stream-json`) |

## 📦 Requisitos

- **macOS** (Apple Silicon) — Windows en el roadmap
- **Node.js ≥ 18** (probado con v22)
- **Claude Code** instalado y con sesión iniciada (`claude` funciona en tu terminal)
- **Sin** `ANTHROPIC_API_KEY` en el entorno (para usar la suscripción y no la API de pago)

> **¿Qué cuenta necesito?** La Oficina no agrega costo: solo lanza el `claude` que ya usas. Funciona con **cualquier plan con el que el CLI corra en tu terminal** — Claude Code hoy requiere un plan **Pro/Max** (o créditos de API); la cuenta **gratuita** de la web no habilita el CLI. Regla simple: **si `claude` arranca en tu terminal, La Oficina funciona**. Ojo: correr varios agentes en paralelo consume el cupo de tu plan más rápido.

> Opcional: crea `~/.claude-work` y `~/.claude-private` (vía `CLAUDE_CONFIG_DIR`) para tener dos cuentas con squads y proyectos independientes.

## 🚀 Uso

```bash
# desarrollo
npm install
npm run dev            # levanta Vite y abre la ventana de Electron

# empaquetar
npm run dist:mac       # genera release/La Oficina-<versión>-arm64.dmg
npm run dist:app       # build rápido sin instalador (carpeta .app)
```

Instalando el `.dmg`: ábrelo y arrastra **La Oficina** a Aplicaciones. Como no está firmada con cuenta de Apple Developer, macOS puede decir *"está dañada"*; ejecuta una vez en Terminal y ábrela normalmente:

```bash
xattr -cr "/Applications/La Oficina.app"
```

### Hablarle al squad

| Escribes | Resultado |
|---|---|
| `arregla el bug del login` | Va al agente principal (o al del rol según palabras clave) |
| `Zoro, corre los tests` | Nombre al inicio → a ese agente |
| `@nami investiga X` | `@nombre` en cualquier parte |
| `Nami, investiga X y pásaselo a Luffy` | Handoff encadenado entre agentes |

**Comandos:** `/standup` · `/squad` · `/model <opus\|sonnet\|haiku\|fable>` · `/clear` · cualquier otro `/comando` pasa a Claude Code (tus skills funcionan).
**Atajos:** <kbd>⌘K</kbd> nueva · <kbd>⌘Y</kbd> historial · <kbd>⌘1</kbd>–<kbd>⌘6</kbd> dirigir a cada agente · <kbd>Esc</kbd> cerrar paneles.

## 🏗 Arquitectura

```
 Renderer (React + R3F)  ⇄ IPC ⇄  Main (Electron / Node)
   escena 3D + chat                 spawn('claude', ['-p','--output-format','stream-json', …])
                                     · una sesión por agente (--resume, --append-system-prompt)
                                     · sin ANTHROPIC_API_KEY → suscripción → $0
```

- `electron/main.js` — spawnea y gobierna los procesos `claude`, parsea el stream NDJSON a eventos, persiste sesiones/historial, monitor de recursos.
- `src/App.jsx` — chat, enrutado por rol, handoffs, comandos, configuración.
- `src/Office.jsx` — la escena 3D (sala, escritorios, personajes, temas, vida ambiental).
- `src/scene/` — carga de personajes glTF (`Character3D`), props (`GltfProp`), miniaturas de avatares.

## 🎨 Créditos de assets

- **Muebles** — [Kenney · Furniture Kit](https://kenney.nl/assets/furniture-kit) (CC0)
- **Personajes** — [Quaternius · Animated Characters](https://quaternius.com) (CC0)
- **Logo de Flutter** — marca de Google, usado en el cuadro decorativo

## 🗺 Roadmap

- ✅ **v1.0.0** — squad de hasta 6, **crear/eliminar roles** desde la app, **Robin** (flujo de PR) y **Franky** (publicar artifacts en Pages), artifacts locales, adjuntar carpetas/archivos, cola de mensajes, sala ampliada con ruteo de caminatas + sillas animadas + apliques de pared, temas, monitor, standup, instalador DMG
- ⏭️ soporte **Windows** (portar Keychain, `vm_stat`, rutas y binario)
- 💡 firma/notarización Apple · restaurar roles predeterminados borrados · steering (limitado por el modo headless)

## ⚠️ Notas

- En modo **edición** los agentes auto-aceptan sus cambios — úsalo en repos con git (todo reversible).
- El modo headless no cubre interacciones que sí tiene la terminal (plan mode, aprobación caso a caso, `/login`); para eso está el botón **🖥 Abrir terminal**.
- Proyecto personal, sin afiliación con Anthropic.

---

<div align="center"><sub>Hecho con 🏴‍☠️ · La Oficina corre Claude Code con tu suscripción</sub></div>
