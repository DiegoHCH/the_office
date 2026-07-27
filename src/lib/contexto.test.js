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
