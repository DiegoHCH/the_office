import { describe, expect, it } from 'vitest'
import { decideDespacho, pideReparto, quienColisiona } from './despacho.js'

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

describe('pideReparto', () => {
  it('el comando explícito lo pide', () => {
    expect(pideReparto('/repartir revisa estos tres módulos')).toBe(true)
  })

  it('pedirlo con palabras también cuenta', () => {
    expect(pideReparto('reparte esto entre el equipo')).toBe(true)
    expect(pideReparto('delégalo en dos compañeros')).toBe(true)
    expect(pideReparto('repártelo entre varios')).toBe(true) // con tilde, que es como se escribe
    expect(pideReparto('hazlo en paralelo, son partes independientes')).toBe(true)
  })

  it('un encargo con lista de tareas dentro NO es pedir reparto', () => {
    // El caso real: un refinamiento técnico con cinco «Tareas Front» numeradas.
    // El usuario quería UN documento y recibió cinco pestañas, porque la app
    // autorizaba a repartir en cada mensaje y esa lista parecía «partes
    // independientes».
    const hu = `Refinamiento técnico de la HU-P4-01.
      Tareas Front:
      1. Integración de servicios del BE
      2. Creación del widget de salud del crédito
      3. Maquetación de la vista general
      4. Maquetación del listado de activos
      5. Integración del servicio que lista los activos
      cuando finalices pásaselo a nami`
    expect(pideReparto(hu)).toBe(false)
  })

  it('«divide» no cuenta: aparece en cualquier cálculo', () => {
    expect(pideReparto('divide el total entre doce meses')).toBe(false)
  })

  it('«asigna» tampoco: sale en cualquier especificación', () => {
    expect(pideReparto('la vista asigna el color según el estado')).toBe(false)
  })

  it('pasar el trabajo a UNA persona no es repartir', () => {
    // «pásaselo a nami» es un relevo, no una división del encargo.
    expect(pideReparto('cuando termines pásaselo a nami')).toBe(false)
  })
})
