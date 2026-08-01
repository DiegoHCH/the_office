import { describe, expect, it } from 'vitest'
import { estadoInicial, abrir, cerrar, candidatos, subsDe, MAX_SUBAGENTES } from './subagentes.js'

// Cada caso de aquí es un bug que ya ocurrió. Estaban todos dentro del manejador
// de eventos de App.jsx, donde no se podían probar, y cada uno costó varias
// rondas de reproducir a ciegas con capturas.
const squad = ['dev', 'research', 'design']
const roster = [
  { id: 'dev', enabled: true },
  { id: 'research', enabled: true },
  { id: 'design', enabled: true },
  { id: 'qa', enabled: false },
  { id: 'docs', enabled: false },
  { id: 'pr', enabled: false },
  { id: 'publish', enabled: false },
]
const ctx = { squad, roster, trabajando: ['dev'], jefe: 'dev' }

describe('a quién se le presta la silla', () => {
  it('primero quien está libre en el squad', () => {
    const r = abrir(estadoInicial(), { subId: 'a', desc: 'x', ...ctx })
    expect(r.sub.rol).toBe('research')
    expect(r.entraEnEscena).toBe(null) // ya estaba en escena
  })

  it('nunca el que reparte, aunque esté en el squad', () => {
    const { todos } = candidatos(estadoInicial(), ctx)
    expect(todos).not.toContain('dev')
  })

  it('con el squad agotado entran inactivos, y eso hay que reflejarlo en escena', () => {
    let e = estadoInicial()
    e = abrir(e, { subId: 'a', ...ctx }).estado
    e = abrir(e, { subId: 'b', ...ctx }).estado
    const r = abrir(e, { subId: 'c', ...ctx }) // ya no quedan activos libres
    expect(r.sub.rol).toBe('qa')
    expect(r.entraEnEscena).toBe('qa')
  })

  it('un squad de una sola persona no deja a todos sin personaje', () => {
    // el caso normal, y el que hacía que su trabajo saliera encima del principal
    const solo = { squad: ['dev'], roster, trabajando: ['dev'], jefe: 'dev' }
    const r = abrir(estadoInicial(), { subId: 'a', ...solo })
    expect(r.sub.rol).toBe('qa')
    expect(r.entraEnEscena).toBe('qa')
  })

  it('nadie roba la silla de otro subagente', () => {
    let e = estadoInicial()
    e = abrir(e, { subId: 'a', ...ctx }).estado
    const r = abrir(e, { subId: 'b', ...ctx })
    expect(r.sub.rol).not.toBe(e.subs.a.rol)
  })
})

describe('el tope de cinco', () => {
  const muchos = { squad: ['dev'], roster: roster.map((r) => ({ ...r, enabled: r.id === 'dev' })), trabajando: ['dev'], jefe: 'dev' }

  it('son cinco: la oficina tiene seis sillas y el que reparte ocupa una', () => {
    expect(MAX_SUBAGENTES).toBe(5)
  })

  it('el sexto trabaja igual, pero sin silla y en cola', () => {
    let e = estadoInicial()
    for (const id of ['a', 'b', 'c', 'd', 'e']) e = abrir(e, { subId: id, ...muchos }).estado
    const r = abrir(e, { subId: 'f', ...muchos })
    expect(r.sub.rol).toBe(null)
    expect(r.estado.cola).toEqual(['f'])
    expect(r.sub.tabId).toBe('sub-f') // su pestaña existe igual: no hay tope de pestañas
  })
})

describe('abrir es idempotente', () => {
  it('el que ya existe se devuelve tal cual, sin cambiarle la silla', () => {
    const e = abrir(estadoInicial(), { subId: 'a', ...ctx }).estado
    const r = abrir(e, { subId: 'a', ...ctx })
    expect(r.nuevo).toBe(false)
    expect(r.sub.rol).toBe(e.subs.a.rol)
  })
})

describe('cerrar y repartir la silla', () => {
  it('libera al personaje cuando nadie espera', () => {
    const e = abrir(estadoInicial(), { subId: 'a', ...ctx }).estado
    const r = cerrar(e, 'a')
    expect(r.libera).toBe('research')
    expect(r.hereda).toBe(null)
    expect(r.estado.subs.a).toBeUndefined()
  })

  it('la silla pasa al que la esperaba, y ese no se levanta', () => {
    const solo = { squad: ['dev'], roster: roster.map((r) => ({ ...r, enabled: r.id === 'dev' })), trabajando: ['dev'], jefe: 'dev' }
    let e = estadoInicial()
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) e = abrir(e, { subId: id, ...solo }).estado
    expect(e.cola).toEqual(['f'])
    const r = cerrar(e, 'a')
    expect(r.hereda).toEqual({ subId: 'f', rol: e.subs.a.rol })
    expect(r.libera).toBe(null) // no se levanta: se sienta otro
    expect(r.estado.cola).toEqual([])
  })

  it('un invitado se va al terminar', () => {
    const solo = { squad: ['dev'], roster, trabajando: ['dev'], jefe: 'dev' }
    const e = abrir(estadoInicial(), { subId: 'a', ...solo }).estado
    expect(e.invitados).toEqual(['qa'])
    expect(cerrar(e, 'a').seVa).toBe('qa')
  })

  it('…salvo que su silla la herede otro: ahí se queda', () => {
    const solo = { squad: ['dev'], roster: [{ id: 'dev', enabled: true }, { id: 'qa', enabled: false }], trabajando: ['dev'], jefe: 'dev' }
    let e = estadoInicial()
    e = abrir(e, { subId: 'a', ...solo }).estado
    e = abrir(e, { subId: 'b', ...solo }).estado // sin silla, a la cola
    const r = cerrar(e, 'a')
    expect(r.hereda?.subId).toBe('b')
    expect(r.seVa).toBe(null)
    expect(r.estado.invitados).toEqual(['qa'])
  })

  it('cerrar dos veces no rompe ni resucita a nadie', () => {
    const e = abrir(estadoInicial(), { subId: 'a', ...ctx }).estado
    const uno = cerrar(e, 'a')
    const dos = cerrar(uno.estado, 'a')
    expect(dos.cerrado).toBe(null)
    expect(dos.estado.subs).toEqual({})
  })
})

describe('no sobreviven a su jefe', () => {
  it('se sabe cuáles cerrar cuando termina el turno del que los lanzó', () => {
    let e = estadoInicial()
    e = abrir(e, { subId: 'a', ...ctx }).estado
    e = abrir(e, { subId: 'b', ...ctx, jefe: 'research' }).estado
    expect(subsDe(e, 'dev')).toEqual(['a'])
    expect(subsDe(e, 'research')).toEqual(['b'])
  })
})
