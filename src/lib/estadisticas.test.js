import { describe, expect, it } from 'vitest'
import { apiladas, claveDia, diasDelRango, nivel, porModelo, rachas, rejilla, resumen } from './estadisticas.js'

// Un martes, para que los rangos y las semanas se puedan comprobar a mano.
const HOY = new Date('2026-08-06T15:00:00')

const dia = (extra = {}) => ({ tasks: 1, tokens: 100, ms: 1000, ...extra })

describe('claveDia', () => {
  it('usa la fecha local, no UTC', () => {
    // el bug que evita: a las 20:00 en Bogotá (UTC-5) ya es el día siguiente en
    // UTC, y el trabajo de hoy se apuntaba a mañana
    expect(claveDia(new Date('2026-08-06T20:30:00'))).toBe('2026-08-06')
  })

  it('rellena mes y día a dos cifras', () => {
    expect(claveDia(new Date('2026-01-02T10:00:00'))).toBe('2026-01-02')
  })
})

describe('diasDelRango', () => {
  const all = {
    '2026-07-01': dia(),
    '2026-07-31': dia(),
    '2026-08-05': dia(),
    '2026-08-06': dia(),
    basura: dia(), // una clave que no es fecha no debe colarse
  }

  it('7d incluye hoy y los seis anteriores', () => {
    const claves = diasDelRango(all, '7d', HOY).map((d) => d.key)
    expect(claves).toEqual(['2026-07-31', '2026-08-05', '2026-08-06'])
  })

  it('30d alcanza julio pero no el 1', () => {
    expect(diasDelRango(all, '30d', HOY).map((d) => d.key)).toEqual(['2026-07-31', '2026-08-05', '2026-08-06'])
  })

  it('all lo trae todo, ordenado y sin claves que no sean fechas', () => {
    expect(diasDelRango(all, 'all', HOY).map((d) => d.key)).toEqual(['2026-07-01', '2026-07-31', '2026-08-05', '2026-08-06'])
  })

  it('sin datos no revienta', () => {
    expect(diasDelRango(null, '7d', HOY)).toEqual([])
  })
})

describe('resumen', () => {
  it('suma turnos, tokens, tiempo y sesiones del rango', () => {
    const r = resumen([
      dia({ tasks: 2, tokens: 300, ms: 5000, in: 200, out: 100, convs: { a: 1, b: 1 } }),
      dia({ tasks: 3, tokens: 700, ms: 1000, in: 500, out: 200, convs: { c: 1 } }),
    ])
    expect(r.turnos).toBe(5)
    expect(r.tokens).toBe(1000)
    expect(r.entrada).toBe(700)
    expect(r.salida).toBe(300)
    expect(r.ms).toBe(6000)
    expect(r.sesiones).toBe(3)
    expect(r.diasActivos).toBe(2)
  })

  it('un día con cero turnos no cuenta como activo', () => {
    // en disco puede quedar la clave de un día sin trabajo; si contara, rompería
    // la racha sin motivo
    expect(resumen([dia({ tasks: 0 })]).diasActivos).toBe(0)
  })

  it('los días viejos sin las claves nuevas no rompen nada', () => {
    const r = resumen([{ tasks: 1, tokens: 10, ms: 5 }])
    expect(r.horaPunta).toBe(null)
    expect(r.modeloTop).toBe(null)
    expect(r.entrada).toBe(0)
    expect(r.conDatosNuevos).toBe(false)
  })

  it('la hora punta es la de más turnos', () => {
    const r = resumen([dia({ horas: { 9: 2, 10: 5 } }), dia({ horas: { 10: 1, 22: 3 } })])
    expect(r.horaPunta).toBe(10)
  })

  it('en empate gana la hora más temprana, para que no baile entre refrescos', () => {
    expect(resumen([dia({ horas: { 22: 3, 9: 3 } })]).horaPunta).toBe(9)
  })

  it('el modelo favorito es el de más tokens, no el de más turnos', () => {
    const r = resumen([
      dia({ modelos: { 'claude-opus-5': { in: 10, out: 5, tasks: 9 }, 'claude-fable-5': { in: 900, out: 100, tasks: 1 } } }),
    ])
    expect(r.modeloTop).toBe('claude-fable-5')
  })
})

describe('rachas', () => {
  it('cuenta hacia atrás desde hoy', () => {
    expect(rachas(['2026-08-04', '2026-08-05', '2026-08-06'], HOY).actual).toBe(3)
  })

  it('si hoy no has trabajado, la racha actual es 0', () => {
    // aunque ayer cerraras una racha larga: una racha con el día en blanco no es
    // una racha (es lo que muestra «0d» en la tarjeta)
    const r = rachas(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'], HOY)
    expect(r.actual).toBe(0)
    expect(r.max).toBe(5)
  })

  it('la máxima es la corrida más larga, aunque sea vieja', () => {
    const r = rachas(['2026-06-01', '2026-06-02', '2026-06-03', '2026-08-06'], HOY)
    expect(r.max).toBe(3)
    expect(r.actual).toBe(1)
  })

  it('un hueco corta la corrida', () => {
    expect(rachas(['2026-08-01', '2026-08-03', '2026-08-04'], HOY).max).toBe(2)
  })

  it('cruza el cambio de mes', () => {
    expect(rachas(['2026-07-30', '2026-07-31', '2026-08-01'], HOY).max).toBe(3)
  })

  it('sin días no hay rachas', () => {
    expect(rachas([], HOY)).toEqual({ actual: 0, max: 0 })
  })
})

describe('porModelo', () => {
  const cinco = [
    dia({
      modelos: {
        a: { in: 500, out: 500, tasks: 5 },
        b: { in: 300, out: 100, tasks: 3 },
        c: { in: 100, out: 100, tasks: 2 },
        d: { in: 50, out: 50, tasks: 1 },
        e: { in: 20, out: 20, tasks: 1 },
        f: { in: 10, out: 10, tasks: 1 },
      },
    }),
  ]

  it('ordena de mayor a menor por tokens totales', () => {
    expect(porModelo(cinco).map((m) => m.id)).toEqual(['a', 'b', 'c', 'd', '__otros__'])
  })

  it('junta la cola en «otros» en vez de inventar colores', () => {
    const otros = porModelo(cinco).find((m) => m.id === '__otros__')
    expect(otros.otros).toBe(2) // e y f
    expect(otros.total).toBe(60)
  })

  it('los porcentajes suman 100 contando la cola', () => {
    const suma = porModelo(cinco).reduce((s, m) => s + m.pct, 0)
    expect(Math.round(suma)).toBe(100)
  })

  it('suma el mismo modelo a lo largo de varios días', () => {
    const r = porModelo([dia({ modelos: { a: { in: 1, out: 1 } } }), dia({ modelos: { a: { in: 2, out: 2 } } })])
    expect(r[0].total).toBe(6)
    expect(r[0].pct).toBe(100)
  })

  it('sin datos de modelo devuelve lista vacía y no divide por cero', () => {
    expect(porModelo([dia()])).toEqual([])
  })
})

describe('apiladas', () => {
  it('respeta el orden de la leyenda para que el color siga al modelo', () => {
    const dias = [dia({ key: 'd1', modelos: { a: { in: 1, out: 1 }, b: { in: 5, out: 5 } } })]
    const s = apiladas(dias, ['b', 'a'])
    expect(s[0].partes).toEqual([10, 2])
    expect(s[0].total).toBe(12)
  })

  it('un día sin ese modelo aporta 0, no un hueco', () => {
    const s = apiladas([dia({ modelos: {} })], ['a'])
    expect(s[0].partes).toEqual([0])
  })

  it('«otros» recoge lo que no está en la leyenda', () => {
    const dias = [dia({ modelos: { a: { in: 1, out: 1 }, z: { in: 3, out: 3 }, y: { in: 2, out: 2 } } })]
    const s = apiladas(dias, ['a', '__otros__'])
    expect(s[0].partes).toEqual([2, 10])
  })
})

describe('rejilla', () => {
  it('devuelve semanas completas de 7 días', () => {
    expect(rejilla({}, 4, HOY)).toHaveLength(28)
  })

  it('termina en la semana de hoy y marca los días que aún no han llegado', () => {
    const c = rejilla({}, 2, HOY)
    expect(c[c.length - 1].key).toBe('2026-08-08') // sábado de esta semana
    expect(c[c.length - 1].futuro).toBe(true)
    expect(c.find((x) => x.key === '2026-08-06').futuro).toBe(false)
  })

  it('rellena con ceros los días que no están en disco', () => {
    const c = rejilla({ '2026-08-06': dia({ tokens: 999, tasks: 4 }) }, 2, HOY)
    const hoy = c.find((x) => x.key === '2026-08-06')
    const otro = c.find((x) => x.key === '2026-08-03')
    expect(hoy.tokens).toBe(999)
    expect(hoy.turnos).toBe(4)
    expect(otro.tokens).toBe(0)
  })
})

describe('nivel', () => {
  it('sin actividad es 0, y con actividad nunca es 0', () => {
    expect(nivel(0, 100)).toBe(0)
    expect(nivel(1, 1_000_000)).toBe(1)
  })

  it('por tramos sobre el máximo, no lineal', () => {
    // el caso real: un día de 2M junto a varios de 50k dejaba todo lo demás
    // indistinguible de un día vacío
    expect(nivel(50_000, 2_000_000)).toBe(1)
    expect(nivel(600_000, 2_000_000)).toBe(2)
    expect(nivel(1_200_000, 2_000_000)).toBe(3)
    expect(nivel(2_000_000, 2_000_000)).toBe(4)
  })

  it('sin máximo válido, cualquier valor es el primer paso', () => {
    expect(nivel(5, 0)).toBe(1)
  })
})
