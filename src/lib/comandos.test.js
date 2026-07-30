import { describe, expect, it } from 'vitest'
import { esComandoDeShell, limpiaComando } from './helpers.js'

// Decidir si un bloque de código merece el botón «correr en la terminal». El
// coste de equivocarse no es simétrico: no ofrecerlo es una molestia, ofrecerlo
// sobre algo que no es un comando invita a ejecutar cualquier cosa.
describe('esComandoDeShell', () => {
  it('un fence de bash es comando', () => {
    expect(esComandoDeShell('firebase login:add', 'bash')).toBe(true)
    expect(esComandoDeShell('flutter build web', 'sh')).toBe(true)
    expect(esComandoDeShell('make generate', 'zsh')).toBe(true)
  })

  it('sin lenguaje declarado, solo si arranca por un comando conocido y es una línea', () => {
    expect(esComandoDeShell('make generate', '')).toBe(true)
    expect(esComandoDeShell('npm run dev', undefined)).toBe(true)
    expect(esComandoDeShell('esto es una frase cualquiera', '')).toBe(false)
  })

  it('no lo ofrece sobre código que no es shell', () => {
    expect(esComandoDeShell('final x = Provider((ref) => 1);', '')).toBe(false)
    expect(esComandoDeShell('{ "name": "x" }', 'json')).toBe(false)
    expect(esComandoDeShell('class Casa extends Widget {', 'dart')).toBe(false)
  })

  it('un script de varias líneas no es «un comando»', () => {
    expect(esComandoDeShell('cd a\nnpm i\nnpm run build\nnpm test', 'bash')).toBe(false)
  })

  it('tolera vacío', () => {
    expect(esComandoDeShell('', 'bash')).toBe(false)
    expect(esComandoDeShell(null, null)).toBe(false)
  })
})

describe('limpiaComando', () => {
  it('quita el prompt de los ejemplos', () => {
    expect(limpiaComando('$ npm run dev')).toBe('npm run dev')
    expect(limpiaComando('  $  make doctor  ')).toBe('make doctor')
  })

  it('deja intacto lo que no lo lleva', () => {
    expect(limpiaComando('firebase login:add')).toBe('firebase login:add')
  })
})
