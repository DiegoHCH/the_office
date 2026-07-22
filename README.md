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

- **👥 Squad configurable** — hasta 4 agentes visibles de un catálogo de 6 roles (Dev, Research, UI/UX, QA, Revisor de PR, Docs). Nombres y avatares 3D personalizables por cuenta (galería de 46 personajes).
- **⚡ Tareas en paralelo** — cada agente tiene su propia sesión de Claude Code. Le hablas a varios a la vez y trabajan simultáneamente.
- **🤝 Colaboración real (handoffs)** — *"Nami, investiga X y pásaselo a Luffy"*: el resultado de uno se encadena como contexto en la sesión del otro.
- **📋 Standup** — `/standup` y cada agente retoma su última sesión y reporta en qué quedó (memoria persistente).
- **🎭 Vida ambiental** — frases por rol, música, paseos y visitas entre ellos cuando están libres.
- **🎨 Escena** — oficina isométrica con 4 temas (Clásico, Noche con lámparas, Playa, Sakura), estados de mirada y caminatas.
- **🛠 Herramientas con feedback** — ves en vivo qué archivo edita o qué comando corre cada agente; botón ⏹ para detener; 🔘 respuesta rápida a menús de opciones; 🖼 pegar/arrastrar imágenes.
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

Instalando el `.dmg`: ábrelo, arrastra **La Oficina** a Aplicaciones. Al primer arranque, como no está firmada con Apple Developer, usa **click derecho → Abrir**.

### Hablarle al squad

| Escribes | Resultado |
|---|---|
| `arregla el bug del login` | Va al agente principal (o al del rol según palabras clave) |
| `Zoro, corre los tests` | Nombre al inicio → a ese agente |
| `@nami investiga X` | `@nombre` en cualquier parte |
| `Nami, investiga X y pásaselo a Luffy` | Handoff encadenado entre agentes |

**Comandos:** `/standup` · `/squad` · `/model <opus\|sonnet\|haiku\|fable>` · `/clear` · cualquier otro `/comando` pasa a Claude Code (tus skills funcionan).
**Atajos:** <kbd>⌘K</kbd> nueva · <kbd>⌘Y</kbd> historial · <kbd>⌘1</kbd>–<kbd>⌘4</kbd> dirigir a cada agente · <kbd>Esc</kbd> cerrar paneles.

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

- ✅ **v1.0** — squad, configuración completa, vida de oficina, monitor, standup, temas, guía integrada, icono e instalador DMG
- ✅ **v2** — detener tareas, detalle en vivo, imágenes en el chat
- ✅ **v3** — botones de respuesta rápida, abrir terminal
- ⏭️ **v4** — soporte Windows (portar Keychain, `vm_stat`, rutas y binario)
- 💡 firma/notarización Apple · más roles · steering (limitado por el modo headless)

## ⚠️ Notas

- En modo **edición** los agentes auto-aceptan sus cambios — úsalo en repos con git (todo reversible).
- El modo headless no cubre interacciones que sí tiene la terminal (plan mode, aprobación caso a caso, `/login`); para eso está el botón **🖥 Abrir terminal**.
- Proyecto personal, sin afiliación con Anthropic.

---

<div align="center"><sub>Hecho con 🏴‍☠️ · La Oficina corre Claude Code con tu suscripción</sub></div>
