import { afterEach, describe, expect, it } from 'vitest'
import { t, tl, plural, locale, getLang, setLang, langName, missingKeys, LANGS } from './i18n.js'

afterEach(() => setLang('es')) // el idioma vive en el módulo: dejarlo limpio

describe('diccionario', () => {
  it('el inglés cubre todas las claves del español', () => {
    // si esto falla, alguna etiqueta saldría en español con la UI en inglés
    expect(missingKeys('en')).toEqual([])
  })

  it('ofrece exactamente los idiomas soportados', () => {
    expect(LANGS.map(([id]) => id)).toEqual(['es', 'en'])
  })
})

describe('t', () => {
  it('arranca en español y traduce al cambiar de idioma', () => {
    expect(getLang()).toBe('es')
    expect(t('menu.agents')).toBe('Agentes')
    setLang('en')
    expect(t('menu.agents')).toBe('Agents')
  })

  it('sustituye variables entre llaves', () => {
    setLang('en')
    expect(t('composer.placeholder', { name: 'Nami', n: 4 })).toBe('Message the squad… (e.g. "Nami, help me with…" · ⌘1-4)')
  })

  it('deja la llave intacta si falta la variable', () => {
    expect(t('chat.stop', {})).toBe('Detener a {name}')
  })

  it('una clave desconocida se devuelve tal cual, nunca undefined', () => {
    expect(t('no.existe')).toBe('no.existe')
  })

  it('un idioma inválido cae a español', () => {
    setLang('klingon')
    expect(getLang()).toBe('es')
    expect(t('menu.agents')).toBe('Agentes')
  })
})

describe('plural', () => {
  it('solo el singular va sin s', () => {
    expect(plural(1)).toBe('')
    expect(plural(0)).toBe('s')
    expect(plural(2)).toBe('s')
  })
})

describe('idioma derivado', () => {
  it('langName es lo que se le pide al agente en su prompt', () => {
    expect(langName()).toBe('Spanish')
    setLang('en')
    expect(langName()).toBe('English')
  })

  it('locale sigue al idioma para fechas y horas', () => {
    expect(locale()).toBe('es')
    setLang('en')
    expect(locale()).toBe('en')
  })
})

describe('tl (frases ambientales)', () => {
  it('devuelve la lista del idioma activo', () => {
    const es = tl('phrases')
    setLang('en')
    const en = tl('phrases')
    expect(es.length).toBe(en.length)
    expect(es[0]).not.toBe(en[0])
  })

  it('una lista inexistente es un array vacío, no undefined', () => {
    expect(tl('no.existe')).toEqual([])
  })
})
