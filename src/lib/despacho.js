// Qué hacer con un encargo: mandarlo, ponerlo en cola, o no aceptarlo.
//
// Sale de App.jsx porque son tres reglas que se decidieron por separado y que
// juntas deciden si tu mensaje llega o no. Equivocarse aquí no da un error: da
// un mensaje que desaparece, o que aparece donde no lo estás mirando.

// Un agente hace un trabajo a la vez. Si el que le toca ya está trabajando para
// OTRA pestaña, el encargo no se encola: encolarlo lo dejaría esperando en un
// sitio que no estás viendo, y el trabajo aparecería más tarde donde no lo
// buscas. Mejor decirlo en el momento, con su nombre.
//
// `tabDeRol` es de quién es cada agente ahora mismo; `activa`, la pestaña que
// estás mirando.
export function decideDespacho({ target, tabDeRol, activa, ocupado, enCola }) {
  const suya = tabDeRol?.[target]
  if (suya && suya !== activa) return { accion: 'otra-pestana', rol: target }
  // en cola también cuenta: si ya tiene algo esperando, lo nuevo va detrás y no
  // se adelanta, o se perdería el orden en el que lo pediste
  if (ocupado || enCola) return { accion: 'encolar', rol: target }
  return { accion: 'despachar', rol: target }
}


// Quién puede pisarse con quién (#99).
//
// El aviso de colisión existe por una razón concreta: dos agentes editando el
// MISMO directorio se estorban —`git add -A` cruzados, el mismo archivo a la
// vez—. Con un proyecto por pestaña eso deja de ser cualquier pareja de agentes
// ocupados: dos que trabajan en clones distintos no pueden pisarse, y avisar
// ahí es ruido. Peor: el aviso nombraba el proyecto que tú estabas mirando, así
// que decía «Luffy está trabajando en release» cuando Luffy estaba en workspace.
//
// `proyectoDe(rol)` devuelve dónde trabaja cada uno. Si de alguno no se sabe, se
// cuenta como colisión: un aviso de más molesta, uno de menos deja que se pisen.
export function quienColisiona({ target, running = [], roleStates = {}, proyectoDe = () => '', proyecto = '' }) {
  if (!proyecto) return []
  return running.filter((r) => {
    if (r === target) return false
    const estado = roleStates[r]
    if (!estado || estado === 'delivering') return false
    const suyo = proyectoDe(r)
    return !suyo || suyo === proyecto
  })
}

// ¿El usuario está pidiendo que se reparta el trabajo?
//
// Importa porque el reparto NO es gratis: abre una pestaña por parte y parte el
// encargo en trozos independientes. Para un documento único —un refinamiento
// técnico, un análisis— eso es peor que hacerlo de un tirón: salen cinco piezas
// que hay que recoser.
//
// Antes la app autorizaba a repartir en CADA mensaje, así que un encargo con una
// lista de tareas dentro se repartía solo. El usuario pedía un documento y
// recibía cinco pestañas. Ahora hay que pedirlo, con `/repartir` o diciéndolo.
//
// La lista es corta a propósito: un falso positivo devuelve el comportamiento
// que queríamos quitar. `divide` no está —«divide el total entre doce» no es
// una petición de reparto— y `asigna` tampoco, que aparece en cualquier
// especificación.
// Ojo con las tildes: en imperativo con pronombre se acentúan —«repártelo»,
// «delégalo»— y sin contemplarlo el patrón fallaba justo en la forma más
// natural de pedirlo.
const PIDE_REPARTO = [
  /\brep[aá]rt(e|elo|ela|irlo|irla|ir)\b/i,
  /\bdel[eé]g(a|alo|ala|arlo|arla|ar)\b/i,
  /\ben paralelo\b/i,
  /\bentre (varios|el equipo|compañeros|companeros)\b/i,
  /\bsplit (this|it|the work)\b/i,
  /\bdelegate\b/i,
  /\bin parallel\b/i,
]

export function pideReparto(texto = '') {
  if (/^\/repartir\b/i.test(texto.trim())) return true
  return PIDE_REPARTO.some((r) => r.test(texto))
}
