import { describe, expect, it } from 'vitest'
import { decideDespacho } from './despacho.js'

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

