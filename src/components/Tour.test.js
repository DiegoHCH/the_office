import { describe, expect, it } from 'vitest'
import { colocar } from './Tour.jsx'

const VW = 1280
const VH = 768
const ALTO = 185 // alto típico de la tarjeta
const caja = (top, height, left = 0, width = VW) => ({ top, left, width, height, bottom: top + height, right: left + width })

// invariante de todos los casos: la tarjeta nunca sale de la ventana
const dentro = (pos, alto = ALTO) =>
  pos.top >= 0 && pos.top + alto <= VH && pos.left >= 0 && pos.left + 320 <= VW

describe('colocar la tarjeta del tour', () => {
  it('debajo del elemento cuando hay sitio', () => {
    const pos = colocar(caja(20, 40, 100, 200), ALTO, VW, VH)
    expect(pos.top).toBe(74) // 20 + 40 + 14
    expect(dentro(pos)).toBe(true)
  })

  it('encima cuando abajo no cabe', () => {
    // elemento pegado al fondo: debajo no hay hueco
    const pos = colocar(caja(VH - 60, 50, 30, 200), ALTO, VW, VH)
    expect(pos.top).toBe(VH - 60 - 14 - ALTO)
    expect(dentro(pos)).toBe(true)
  })

  it('dentro del elemento cuando ocupa casi toda la pantalla', () => {
    // el caso que fallaba: el canvas de la oficina va de 60 a 700 y la tarjeta
    // se colocaba encima, quedando en top negativo (-137 medido en la app)
    const pos = colocar(caja(60, 640), ALTO, VW, VH)
    expect(pos.top).toBeGreaterThanOrEqual(0)
    expect(dentro(pos)).toBe(true)
  })

  it('nunca se sale por arriba ni por abajo, mida lo que mida el paso', () => {
    // los textos del tour cambian de largo según el idioma
    for (const alto of [120, 185, 240, 400]) {
      for (const top of [0, 60, 300, VH - 100, VH - 10]) {
        for (const h of [30, 200, 640, VH]) {
          const pos = colocar(caja(top, h), alto, VW, VH)
          expect(pos.top).toBeGreaterThanOrEqual(0)
          expect(pos.top + alto).toBeLessThanOrEqual(VH)
        }
      }
    }
  })

  it('no se sale por los lados con un elemento pegado a la derecha', () => {
    const pos = colocar(caja(20, 40, VW - 60, 60), ALTO, VW, VH)
    expect(pos.left + 320).toBeLessThanOrEqual(VW)
  })

  it('en una ventana más estrecha que la tarjeta no da un left negativo', () => {
    const pos = colocar(caja(20, 40, 0, 280), ALTO, 280, VH)
    expect(pos.left).toBeGreaterThanOrEqual(0)
  })

  it('sin elemento que señalar, se centra', () => {
    expect(colocar(null, ALTO, VW, VH)).toMatchObject({ left: '50%', top: '40%' })
  })
})
