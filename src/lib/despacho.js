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

