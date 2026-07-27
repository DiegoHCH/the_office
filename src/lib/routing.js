// Ruteo de mensajes: a qué agente va cada uno y si hay handoff.
// Extraído de App.jsx (#109) para poder testearlo — es lógica delicada:
// una regresión aquí manda mensajes al agente equivocado en silencio.
import { norm, escRe } from './helpers.js'

// Fórmulas con las que se abre un mensaje antes de nombrar a alguien. Son una
// lista cerrada a propósito: «hola nami» interpela, pero «el bug que reportó
// nami» no, y sin esta lista cualquier palabra suelta antes del nombre valdría.
const SALUDOS = [
  'hola',
  'holi',
  'holis',
  'buenas',
  'buenos dias',
  'buenas tardes',
  'buenas noches',
  'saludos',
  'que tal',
  'que mas',
  'hey',
  'ey',
  'eh',
  'oye',
  'oiga',
  'oigan',
  'disculpa',
  'disculpe',
  'perdona',
  'perdon',
  'porfa',
  'por favor',
  'a ver',
  'mira',
  'oe',
  'hi',
  'hello',
]
const APERTURA = `(?:${SALUDOS.join('|')})`

// A qué miembro va el mensaje: vocativo / @nombre / keywords / principal.
//
// Se considera que hablas DIRECTAMENTE a alguien cuando su nombre:
//   · abre el mensaje                → «Nami, investiga esto»
//   · lleva @                        → «oye @Nami mira»
//   · va tras un saludo, con coma o sin ella → «Hola Nami ¿cuál es tu cargo?»
//   · va tras cualquier prefijo y coma → «buenas tardes Sanji: mira esto»
//   · cierra el mensaje tras coma    → «revisa esto, Nami»
// Mencionarlo de pasada NO rutea («esto lo vio Zoro ayer» va al principal).
export function routeMessage(text, squad, principal) {
  const t = norm(text)
  for (const m of squad) {
    const n = escRe(norm(m.name))
    // saludo + nombre: la coma es opcional porque casi nadie la escribe
    const trasSaludo = new RegExp(`^(?:${APERTURA}[\\s,]+){1,3}${n}\\b`)
    // cualquier otro prefijo corto exige coma o dos puntos para desambiguar
    const vocativoInicial = new RegExp(`^(?:[a-z]+\\s+){0,3}${n}\\s*[,:]`)
    const vocativoFinal = new RegExp(`,\\s*${n}\\s*[?!.…]*$`) // «…, nami?»
    if (
      new RegExp(`^${n}\\b`).test(t) ||
      t.includes(`@${norm(m.name)}`) ||
      trasSaludo.test(t) ||
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

