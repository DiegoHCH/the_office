import { describe, expect, it } from 'vitest'
import { routeMessage, detectHandoff } from './routing.js'
import { safeRegex } from '../data/roles.js'

// Squad de prueba con nombres que ejercitan tildes, mayúsculas y keywords.
const SQUAD = [
  { id: 'dev', name: 'Luffy', kw: safeRegex('codigo, bug, fix') },
  { id: 'research', name: 'Nami', kw: safeRegex('investiga, busca') },
  { id: 'design', name: 'Sanji', kw: safeRegex('diseño, ui, ux') },
  { id: 'qa', name: 'Zoro', kw: safeRegex('test, prueba') },
  { id: 'docs', name: 'Andrés', kw: safeRegex('documenta, readme') },
]
const P = 'dev' // principal

describe('routeMessage', () => {
  it('sin pistas va al principal', () => {
    expect(routeMessage('hola, ¿cómo vas?', SQUAD, P)).toBe('dev')
  })

  it('nombre al inicio manda sobre todo', () => {
    expect(routeMessage('Zoro, corre los tests', SQUAD, P)).toBe('qa')
    expect(routeMessage('Sanji revisa esta pantalla', SQUAD, P)).toBe('design')
  })

  it('el nombre al inicio gana aunque haya keywords de otro rol', () => {
    // "test" es keyword de QA, pero el mensaje empieza llamando a Sanji
    expect(routeMessage('Sanji, mira el test de la pantalla', SQUAD, P)).toBe('design')
  })

  it('@nombre en cualquier parte del texto', () => {
    expect(routeMessage('oye @Nami investiga esto porfa', SQUAD, P)).toBe('research')
    expect(routeMessage('esto es para @Zoro', SQUAD, P)).toBe('qa')
  })

  it('es insensible a mayúsculas y tildes', () => {
    expect(routeMessage('ANDRÉS, documenta el módulo', SQUAD, P)).toBe('docs')
    expect(routeMessage('andres, documenta el módulo', SQUAD, P)).toBe('docs')
    expect(routeMessage('@ANDRES revisa', SQUAD, P)).toBe('docs')
  })

  it('keywords rutean cuando no hay nombre', () => {
    expect(routeMessage('hay un bug en el login', SQUAD, P)).toBe('dev')
    expect(routeMessage('investiga las alternativas', SQUAD, P)).toBe('research')
    expect(routeMessage('corre los test del carrito', SQUAD, P)).toBe('qa')
  })

  it('las keywords del principal no le roban el turno a otros', () => {
    // 'codigo' es del principal: igual llega a él, sin ambigüedad
    expect(routeMessage('revisa el codigo', SQUAD, P)).toBe('dev')
  })

  it('saluda y luego nombra: es interpelación directa', () => {
    // el caso que fallaba: iba al principal en vez de a Nami
    expect(routeMessage('Hola Nami, cuál es tu cargo en la oficina?', SQUAD, P)).toBe('research')
    expect(routeMessage('oye Zoro, corre los tests', SQUAD, P)).toBe('qa')
    expect(routeMessage('buenas tardes Sanji: mira esto', SQUAD, P)).toBe('design')
  })

  it('el nombre al final tras coma también interpela', () => {
    expect(routeMessage('revisa el login, Zoro', SQUAD, P)).toBe('qa')
    expect(routeMessage('¿puedes con esto, Nami?', SQUAD, P)).toBe('research')
  })

  it('un nombre mencionado de pasada NO rutea', () => {
    expect(routeMessage('esto lo vio Zoro ayer', SQUAD, P)).toBe('dev')
    expect(routeMessage('el bug que reportó Nami sigue vivo', SQUAD, P)).toBe('dev')
  })

  it('nombres que son prefijo de una palabra no matchean', () => {
    // "Namibia" no debe rutear a Nami
    expect(routeMessage('Namibia queda en África', SQUAD, P)).toBe('dev')
  })

  it('tolera texto vacío', () => {
    expect(routeMessage('', SQUAD, P)).toBe('dev')
  })
})

describe('detectHandoff', () => {
  it('detecta la flecha explícita', () => {
    expect(detectHandoff('Nami -> Luffy: pásale el análisis', SQUAD, 'research')).toBe('dev')
    expect(detectHandoff('investiga y → Zoro', SQUAD, 'research')).toBe('qa')
  })

  it('detecta el verbo de entrega con destinatario', () => {
    expect(detectHandoff('investiga esto y pásaselo a Zoro', SQUAD, 'research')).toBe('qa')
    expect(detectHandoff('arregla el bug para que Zoro lo pruebe', SQUAD, 'dev')).toBe('qa')
  })

  it('no hay handoff sin verbo de entrega', () => {
    expect(detectHandoff('Zoro ya lo revisó ayer', SQUAD, 'dev')).toBe(null)
    expect(detectHandoff('arregla el login', SQUAD, 'dev')).toBe(null)
  })

  it('nunca se entrega a sí mismo', () => {
    expect(detectHandoff('arréglalo y pásaselo a Luffy', SQUAD, 'dev')).toBe(null)
  })

  it('funciona con tildes en el destinatario', () => {
    expect(detectHandoff('termina y pásaselo a Andrés', SQUAD, 'dev')).toBe('docs')
  })
})
