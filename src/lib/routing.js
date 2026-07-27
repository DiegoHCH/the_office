// Ruteo de mensajes: a qué agente va cada uno y si hay handoff.
// Extraído de App.jsx (#109) para poder testearlo — es lógica delicada:
// una regresión aquí manda mensajes al agente equivocado en silencio.
import { norm, escRe } from './helpers.js'

// A qué miembro va el mensaje: nombre al inicio / @nombre / keywords / principal.
export function routeMessage(text, squad, principal) {
  const t = norm(text)
  for (const m of squad) {
    const n = escRe(norm(m.name))
    if (new RegExp(`^${n}\\b`).test(t) || t.includes(`@${norm(m.name)}`)) return m.id
  }
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

