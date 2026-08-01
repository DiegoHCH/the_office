// Cómo se ordena y se filtra la lista del historial.
//
// Sale de App.jsx porque son reglas con criterio propio —qué sube arriba, qué
// cuelga de qué, qué pasa con una hija cuya madre no está— y ahí dentro no se
// podían probar. El resto del panel (abrir, renombrar, borrar) sigue en el
// componente: eso son efectos, no decisiones.

import { norm } from './helpers.js'

// Filtra por título/proyecto o por contenido ya buscado, y sube las fijadas.
// `contenido` es el resultado de la búsqueda en el texto de las conversaciones:
// una que coincida por dentro se queda aunque su título no diga nada.
export function filtra(lista, query, contenido = {}) {
  const q = String(query || '').trim()
  const base = q
    ? (lista || []).filter((h) => norm(`${h.title || ''} ${h.project || ''}`).includes(norm(q)) || contenido[h.id])
    : lista || []
  return base.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
}

// Cuelga cada conversación de subagente bajo la que la repartió.
//
// Sueltas por fecha no se entienden: «comparar X vs Y» sin saber de qué encargo
// salió no le dice nada a nadie dentro de un mes. Y una huérfana —madre borrada,
// o filtrada por la búsqueda— se queda al primer nivel en vez de desaparecer:
// ocultar algo porque no encuentro a su madre es peor que enseñarlo sin sangría.
export function anida(lista) {
  const hijas = new Map()
  for (const h of lista || []) if (h.parentId) hijas.set(h.parentId, [...(hijas.get(h.parentId) || []), h])
  const ids = new Set((lista || []).map((h) => h.id))
  const out = []
  for (const h of lista || []) {
    if (h.parentId && ids.has(h.parentId)) continue // se pinta bajo su madre
    out.push(h)
    for (const c of hijas.get(h.id) || []) out.push(c)
  }
  return out
}

// Lo que ve el panel: filtrado y anidado, en ese orden. Al revés no vale — al
// filtrar se pueden caer madres, y el anidado tiene que decidir con la lista que
// de verdad se va a pintar.
export const paraElPanel = (lista, query, contenido) => anida(filtra(lista, query, contenido))
