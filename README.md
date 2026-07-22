# La Oficina

Cliente visual 3D de **Claude Code**: una oficina isométrica de escritorio donde escribes tus
prompts (en vez de la terminal) y un squad reacciona a lo que Claude hace. Corre Claude Code por
debajo con tu **suscripción** (no la API) → **$0 por token**.

## Stack
- **Electron** (app de escritorio) + **Vite** + **React**
- **React Three Fiber (R3F)** + **drei** (escena 3D, Three.js)
- Puente a Claude: el proceso principal de Electron ejecutará el binario `claude` en modo headless
  (`-p --output-format stream-json`) — **sin `ANTHROPIC_API_KEY`** para usar tu login.

## Requisitos
- Node.js ≥ 18 (probado con v22)
- CLI `claude` instalado y con sesión iniciada (`claude` en `~/.local/bin`)

## Desarrollo
```bash
npm install
npm run dev      # levanta Vite + abre la ventana de Electron
```

## Roadmap
- **F0 — Scaffold** ✅ Electron + React + R3F, sala isométrica placeholder (primitivas), puente IPC probado.
- **F1 — Sala + personaje** Reemplazar primitivas por glTF (packs CC0 / Mixamo / Spline).
- **F2 — Puente a Claude** `spawn('claude', […stream-json…])` desde el main → IPC → reacciones.
- **F3 — Animaciones + chat** UI de chat sobre el canvas, streaming token a token.
- **F4 — Escalar** Más escritorios y roles, cámara, empaquetado distribuible.

> Nota: la sala actual está hecha con primitivas para que arranque sin depender de assets externos.
> El acabado "bonito" del diorama vendrá de mejores modelos + iluminación en F1.
