import { describe, expect, it } from 'vitest'
import { ventanaDe, contextoUsado } from './helpers.js'

describe('ventanaDe', () => {
  it('Haiku tiene 200k y el resto 1M', () => {
    expect(ventanaDe('claude-haiku-4-5')).toBe(200_000)
    expect(ventanaDe('claude-haiku-4-5-20251001')).toBe(200_000)
    expect(ventanaDe('claude-opus-5[1m]')).toBe(1_000_000)
    expect(ventanaDe('claude-sonnet-5')).toBe(1_000_000)
  })

  it('un modelo desconocido con «haiku» en el id también son 200k', () => {
    expect(ventanaDe('claude-haiku-9-futuro')).toBe(200_000)
  })

  it('sin modelo no revienta', () => {
    expect(ventanaDe(undefined)).toBe(1_000_000)
  })
})

describe('contextoUsado', () => {
  it('suma entrada y caché, que es lo que ocupa la ventana', () => {
    // la salida NO cuenta: no se reenvía como contexto del turno actual
    expect(contextoUsado({ input_tokens: 100, output_tokens: 9999, cache_read_input_tokens: 50, cache_creation_input_tokens: 25 })).toBe(175)
  })

  it('tolera un usage incompleto o ausente', () => {
    expect(contextoUsado({ input_tokens: 10 })).toBe(10)
    expect(contextoUsado(null)).toBe(0)
  })
})

// Regresión del 100% en el primer mensaje. La ocupación es la de UNA llamada,
// no la del turno: el usage del `result` suma todas las llamadas del bucle
// agéntico y cada una vuelve a leer el contexto cacheado, así que crece con el
// número de herramientas y no con lo que de verdad ocupa la conversación.
describe('el acumulado del turno no es la ocupación del contexto', () => {
  // datos reales de un turno de 4 llamadas (Glob + Bash) medidos del stream
  const llamadas = [23_007, 25_906, 30_913, 31_241]
  const acumuladoDelResult = 111_067 // el usage del result, verificado

  it('el result es la suma de las llamadas, no la última', () => {
    expect(llamadas.reduce((a, b) => a + b, 0)).toBe(acumuladoDelResult)
  })

  it('la ocupación real es la de la última llamada', () => {
    expect(contextoUsado({ input_tokens: 2, cache_read_input_tokens: 31_239 })).toBe(31_241)
  })

  it('usar el acumulado infla la ocupación con cada herramienta', () => {
    // 3,5× en un turno de cuatro llamadas; con decenas de lecturas, pasa del 100%
    expect(acumuladoDelResult / llamadas.at(-1)).toBeGreaterThan(3)
    expect(acumuladoDelResult / ventanaDe('opus-1m')).toBeGreaterThan(0) // no revienta con alias raros
  })
})
