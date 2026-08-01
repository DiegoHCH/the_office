import { describe, expect, it } from 'vitest'
import { filtra, anida, paraElPanel } from './historial.js'

const c = (id, extra = {}) => ({ id, title: id, project: 'Workspace', ...extra })

describe('filtra', () => {
  const lista = [c('uno', { title: 'Arreglar el login' }), c('dos', { title: 'Migrar a Riverpod' }), c('tres', { title: 'Notas' })]

  it('sin búsqueda devuelve todo', () => {
    expect(filtra(lista, '').map((h) => h.id)).toEqual(['uno', 'dos', 'tres'])
  })

  it('busca en título y proyecto, sin importar tildes ni mayúsculas', () => {
    expect(filtra(lista, 'LOGIN').map((h) => h.id)).toEqual(['uno'])
    expect(filtra(lista, 'workspace')).toHaveLength(3)
  })

  it('una conversación que coincide por DENTRO se queda aunque su título no diga nada', () => {
    // es lo que hace útil la búsqueda: el título rara vez tiene lo que buscas
    expect(filtra(lista, 'riverpod', { tres: true }).map((h) => h.id)).toEqual(['dos', 'tres'])
  })

  it('las fijadas suben, aunque sean más viejas', () => {
    const conPin = [c('a'), c('b', { pinned: true }), c('c')]
    expect(filtra(conPin, '')[0].id).toBe('b')
  })

  it('no muta la lista que recibe', () => {
    const orig = [c('a'), c('b', { pinned: true })]
    filtra(orig, '')
    expect(orig.map((h) => h.id)).toEqual(['a', 'b'])
  })
})

describe('anida', () => {
  it('cada hija va justo debajo de su madre', () => {
    const l = [c('madre'), c('otra'), c('h1', { parentId: 'madre' }), c('h2', { parentId: 'madre' })]
    expect(anida(l).map((h) => h.id)).toEqual(['madre', 'h1', 'h2', 'otra'])
  })

  it('una huérfana no desaparece: se queda al primer nivel', () => {
    // madre borrada, o filtrada por la búsqueda. Ocultarla sería perder trabajo
    // real por no encontrar a su madre
    const l = [c('otra'), c('huerfana', { parentId: 'ya-no-esta' })]
    expect(anida(l).map((h) => h.id)).toEqual(['otra', 'huerfana'])
  })

  it('sin hijas, la lista queda como estaba', () => {
    const l = [c('a'), c('b')]
    expect(anida(l).map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('tolera vacío', () => {
    expect(anida([])).toEqual([])
    expect(anida(undefined)).toEqual([])
  })
})

describe('paraElPanel', () => {
  it('filtra y DESPUÉS anida: si la búsqueda se lleva a la madre, la hija sale suelta', () => {
    const l = [c('madre', { title: 'Revisión de skills' }), c('hija', { parentId: 'madre', title: 'Comparar A vs B' })]
    // «comparar» no está en el título de la madre, así que se cae
    expect(paraElPanel(l, 'comparar', {}).map((h) => h.id)).toEqual(['hija'])
  })

  it('con la madre dentro del filtro, la hija vuelve a su sitio', () => {
    const l = [c('madre', { title: 'Comparar skills' }), c('hija', { parentId: 'madre', title: 'Comparar A vs B' })]
    expect(paraElPanel(l, 'comparar', {}).map((h) => h.id)).toEqual(['madre', 'hija'])
  })
})
