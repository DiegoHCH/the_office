// Preferencias con dos ámbitos (#124): lo específico del proyecto gana, y lo
// que no tenga valor propio hereda el del perfil.
//
// Vive aparte de App.jsx porque la herencia tiene un borde fácil de romper:
// con proyecto vacío, `('' ?? x)` devuelve '' y NO hereda — hay que preguntar
// por el proyecto de forma explícita.

export const prefKey = (base, perfil, proyecto) => (proyecto ? `${base}-${perfil}::${proyecto}` : `${base}-${perfil}`)

// null si no hay valor en ninguno de los dos ámbitos (para poder distinguirlo
// de un valor vacío guardado a propósito).
export function leerPref(base, perfil, proyecto, store = globalThis.localStorage) {
  const propio = proyecto ? store?.getItem(prefKey(base, perfil, proyecto)) : null
  return propio ?? store?.getItem(prefKey(base, perfil)) ?? null
}
