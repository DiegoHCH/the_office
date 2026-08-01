// Quién ocupa qué silla cuando un agente reparte trabajo.
//
// Vive aparte de App.jsx porque es la lógica que más ha fallado: el reparto de
// personajes, el cierre, quién hereda una silla libre y cuándo se va un invitado
// de la escena. Cada uno de esos bugs costó varias rondas de reproducir a ciegas
// justo por estar metida en un manejador de eventos de 366 líneas, donde no se
// puede probar.
//
// Aquí no hay React ni efectos: entra un estado y sale el estado nuevo más lo
// que el componente tiene que ir a hacer (crear la pestaña, sentar al personaje,
// levantarlo). Las decisiones se prueban; los efectos se aplican.

// El subagente NO es el rol cuyo personaje toma prestado: es multifunción, sin
// su persona ni su sesión. Solo se le presta la silla para que su trabajo se vea.
//
// El tope es duro por dos motivos distintos: la oficina tiene seis sillas y
// quien reparte ya ocupa una, y cada subagente es trabajo real compitiendo por
// la máquina del usuario.
export const MAX_SUBAGENTES = 5

export const estadoInicial = () => ({ subs: {}, cola: [], invitados: [] })

// Reparte una silla. Estable: el que ya tiene puesto lo conserva pase lo que
// pase, porque su pestaña y su personaje no pueden cambiar a mitad del trabajo.
export function asignaSilla(subs, subId, elegibles, max = MAX_SUBAGENTES) {
  if (!subId) return null
  if (subs?.[subId]?.rol) return subs[subId].rol
  const usados = new Set(
    Object.values(subs || {})
      .map((x) => x?.rol)
      .filter(Boolean)
  )
  if (usados.size >= max) return null
  return (elegibles || []).find((m) => m && !usados.has(m)) || null
}

// ¿Está ocupado ese personaje? Trabajando por su cuenta o prestado a un subagente.
export const ocupado = (estado, trabajando, id) =>
  (trabajando || []).includes(id) || Object.values(estado?.subs || {}).some((x) => x?.rol === id)

// Candidatos a prestar silla, EN ORDEN: primero los del squad que están sin
// hacer nada y, si no llegan, miembros inactivos del roster, que entran en
// escena para esto. Sin esa segunda mitad, un squad de una sola persona —el caso
// normal— deja a todos los subagentes sin personaje y su trabajo acaba
// atribuido al principal, que es lo que se veía.
export function candidatos(estado, { squad, roster, trabajando, jefe }) {
  const libre = (id) => id !== jefe && !ocupado(estado, trabajando, id)
  const enSquad = (squad || []).filter(libre)
  const suplentes = (roster || []).filter((r) => r && !r.enabled && libre(r.id)).map((r) => r.id)
  return { enSquad, suplentes, todos: [...enSquad, ...suplentes] }
}

// Abrir el sitio de un subagente. Idempotente: si ya existe se devuelve tal cual,
// porque esto se llama tanto al verlo arrancar como al recibir trabajo suyo del
// que no había constancia.
export function abrir(estado, { subId, desc, jefe, squad, roster, trabajando }) {
  if (!subId) return { estado, nuevo: false }
  if (estado.subs[subId]) return { estado, nuevo: false, sub: estado.subs[subId] }

  const { enSquad, suplentes, todos } = candidatos(estado, { squad, roster, trabajando, jefe })
  const rol = asignaSilla(estado.subs, subId, todos)
  const sub = { rol, tabId: `sub-${subId}`, desc: desc || '', jefe }

  return {
    estado: {
      subs: { ...estado.subs, [subId]: sub },
      // sin silla no se pierde: espera a que alguna se libere
      cola: rol ? estado.cola : [...estado.cola, subId],
      invitados: rol && suplentes.includes(rol) ? [...estado.invitados, rol] : estado.invitados,
    },
    nuevo: true,
    sub,
    // el componente necesita saber si hay que meter a alguien en escena
    entraEnEscena: rol && suplentes.includes(rol) ? rol : null,
    // y esto queda en Diagnóstico: sin ello, «no aparecieron los personajes» no
    // se puede diagnosticar sin reproducirlo a ciegas
    porQue: `${String(subId).slice(-6)} → ${rol || 'SIN PUESTO'} · squad libres: [${enSquad.join(',') || '—'}] · suplentes: [${suplentes.join(',') || '—'}]`,
  }
}

// Cerrar un subagente y repartir su silla. Devuelve a quién hay que levantar, a
// quién sentar en su lugar y quién se va de la oficina.
export function cerrar(estado, subId) {
  const fin = estado.subs[subId]
  if (!fin) return { estado, cerrado: null }

  const subs = { ...estado.subs }
  delete subs[subId]
  let cola = estado.cola.filter((x) => x !== subId)
  let hereda = null

  // la silla pasa al primero que la esperaba, si lo hay
  if (fin.rol && cola.length) {
    const siguiente = cola[0]
    if (subs[siguiente]) {
      cola = cola.slice(1)
      subs[siguiente] = { ...subs[siguiente], rol: fin.rol }
      hereda = { subId: siguiente, rol: fin.rol }
    }
  }

  // un invitado solo se va si nadie hereda su silla: si la hereda otro, se queda
  const seVa = fin.rol && !hereda && estado.invitados.includes(fin.rol) ? fin.rol : null

  return {
    estado: { subs, cola, invitados: seVa ? estado.invitados.filter((x) => x !== seVa) : estado.invitados },
    cerrado: fin,
    hereda,
    // null si nadie deja la silla, o si la silla la hereda otro subagente
    libera: fin.rol && !hereda ? fin.rol : null,
    seVa,
  }
}

// Los que cuelgan de un jefe. Un subagente no sobrevive al turno de quien lo
// lanzó: cuando ese turno termina, se cierra lo que quede suyo aunque su aviso
// de cierre nunca haya llegado.
export const subsDe = (estado, jefe) => Object.keys(estado.subs).filter((id) => estado.subs[id]?.jefe === jefe)
