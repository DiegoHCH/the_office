import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generar, trocear, ORIGEN, DESTINO, MAPA } from './guia.mjs'

const es = readFileSync(ORIGEN, 'utf8')
const enComprometida = readFileSync(DESTINO, 'utf8')
const mapa = JSON.parse(readFileSync(MAPA, 'utf8'))

describe('guía en inglés', () => {
  it('no le falta ninguna cadena por traducir', () => {
    // si esto falla, alguien tocó el español sin pasar por docs/guia.en.json
    expect(generar(es, mapa).faltantes).toEqual([])
  })

  it('el archivo comprometido es exactamente el que se genera', () => {
    // evita editar ayuda.en.html a mano y que se separe del original
    expect(generar(es, mapa).html).toBe(enComprometida)
  })

  it('conserva la estructura del original, solo cambia el texto', () => {
    const etiquetas = (html) => trocear(html).filter((p) => p.texto.startsWith('<')).map((p) => p.texto)
    // el idioma del documento es la única etiqueta que cambia
    expect(etiquetas(enComprometida)).toEqual(etiquetas(es).map((t) => t.replace('<html lang="es">', '<html lang="en">')))
  })

  it('no deja rastros de español en el resultado', () => {
    const soloIngles = trocear(enComprometida)
      .filter((p) => p.traducible)
      .map((p) => p.texto)
      .join(' ')
    for (const palabra of [' el ', ' los ', ' para ', ' desde ', ' con tu ']) {
      expect(soloIngles.toLowerCase()).not.toContain(palabra)
    }
  })
})

describe('trocear', () => {
  it('no toma el CSS de <style> por texto traducible', () => {
    const piezas = trocear('<style>.a { color: red; }</style><p>hola</p>')
    expect(piezas.filter((p) => p.traducible).map((p) => p.texto)).toEqual(['hola'])
  })

  it('los separadores sin letras no se traducen', () => {
    expect(trocear('<b>a</b> · <b>b</b>').filter((p) => p.traducible).map((p) => p.texto)).toEqual(['a', 'b'])
  })
})
