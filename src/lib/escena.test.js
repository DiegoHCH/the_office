import { describe, expect, it } from 'vitest'
import { fpsEscena, tickerActivo } from './helpers.js'

// El ritmo de la escena en reposo. Antes se pintaba al ritmo de la pantalla
// pasara algo o no, y eso costaba dos tercios de un núcleo con la app quieta.
describe('fpsEscena', () => {
  it('trabajando y a la vista: ritmo de pantalla (sin ticker)', () => {
    expect(fpsEscena({ visible: true, trabajando: true })).toBe(0)
  })

  it('a la vista pero en reposo: ritmo bajo, no congelado', () => {
    // 0 congelaría el clip Idle y las partículas; el ahorro no puede costar eso
    expect(fpsEscena({ visible: true, trabajando: false })).toBe(20)
  })

  it('sin foco: lo mínimo para cerrar lo que quedó a medias', () => {
    expect(fpsEscena({ visible: false, trabajando: false })).toBe(4)
  })

  it('sin foco gana sobre el trabajo en curso: nadie está mirando', () => {
    expect(fpsEscena({ visible: false, trabajando: true })).toBe(4)
  })
})

describe('tickerActivo', () => {
  it('a la vista siempre hay ritmo que marcar, aunque nada se mueva', () => {
    expect(tickerActivo({ visible: true, trabajando: false, hayMovimiento: false })).toBe(true)
  })

  it('trabajando no monta ticker: lo marca la pantalla', () => {
    expect(tickerActivo({ visible: true, trabajando: true, hayMovimiento: true })).toBe(false)
  })

  it('sin foco y con un paseo a medias: sigue hasta terminarlo', () => {
    expect(tickerActivo({ visible: false, trabajando: false, hayMovimiento: true })).toBe(true)
  })

  it('sin foco y sin movimiento: se apaga del todo', () => {
    // el caso que costaba 27% de un núcleo por una ventana que nadie mira
    expect(tickerActivo({ visible: false, trabajando: false, hayMovimiento: false })).toBe(false)
  })
})
