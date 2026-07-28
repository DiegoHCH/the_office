# La Oficina móvil — plan de trabajo

Compañero **Android en Flutter** para La Oficina: hablarle al squad y ver en qué anda desde el teléfono, con el Mac haciendo todo el trabajo real.

Esto recoge lo decidido hasta 2026-07-27 (issues [#69](https://github.com/DiegoHCH/the_office/issues/69), [#70](https://github.com/DiegoHCH/the_office/issues/70), [#71](https://github.com/DiegoHCH/the_office/issues/71)) y lo que hace falta resolver antes de escribir código.

---

## La idea en una frase

El Mac sigue siendo quien ejecuta Claude Code; el móvil es **un cliente más** del mismo estado. No hay backend en la nube, no hay cuenta, no hay servidor que mantener.

```
┌─────────── Mac (siempre encendido) ───────────┐
│  Electron main                                │
│   ├─ procesos de Claude Code (los agentes)    │
│   ├─ IPC  ──────────────► ventana React       │
│   └─ servidor HTTP+WS ──┐                     │
└─────────────────────────┼─────────────────────┘
                          │  Tailscale (o LAN)
                    ┌─────▼──────┐
                    │  Flutter   │
                    └────────────┘
```

La clave: **el renderer de escritorio y el móvil son clientes equivalentes**. Todo lo que hoy pasa por `window.oficina.*` se vuelve un protocolo, y la ventana de Electron pasa a hablarlo también (o al menos, el protocolo se define a partir de ella).

---

## Decisiones ya tomadas

| Tema | Decisión | Por qué |
|---|---|---|
| **Acceso remoto** | **Tailscale**, no exponer puertos ni túneles públicos | Es una VPN entre tus dispositivos: nada queda expuesto a internet. Gratis hasta 100 dispositivos. Impacto en el Mac despreciable (un demonio en reposo) |
| **Transporte** | WebSocket, servidor embebido en el main process | Ya hay un stream de eventos; WS es el encaje natural |
| **Reconexión** | Backoff exponencial + **resync por snapshot** | Al reconectar, el servidor manda el estado completo (agentes corriendo, colas, mensajes desde el último evento visto). Se recupera solo de cortes |
| **Mensajes offline** | **Outbox local** en el móvil | Lo que escribes sin conexión queda «⏳ pendiente» y se despacha al reconectar. No se pierde nada |
| **Notificaciones** | Locales, vía foreground service que mantiene el WS | Sin Firebase: para uso personal no compensa montar FCM. Queda como upgrade si el foreground service resulta poco fiable |
| **Plataforma** | Android primero | Es lo que usa el usuario; iOS exige cuenta de desarrollador |

---

## Fase 1 — El protocolo y el servidor (en este repo)

**Issue [#69](https://github.com/DiegoHCH/the_office/issues/69).** Sin esto no hay nada que hacer en Flutter.

### Qué hay que construir
- Servidor **HTTP + WS** en el main process, **apagado por defecto**, se enciende en Preferencias.
- **Emparejamiento por QR**: el desktop muestra un QR con `host:puerto` + token; el móvil lo escanea. Token persistido en ambos lados.
- **`PROTOCOL.md`**: la fuente de verdad. Métodos petición/respuesta + eventos empujados.
- **Snapshot de resync**: un método que devuelve todo el estado observable de golpe.

### Qué exponer, y qué no

Hoy el preload expone **59 handlers**. La mayoría no tiene sentido en remoto, y unos cuantos son peligrosos de exponer. Propuesta de corte:

**Núcleo del móvil (fase 1)**
`ask` · `stop` · el stream de eventos · `history.*` · `squad.get` · `stats` · `getConfig` · `reset`/`setSession` · `artifacts.list`

**Sin sentido en remoto** — son acciones locales del Mac, se quedan fuera
`openTerminal` · `openHelp` · `openBoard` · `openClaudeMd` · `openPersona` · `artifacts.reveal` · `artifacts.pickDir` · `pathForFile` · `dockBadge` · `addProject` (usa un picker nativo)

**Requieren adaptación**
- `artifacts.open` → en móvil no se abre una ventana: el servidor **sirve el HTML por HTTP** y el teléfono lo abre en un webview.
- `saveImage` / `imageData` → subir bytes por WS o por un `POST /upload`.
- `gitDiff` → devuelve texto, sirve tal cual.

**Fuera al menos en fase 1 — mutan la máquina**
`skills.install` · `plugins.install` · `mcp.add` · `config.import`
Un canal remoto que pueda instalar cosas amplía mucho la superficie de ataque para poca ganancia; se administran desde el escritorio.

### ⚠️ Lo que hay que pensar antes de escribir el servidor

**`ask` en modo edición ejecuta comandos arbitrarios en tu Mac.** Ese es el poder real de la app, y abrirlo por red merece cuidado explícito:

1. **Escuchar solo en la interfaz de Tailscale**, no en `0.0.0.0`. Si Tailscale no está activo, solo LAN — y decidir si eso se permite.
2. **Token obligatorio** en cada conexión, no solo al emparejar. Rotable y revocable desde Preferencias.
3. **Decidir el permiso por defecto desde el móvil.** Mi recomendación: que el móvil arranque en **solo lectura** y que pasar a edición exija confirmarlo *en el escritorio*. Un teléfono se pierde o se desbloquea más fácil que un Mac.
4. **Ver quién está conectado** y poder echarlo, en Preferencias.

Esto no está decidido todavía — es la primera conversación que tener.

---

## Fase 2 — La app Flutter (repo nuevo)

**Issue [#70](https://github.com/DiegoHCH/the_office/issues/70).** Repo aparte: `la-oficina-mobile`.

- Cliente del protocolo con reconexión y resync.
- Chat con **streaming** y markdown, estado de agentes en vivo, tokens por tarea.
- Enviar prompts, `@todos`, `/standup`, cancelar tareas.
- Historial.
- **Outbox** para lo escrito sin conexión.
- Material 3, hermana visual del escritorio.

Aquí sí conviene arquitectura de verdad desde el principio (el escritorio no la tiene y se nota): modelos del protocolo generados o al menos centralizados, capa de cliente WS aislada, y estado con lo que el usuario prefiera — es su terreno.

**Decisión pendiente:** ¿los modelos del protocolo se escriben a mano en Dart, o se generan desde un esquema compartido? Escribirlos dos veces es la vía rápida para que se desincronicen, igual que pasó con la guía en dos idiomas.

---

## Fase 3 — La oficina en el teléfono

**Issue [#71](https://github.com/DiegoHCH/the_office/issues/71).** Lo bonito, y lo último.

Dos caminos, sin decidir:

- **A · `webview_flutter`** embebiendo la escena R3F que sirve el Mac. Reuso total, cero trabajo de arte. Pesa, y en un móvil de gama media R3F puede ir justo.
- **B · Oficina isométrica 2D con Flame.** Sprites caminando, badges de cola, standup en círculo. Mucho más ligero y nativo, pero es rehacer la escena.

Además: notificaciones locales con foreground service, y una guía de Tailscale para el usuario.

---

## Por dónde empezar

1. **Cerrar las preguntas de seguridad** de la fase 1 (arriba). Son cuatro decisiones, no código.
2. **Escribir `PROTOCOL.md`** antes que el servidor: definir métodos, eventos y el snapshot. Es el contrato que van a compartir tres clientes.
3. **Servidor WS mínimo**: `ask` + stream + snapshot, con token. Probarlo con un script de Node o `websocat` antes de tocar Flutter.
4. **Encender/apagar y QR** en Preferencias.
5. Recién ahí, el scaffold de Flutter.

Un atajo tentador que conviene evitar: montar el servidor reenviando `ipcMain` a lo bruto. El protocolo debe ser una capa pensada, con su documento, o acabará siendo 59 métodos sin criterio y con agujeros.

---

## Riesgos conocidos

- **El Mac suspendido.** Ya hay `powerSaveBlocker` mientras el squad trabaja, pero si el Mac duerme con todo ocioso, el móvil no alcanza nada. Hay que decidir si el servidor mantiene el Mac despierto (gasta batería) o si el móvil simplemente muestra «desconectado».
- **Tailscale caído o sin red.** El outbox lo cubre para envíos; para leer, el móvil debe funcionar con lo último cacheado.
- **Versiones desalineadas.** El protocolo necesita número de versión desde el día uno: el móvil se actualiza por su cuenta y el desktop por la suya.
- **Superficie de ataque.** Repetido a propósito: esto abre una puerta a ejecutar comandos en tu máquina. Es lo que más cuidado merece de todo el plan.
