import { describe, expect, it } from 'vitest'
import { prefKey, leerPref } from './prefs.js'

// localStorage de mentira: solo necesita getItem
const store = (datos) => ({ getItem: (k) => (k in datos ? datos[k] : null) })

describe('prefKey', () => {
  it('con proyecto lo incluye; sin él es la clave del perfil', () => {
    expect(prefKey('oficina-model', 'work', '/repos/a')).toBe('oficina-model-work::/repos/a')
    expect(prefKey('oficina-model', 'work')).toBe('oficina-model-work')
    expect(prefKey('oficina-model', 'work', '')).toBe('oficina-model-work')
  })
})

describe('leerPref', () => {
  it('el valor del proyecto gana sobre el del perfil', () => {
    const s = store({ 'm-work': 'opus', 'm-work::/repos/a': 'haiku' })
    expect(leerPref('m', 'work', '/repos/a', s)).toBe('haiku')
  })

  it('un proyecto sin valor propio hereda el del perfil', () => {
    const s = store({ 'm-work': 'opus' })
    expect(leerPref('m', 'work', '/repos/sin-tocar', s)).toBe('opus')
  })

  it('sin proyecto abierto también hereda del perfil', () => {
    // el borde que motivó el módulo: («'' ?? x») devuelve '' y no heredaba
    const s = store({ 'm-work': 'opus' })
    expect(leerPref('m', 'work', '', s)).toBe('opus')
    expect(leerPref('m', 'work', undefined, s)).toBe('opus')
  })

  it('sin valor en ningún ámbito devuelve null, no undefined ni cadena vacía', () => {
    expect(leerPref('m', 'work', '/repos/a', store({}))).toBeNull()
  })

  it('cada proyecto conserva el suyo', () => {
    const s = store({ 'w-work': '1', 'w-work::/cliente': '0' })
    expect(leerPref('w', 'work', '/cliente', s)).toBe('0') // solo lectura
    expect(leerPref('w', 'work', '/propio', s)).toBe('1') // hereda edición
  })

  it('los perfiles no se pisan entre sí', () => {
    const s = store({ 'm-work': 'opus', 'm-private': 'haiku' })
    expect(leerPref('m', 'work', '', s)).toBe('opus')
    expect(leerPref('m', 'private', '', s)).toBe('haiku')
  })
})
