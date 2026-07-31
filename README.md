<div align="center">

# 🏢 La Oficina

**Un cliente visual 3D para [Claude Code](https://claude.com/claude-code) — escribe en una oficina isométrica en vez de la terminal, con un squad de agentes que trabaja por ti… en paralelo.**

Cada personaje es una sesión real de Claude Code con su propio rol, memoria y contexto. Corre con **tu suscripción** (no la API de pago) → **$0 por token**.

![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/react--three--fiber-000?logo=three.js&logoColor=white)
![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-000?logo=apple&logoColor=white)
![Cost](https://img.shields.io/badge/API-%240-2dd4bf)

</div>

---

## ✨ Qué es

**La Oficina** convierte tu equipo de Claude Code en un squad de agentes visible en un diorama 3D. En lugar de escribir en la terminal, escribes en una app de escritorio: cada agente es un personaje sentado en su escritorio que se para a escuchar, teclea, camina a entregarte el trabajo y se toma un café cuando no hay nada que hacer.

Por debajo, la app ejecuta el binario `claude` en **modo headless** con el login de tu suscripción — **sin `ANTHROPIC_API_KEY`**, así que no factura por token; consume el cupo de tu plan igual que la terminal.

## 🎬 Funcionalidades

### El squad
- **👥 Hasta 6 agentes activos** de un catálogo de 7 roles (Dev, Research, UI/UX, QA, Revisor PR, Docs, Publicador) más los **roles personalizados** que crees (nombre, foco, keywords de ruteo, emoji, color y personaje 3D) — y que puedes **editar después** de crearlos.
- **Panel 👥 Agentes** (submenu de Configuración): activa/desactiva con **switch**, reordena con **drag & drop** (el 1º activo es el principal), renombra, elige personaje en la galería (46 modelos, sin repetir — **aplica al instante**) y edita la **personalidad** de cada uno (un `.md` por rol y perfil). Si borraste un rol predeterminado, **♻️ Restaurar** lo recupera.
- **Primer arranque limpio**: solo el principal activo, con un **nombre real sorteado** (nada de "Dev" y "QA" como nombres).
- **⚡ Tareas en paralelo** — cada agente tiene su propia sesión de Claude Code. Si uno está ocupado, tu mensaje se **encola** (y puedes sacarlo con ✕).
- **🤝 Handoffs** — *"Research, investiga X y pásaselo al Dev"*: el resultado de uno se encadena como contexto en la sesión del otro, y el personaje **camina** a entregárselo.
- **🔎 Revisor PR** — corre tus skills de PR de punta a punta (self-review + `push` + `gh pr create` + tracking en Jira/Slack vía conectores MCP).
- **🚀 Publicador** — sube tus documentos a **GitHub Pages** (crea el repo si no existe, genera el índice y devuelve la URL), siempre con confirmación previa.
- **🧠 Modelo por agente** — cada rol puede fijar su modelo (UI/UX con Opus, QA con Haiku…); el selector global queda de default.
- **📢 Broadcast** — `@todos <mensaje>` envía el mismo prompt a todos los agentes libres a la vez.

### Superpoderes (skills, plugins y MCP)
- **🧩 Skills por perfil** — catálogo curado del repo oficial de Anthropic con recomendaciones por cargo (frontend design para UI/UX, testing para QA, Word/PDF/PowerPoint/Excel para Docs…), instalación desde **cualquier repo de GitHub** (detecta los `SKILL.md` adentro) y **crear skills propias** con el esqueleto listo. Se instalan en el `CLAUDE_CONFIG_DIR` del perfil: los agentes las usan solos.
- **🔌 Plugins** — paquetes completos (skills + comandos + subagentes + MCP) desde marketplaces o repos directos, con buscador del catálogo oficial ordenado por instalaciones.
- **🌐 Servidores MCP** — Playwright (el QA maneja un navegador real), Chrome DevTools, Context7, Figma o cualquier servidor propio (npx o URL), gestionados por perfil.

### El chat
- **⌨️ Composer multilínea** — Enter envía, Shift+Enter salto de línea; la caja crece con el texto (ancho fijo centrado en pantallas grandes).
- **📌 Plantillas de prompts** — escribe `/` y salen tus snippets guardados por perfil; Enter/Tab inserta, y se crean/borran desde el mismo popover.
- **✏️/🔒 Chip de permiso** junto al composer — a la vista si el squad puede editar archivos (ámbar) o solo investigar (gris); un clic lo alterna. En proyectos **sin git**, la app advierte que no hay red de seguridad.
- **🖱 Click en un personaje** — le diriges el mensaje (igual que ⌘1–⌘6). Y click en el **nombre** de un mensaje filtra el chat a solo ese agente.
- **🛠 Herramientas con feedback** — ves en vivo qué archivo edita o qué comando corre cada agente, con **cronómetro**, su **checklist 📝 en tiempo real** (TodoWrite) y **🪙 tokens por tarea** (acumulado en el monitor); botón ⏹ para detener; 🔘 respuesta rápida a menús de opciones.
- **🔀 Vista de diff** — si la tarea editó archivos, la respuesta ofrece el `git diff` coloreado del proyecto.
- **🔍 Buscar en la conversación** — ⌘F con n/total y navegación entre coincidencias.
- **💬 Citar** — selecciona un fragmento de una respuesta y pásalo al composer como cita.
- **⚠️ Aviso de colisión** — si dos agentes van a editar el mismo repo a la vez, la app avisa.
- **🔁 Errores recuperables** — si `claude` falla, el error llega al chat **con el stderr** y un botón Reintentar; cualquier mensaje tuyo se puede **✏️ editar y reenviar**.
- **🎨 Resaltado de sintaxis** — bloques de código coloreados (12 lenguajes), con botón de copiar; cada respuesta tiene el suyo.
- **📎 Adjuntos** — arrastra carpetas, archivos e imágenes (o pega con ⌘V).
- **📋 Standup** — `/standup` y cada agente retoma su última sesión y reporta — mientras, en la escena, **el squad se reúne en círculo en el centro de la sala**.

### Documentos (antes "artifacts")
- Pide un **reporte, documento o dashboard** y se genera un HTML autocontenido que abres dentro de la app; panel 📄 con listado, revelar en Finder y exportar a zip. El Publicador los sube a Pages si quieres compartirlos.

### Correr el proyecto
- **📱 Dónde correr** — el panel aparece solo si la carpeta tiene un proyecto que se pueda correr. En **Flutter** lista dispositivos y emuladores (los móviles enchufados primero) y ofrece **solo lo que el proyecto soporta**: sin carpeta `web/` no aparece Chrome. La lista se mantiene sola al **enchufar y desenchufar**.
- **🎛 Tus configuraciones** — si el proyecto tiene `.vscode/launch.json`, salen las mismas que ofrece el editor, con su flavor y sus dart-defines.
- **▶️ Emuladores** — lanzarlos desde la app y **cerrarlos** si ya están arriba; al lanzar espera a que arranquen de verdad antes de avisar.
- **⚡ Barra flotante** — hot reload, hot restart, detener (o cancelar la compilación), abrir y ver la salida, que es donde aparece el motivo cuando una compilación falla. **Varios dispositivos a la vez** con un chip cada uno: las acciones van a todos, o a uno si lo enfocas.
- **🤖 Recarga al terminar el agente** — con `auto` encendido se recarga sola al acabar cada turno, y elige: `pubspec`/nativo avisa de recompilar, y `main()`, enums, jerarquías o variables de nivel de archivo (un provider) piden **hot restart**, porque un reload no re-ejecuta los inicializadores globales.
- **⌨️ `/correr el emulador android`** — lanza sin abrir el panel; entiende tipo y plataforma, nombre y configuración. Si la frase no alcanza, no adivina: abre el panel y dice entre cuáles dudaba.
- **🌐 Web y escritorio (npm)** — en proyectos npm el objetivo es un **script** del `package.json`, no un dispositivo: los que se quedan corriendo van primero, el gestor lo decide el lockfile y la URL se detecta de la salida del servidor.

### La app
- **🎛 Barra superior limpia** — un solo control de contexto (`💼 work / proyecto ▾` con perfiles como tabs, proyectos y **➕ Agregar proyecto…** para carpetas fuera de la raíz del perfil), íconos para Documentos/Historial, **+ Nueva** como acción primaria y ⚙️.
- **🌗 Tema claro u oscuro** — Auto sigue al sistema, o lo fijas en Preferencias; toda la interfaz, no solo la escena.
- **🧠 Razonamiento a la vista** — cada respuesta puede desplegar lo que el agente pensó antes de contestar.
- **🌐 Español o inglés** — toda la interfaz sale de un diccionario y arranca en el idioma del sistema; se cambia en ⚙️ Preferencias. Cambia también la Guía de uso y **los agentes responden en el idioma elegido**.
- **🎨 Estilo Material 3 con iconos Material Symbols** — botones pill, switches M3, superficies con elevación, scrollbars propias.
- **🗂 Pestañas de conversación** — los hilos que quieras, cada uno con sus mensajes, sesiones y colas, y se puede trabajar en varios a la vez con un agente distinto en cada uno; al cerrar uno, queda en el historial.
- **🕘 Historial con búsqueda** — cada conversación se guarda sola y se retoma con todo su contexto; busca por título, proyecto **y contenido de los mensajes**, **✏️ renombra**, **📌 fija** (a salvo de la purga) y **⬇ exporta a Markdown**.
- **📊 Monitores** — dos burbujas: Sistema (CPU/RAM reales) y Claude (modelo en uso, 🪙 tokens de la conversación + % de sesión y semana, con **aviso al pasar del 90%**). El modelo se **sincroniza con el `/model` de tu terminal**.
- **🖥 Integración macOS** — badge del **Dock** y **Tray 🏢** en la barra de menús con el nº de agentes trabajando, atajo global **⌥Espacio** (trae la app con el composer listo desde cualquier parte), y **powerSaveBlocker**: el Mac no se duerme mientras el squad trabaja.
- **🎬 Intro cinemática** — la app abre llegando al edificio de La Oficina: la cámara se acerca, las puertas se abren y un destello funde a tu oficina (saltable y desactivable).
- **🖥 Splash screen**, la ventana **recuerda tamaño y posición**, la cámara 3D **recuerda su encuadre** (doble click lo restablece), **aviso de versión nueva** que **descarga el DMG directo** y abre el instalador, y la escena **ahorra batería** cuando la ventana está tapada (multi-monitor friendly: visible = 60fps).
- **🦊 Mascota** — zorro, shiba, husky, lobo, venado o alpaca paseando por la oficina (o ninguna).
- **🎭 Vida ambiental** — frases por rol, música, paseos y visitas con detección de obstáculos; temas Clásico, Noche, Playa, **🌸 Sakura** (pétalos), **🍂 Otoño** (hojas secas), **❄️ Invierno** (nieve) y **🌗 Auto**.
- **🧠 Pizarra SQUAD.md** — memoria común del squad en la raíz del proyecto.
- **⏳ Cola persistente** — los mensajes encolados sobreviven un cierre de la app: al volver pregunta si los retoma.
- **💾 Exportar/importar configuración** — squad, personalidades y plantillas en un JSON para respaldar o migrar, con **respaldo automático semanal**.
- **🎬 Intro cinemática y 🎓 tour guiado** al primer arranque, ambos saltables y desactivables.
- **📘 CLAUDE.md del proyecto** y **presets de squad** (Equipo web / mobile / research) desde el menú.
- **🧹 Mantenimiento solo** — purga de adjuntos viejos y tope de 100 conversaciones al arrancar (las 📌 fijadas no cuentan).

## 🧱 Stack

| Capa | Tecnología |
|---|---|
| App de escritorio | **Electron 43** |
| UI | **React 18** + **Vite 5** |
| Escena 3D | **React Three Fiber** + **@react-three/drei** (Three.js) |
| Markdown | react-markdown + remark-gfm |
| Empaquetado | electron-builder (DMG) |
| Motor de IA | binario **Claude Code** en modo headless (`-p --output-format stream-json`) |

## 📦 Requisitos

### Para usar la app

- **macOS** (Apple Silicon) — Windows en el roadmap
- **Claude Code** instalado y con sesión iniciada — la regla simple: si `claude` arranca en tu terminal, La Oficina funciona
  ```bash
  # instalar (si no lo tienes)
  curl -fsSL https://claude.ai/install.sh | bash
  claude   # y sigue el flujo de /login con tu cuenta Pro/Max
  ```
- **Sin** `ANTHROPIC_API_KEY` en el entorno (para usar la suscripción y no la API de pago)
- **Homebrew** en el PATH de tu shell (`~/.zprofile` con `eval "$(/opt/homebrew/bin/brew shellenv)"`) — los agentes ejecutan comandos con tu perfil de zsh; la app además suma `/opt/homebrew/bin`, `/usr/local/bin` y `~/.local/bin` al PATH de cada agente

### Para el Revisor PR (flujo de PR) y el Publicador (GitHub Pages)

Ambos usan **GitHub CLI** autenticado con tu cuenta:

```bash
brew install gh
gh auth login    # GitHub.com → SSH (o HTTPS) → Login with a web browser
gh auth status   # verifica: debe mostrar tu cuenta con scope 'repo'
```

El token queda en el keyring del sistema, así que sirve para los procesos que lanza la app sin re-loguearse. Además:

- **git** configurado (`user.name` / `user.email`) y con acceso a los repos donde vayas a abrir PRs
- El **Publicador** necesita permiso para crear repos públicos en tu cuenta (usa `gh repo create` y GitHub Pages); siempre pide confirmación antes de publicar
- Opcional para el Revisor PR: **acli** (Atlassian CLI) y los conectores MCP de Jira/Slack configurados en Claude Code, si tus skills de PR hacen tracking en esas herramientas

### Para desarrollo (solo si compilas la app)

- **Node.js ≥ 18** (probado con v22)

> **¿Qué cuenta necesito?** La Oficina no agrega costo: solo lanza el `claude` que ya usas. Funciona con **cualquier plan con el que el CLI corra en tu terminal** — Claude Code hoy requiere un plan **Pro/Max** (o créditos de API); la cuenta **gratuita** de la web no habilita el CLI. Ojo: correr varios agentes en paralelo consume el cupo de tu plan más rápido.

> Opcional: crea `~/.claude-work` y `~/.claude-private` (vía `CLAUDE_CONFIG_DIR`) para tener dos cuentas con squads, proyectos, historial y preferencias independientes.

## 🚀 Uso

```bash
# desarrollo
npm install
npm run dev            # levanta Vite y abre la ventana de Electron

# empaquetar
npm run dist:mac       # genera release/La Oficina-<versión>-arm64.dmg
npm run dist:app       # build rápido sin instalador (carpeta .app)
```

Instalando el `.dmg`: ábrelo y arrastra **La Oficina** a Aplicaciones.

La app va firmada con Developer ID, así que ya no aparece el *"está dañada"* que obligaba a rescatarla con `xattr -cr`. Falta el ticket de notarización, y hasta que esté macOS dirá que *no pudo verificarla*: la primera vez ábrela con **clic derecho → Abrir** y confirma. Una sola vez; después arranca normal.

### Hablarle al squad

| Escribes | Resultado |
|---|---|
| `arregla el bug del login` | Va al agente principal (o al del rol según palabras clave) |
| `<nombre del QA>, corre los tests` | Nombre al inicio → a ese agente |
| `@<nombre> investiga X` | `@nombre` en cualquier parte |
| `<Research>, investiga X y pásaselo a <Dev>` | Handoff encadenado entre agentes |
| 🖱 click en un personaje | Prefija su nombre en el composer |

**Comandos:** `/standup` · `/squad` · `/model <opus\|fable\|sonnet\|haiku>` · `/clear` · cualquier otro `/comando` pasa a Claude Code (tus skills funcionan).
**Atajos:** <kbd>⌘K</kbd> nueva · <kbd>⌘Y</kbd> historial · <kbd>⌘,</kbd> configuración · <kbd>⌘1</kbd>–<kbd>⌘6</kbd> dirigir a cada agente · <kbd>Esc</kbd> cerrar paneles (por capas).

## 🏗 Arquitectura

```
 Renderer (React + R3F)  ⇄ IPC ⇄  Main (Electron / Node)
   escena 3D + chat                 spawn('claude', ['-p','--output-format','stream-json', …])
                                     · una sesión por agente (--resume, --append-system-prompt)
                                     · sin ANTHROPIC_API_KEY → suscripción → $0
```

- `electron/main.js` — spawnea y gobierna los procesos `claude`, parsea el stream NDJSON a eventos, persiste sesiones/historial/bounds, monitor de recursos, splash, aviso de versión, limpieza de almacenamiento.
- `src/App.jsx` — chat, enrutado por rol, handoffs, cola, comandos, paneles y configuración.
- `src/Office.jsx` — la escena 3D (sala, escritorios, personajes, temas, vida ambiental, render por visibilidad).
- `src/scene/` — carga de personajes glTF (`Character3D`), props (`GltfProp`), miniaturas de avatares.

## 🎨 Créditos de assets

- **Muebles** — [Kenney · Furniture Kit](https://kenney.nl/assets/furniture-kit) (CC0)
- **Personajes** — [Quaternius · Animated Characters](https://quaternius.com) (CC0)
- **Mascotas (zorro, shiba, husky, lobo, venado, alpaca) y plantas** — [Quaternius](https://quaternius.com) (CC0) · planta de tallo por CreativeTrio (CC0) · "House plant" por [Poly by Google](https://poly.pizza/m/3qh9saogdJd) (CC-BY 3.0)
- **Texturas** (ladrillo y madera) — [ambientCG](https://ambientcg.com) (CC0)
- **Logo de Flutter** — marca de Google, usado en el cuadro decorativo

## 🗺 Roadmap

- ✅ **v1.0** — squad de hasta 6, crear/eliminar roles, Revisor PR y Publicador, documentos locales, adjuntos, cola de mensajes, sala ampliada, temas, monitor, standup, instalador DMG
- ✅ **v1.1** — onboarding (solo principal + nombres reales + splash), barra con contexto unificado y proyectos externos, panel Agentes (switch, drag & drop, restaurar, editar), errores con reintentar, cronómetro, cola cancelable, copiar, búsqueda de historial, click al personaje, render por visibilidad, ventana persistente, aviso de versión, permisos a la vista, preferencias por perfil, estilo Material 3
- ✅ **v1.2** — aviso de edición sin git, nombres únicos, filtro del chat por agente, exportar conversación a Markdown, resaltado de sintaxis, tema automático 🌗, badge ⏳ de cola en la escena, integración con el Dock, broadcast `@todos`, cámara persistente con reset por doble click
- ✅ **v1.3** — tokens por tarea 🪙 y acumulado en el monitor, checklist del agente en vivo 📝, plantillas de prompts con `/`, buscar en la conversación (⌘F), vista de diff 🔀, Tray en la barra de menús 🏢, atajo global ⌥Espacio, cola persistente, standup visual en el centro de la sala
- ✅ **v1.4** — 🧩 skills por perfil (catálogo oficial + cualquier repo + crear propias), 🔌 plugins (marketplaces), 🌐 servidores MCP, 🧠 modelo por agente, editar y reenviar mensajes, 📌 fijar conversaciones, aviso de cuota alta, 💾 exportar/importar configuración, powerSaveBlocker
- ✅ **v1.5** — imágenes con Nano Banana 🍌 (MCP + env vars), Engram y shadcn como recomendaciones, @autocompletar, miniaturas de adjuntos + visor, sub-agentes visibles 👻, estadísticas 📈, standup programado, deep links `la-oficina://`, tour de bienvenida 🎓, consola de diagnóstico 🔧, SQUAD.md al .gitignore
- ✅ **v1.6** — usar Documentos como contexto 💬, renombrar y buscar por contenido en el historial, mascota de oficina 🦊, auto-retry en errores transitorios, standup → Slack 📤, plantillas con {{variables}}, CI en GitHub Actions (checks + smoke test + DMG automático) y refactor de App.jsx en módulos
- ✅ **v1.7** — glow-up gráfico «loft» (ladrillo, madera, luz cálida, bloom/ACES/tilt-shift, estaciones 🌸🍂❄️), intro cinemática 🎬 sobre la ciudad, **interfaz en español o inglés** 🌐, pestañas de conversación, modo director 🎬, rediseño del menú con iconos Material, seis mascotas, citar selección, presets de squad, CLAUDE.md desde la app, respaldo automático, skills en lote, code-splitting, tests de ruteo y Electron 43 con asar
- ✅ **v1.8** — **tema claro** 🌗 para toda la interfaz, **razonamiento del agente** visible, modelo y permiso **por proyecto**, botón de adjuntar 📎, pestañas renombrables y reordenables, borrar documentos 🗑, medidor de contexto, ruteo por nombre esté donde esté, ESLint en el CI y la guía en inglés generada del español
- ⏭️ **Épica v2.0** — compañero móvil **Android en Flutter**: servidor WS embebido + QR en el desktop, app con chat/estado/notificaciones, acceso remoto vía Tailscale
- ⏭️ soporte **Windows** (portar Keychain, `vm_stat`, rutas y binario)
- ⏸ auto-update completo (requiere Apple Developer ID; hoy la notificación descarga el DMG directo)
- 💡 firma/notarización Apple · steering (limitado por el modo headless)

## ⚠️ Notas

- En modo **edición** los agentes auto-aceptan sus cambios — úsalo en repos con git (todo reversible).
- El modo headless no cubre interacciones que sí tiene la terminal (plan mode, aprobación caso a caso, `/login`); para eso está el botón **🖥 Abrir terminal**.
- Proyecto personal, sin afiliación con Anthropic.

---

<div align="center"><sub>Hecho con 🏴‍☠️ · La Oficina corre Claude Code con tu suscripción</sub></div>
