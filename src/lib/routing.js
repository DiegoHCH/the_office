// Ruteo de mensajes: a qué agente va cada uno y si hay handoff.
// Extraído de App.jsx (#109) para poder testearlo — es lógica delicada:
// una regresión aquí manda mensajes al agente equivocado en silencio.
import { norm, escRe } from './helpers.js'

// A qué miembro va el mensaje: vocativo / @nombre / keywords / principal.
//
// Se considera que hablas DIRECTAMENTE a alguien cuando su nombre:
//   · abre el mensaje              → «Nami, investiga esto»
//   · lleva @                       → «oye @Nami mira»
//   · va tras un saludo y con coma  → «Hola Nami, ¿cuál es tu cargo?»
//   · cierra el mensaje tras coma   → «revisa esto, Nami»
// Mencionarlo de pasada NO rutea («esto lo vio Zoro ayer» va al principal).
export function routeMessage(text, squad, principal) {
  const t = norm(text)
  for (const m of squad) {
    const n = escRe(norm(m.name))
    const vocativoInicial = new RegExp(`^(?:[a-z]+\\s+){0,3}${n}\\s*[,:]`) // «hola nami,»
    const vocativoFinal = new RegExp(`,\\s*${n}\\s*[?!.…]*$`) // «…, nami?»
    if (
      new RegExp(`^${n}\\b`).test(t) ||
      t.includes(`@${norm(m.name)}`) ||
      vocativoInicial.test(t) ||
      vocativoFinal.test(t)
    )
      return m.id
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

