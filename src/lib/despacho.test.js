import { describe, expect, it } from 'vitest'
import { decideDespacho, quienColisiona } from './despacho.js'

describe('decideDespacho', () => {
  const base = { target: 'dev', tabDeRol: {}, activa: 'tab-1', ocupado: false, enCola: false }

  it('libre y en tu pestaña: se manda', () => {
    expect(decideDespacho(base).accion).toBe('despachar')
  })

  it('trabajando: se encola detrás de lo suyo', () => {
    expect(decideDespacho({ ...base, ocupado: true }).accion).toBe('encolar')
  })

  it('con algo ya esperando también se encola, para no adelantarse', () => {
    // si lo nuevo se despachara, llegaría antes que lo que pediste primero
    expect(decideDespacho({ ...base, enCola: true }).accion).toBe('encolar')
  })

  it('si está trabajando para OTRA pestaña no se encola: se dice', () => {
    // encolarlo lo dejaría esperando donde no estás mirando, y su respuesta
    // aparecería más tarde en un sitio que no estás viendo
    const r = decideDespacho({ ...base, tabDeRol: { dev: 'tab-9' } })
    expect(r.accion).toBe('otra-pestana')
    expect(r.rol).toBe('dev')
  })

  it('trabajando para TU pestaña sí se encola', () => {
    expect(decideDespacho({ ...base, tabDeRol: { dev: 'tab-1' }, ocupado: true }).accion).toBe('encolar')
  })
})


describe('quienColisiona', () => {
  const trabajando = { dev: 'thinking', qa: 'thinking', pr: 'delivering' }

  it('NO avisa por quien trabaja en otro proyecto', () => {
    // El fallo real: pedí trabajo a Luffy en workspace, me pasé a release y al
    // pedirle a Nami saltó «Luffy está trabajando en release». Ni colisionaban
    // —clones distintos— ni Luffy estaba ahí.
    const otros = quienColisiona({
      target: 'research',
      running: ['dev'],
      roleStates: trabajando,
      proyecto: '/w/release',
      proyectoDe: () => '/w/workspace',
    })
    expect(otros).toEqual([])
  })

  it('avisa por quien trabaja en el MISMO proyecto', () => {
    const otros = quienColisiona({
      target: 'research',
      running: ['dev', 'qa'],
      roleStates: trabajando,
      proyecto: '/w/uno',
      proyectoDe: () => '/w/uno',
    })
    expect(otros).toEqual(['dev', 'qa'])
  })

  it('quien ya está entregando no colisiona: ya no escribe', () => {
    const otros = quienColisiona({
      target: 'dev',
      running: ['pr'],
      roleStates: trabajando,
      proyecto: '/w/uno',
      proyectoDe: () => '/w/uno',
    })
    expect(otros).toEqual([])
  })

  it('si no se sabe dónde trabaja, se cuenta: un aviso de más molesta menos que uno de menos', () => {
    const otros = quienColisiona({
      target: 'research',
      running: ['dev'],
      roleStates: trabajando,
      proyecto: '/w/uno',
      proyectoDe: () => '',
    })
    expect(otros).toEqual(['dev'])
  })

  it('sin proyecto no hay colisión posible', () => {
    expect(quienColisiona({ target: 'dev', running: ['qa'], roleStates: trabajando, proyecto: '' })).toEqual([])
  })

  it('uno no colisiona consigo mismo', () => {
    const otros = quienColisiona({
      target: 'dev',
      running: ['dev'],
      roleStates: trabajando,
      proyecto: '/w/uno',
      proyectoDe: () => '/w/uno',
    })
    expect(otros).toEqual([])
  })
})
