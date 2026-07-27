// Ruteo de mensajes: a qué agente va cada uno y si hay handoff.
// Extraído de App.jsx (#109) para poder testearlo — es lógica delicada:
// una regresión aquí manda mensajes al agente equivocado en silencio.
import { norm, escRe } from './helpers.js'

// A qué miembro va el mensaje: nombre / keywords / principal.
//
// Nombrar a alguien —en cualquier parte del texto— le dirige el mensaje:
// «Nami, investiga esto», «oye @Nami mira», «revisa esto, Nami» y también
// «el bug que reportó Nami» van todos a Nami. Es una decisión explícita: se
// prefiere que nombrar siempre funcione, aunque a veces rutee una mención
// que era de pasada, antes que tener que recordar dónde colocar el nombre.
//
// Si aparecen varios, gana el que se nombra ANTES en el texto, no el orden
// del squad: «Nami investiga y pásaselo a Luffy» arranca en Nami.
//
// El límite de palabra se mantiene: «Namibia» no es «Nami».
export function routeMessage(text, squad, principal) {
  const t = norm(text)
  let elegido = null
  let posicion = Infinity
  for (const m of squad) {
    const n = escRe(norm(m.name))
    const hit = new RegExp(`\\b${n}\\b`).exec(t)
    if (hit && hit.index < posicion) {
      posicion = hit.index
      elegido = m.id
    }
  }
  if (elegido) return elegido
  for (const m of squad) if (m.id !== principal && m.kw?.test(t)) return m.id
  return principal
}

// ¿El mensaje pide pasarle el resultado a otro miembro? ("...y pásaselo al Dev",
// "Research -> Dev: ...", "para que el QA lo pruebe")
export function detectHandoff(text, squad, fromId) {
  const t = norm(text)
  const verb = /(pasal|pasasel|pasa el resultado|entregal|entregasel|entrega el resultado|dasel|dale el resultado|para que|y que)/.test(t)
  for (const m of squad) {
    if (m.id === fromId) continue
    const n = escRe(norm(m.name))
    if (new RegExp(`(?:->|→)\\s*${n}\\b`).test(t)) return m.id
    if (verb && new RegExp(`\\b(?:a|para(?:\\s+que)?|que)\\s+${n}\\b`).test(t)) return m.id
  }
  return null
}

