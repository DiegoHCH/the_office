// Agregación de las estadísticas de uso (#📈).
//
// Vive aparte de StatsPanel.jsx porque son cuentas con bordes que se rompen sin
// hacer ruido —una racha que se corta un día y sigue contando, un porcentaje que
// no suma 100, un rango que incluye hoy o no— y todas se prueban aquí sin montar
// un panel.
//
// LO QUE HAY EN DISCO. `oficina-stats` en localStorage, un día por clave
// (`2026-08-06`), y los días viejos NO tienen las claves nuevas: hasta la v1.20
// solo se guardaba { tasks, tokens, ms, agents }. Todo lo que se añadió después
// —modelo, hora, entrada/salida y conversaciones— empieza a llenarse desde
// entonces, así que aquí se trata siempre como opcional. Rellenarlo hacia atrás
// no era posible: el historial guarda UNA fecha por conversación, y repartir sus
// tokens por días con eso habría sido inventar el gráfico.

/// Los rangos del selector, y cuántos días cubre cada uno (null = todo).
export const RANGOS = { '7d': 7, '30d': 30, all: null }

/// La clave de un día, en la zona horaria de quien mira (no UTC: si no, a partir
/// de las 19:00 en Bogotá el trabajo se apuntaba al día siguiente).
export function claveDia(fecha) {
  const d = new Date(fecha)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/// Los días del rango, en orden y con su clave dentro. Ojo: solo los que
/// existen; los días sin actividad no están en disco y no se inventan aquí (el
/// heatmap sí necesita los huecos, y los pide aparte con `rejilla`).
export function diasDelRango(all, rango = 'all', hoy = new Date()) {
  const dias = Object.entries(all || {})
    .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .map(([key, d]) => ({ key, ...d }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
  const n = RANGOS[rango]
  if (!n) return dias
  // El rango incluye HOY, así que 7d son hoy y los seis anteriores. Con 7 días
  // hacia atrás desde hoy salían ocho columnas y el título mentía.
  const desde = new Date(hoy)
  desde.setDate(desde.getDate() - (n - 1))
  const limite = claveDia(desde)
  return dias.filter((d) => d.key >= limite)
}

/// Cabecera: los números grandes del rango.
export function resumen(dias) {
  const acc = { turnos: 0, tokens: 0, entrada: 0, salida: 0, ms: 0, sesiones: 0, diasActivos: 0 }
  const horas = {}
  const modelos = {}
  for (const d of dias) {
    const turnos = Number(d.tasks) || 0
    acc.turnos += turnos
    acc.tokens += Number(d.tokens) || 0
    acc.entrada += Number(d.in) || 0
    acc.salida += Number(d.out) || 0
    acc.ms += Number(d.ms) || 0
    acc.sesiones += Object.keys(d.convs || {}).length
    // Un día cuenta como activo si hubo trabajo, no por existir la clave: un día
    // con cero turnos rompería la racha aunque figure en disco.
    if (turnos > 0) acc.diasActivos += 1
    for (const [h, n] of Object.entries(d.horas || {})) horas[h] = (horas[h] || 0) + (Number(n) || 0)
    for (const [m, v] of Object.entries(d.modelos || {})) modelos[m] = (modelos[m] || 0) + (Number(v?.in) || 0) + (Number(v?.out) || 0)
  }
  // La hora punta empata a menudo al principio (un turno en cada hora): gana la
  // más temprana, que es estable entre refrescos.
  let horaPunta = null
  for (const h of Object.keys(horas).sort((a, b) => Number(a) - Number(b))) {
    if (horaPunta === null || horas[h] > horas[horaPunta]) horaPunta = h
  }
  let modeloTop = null
  for (const [m, v] of Object.entries(modelos)) {
    if (!modeloTop || v > modelos[modeloTop]) modeloTop = m
  }
  return {
    ...acc,
    horaPunta: horaPunta === null ? null : Number(horaPunta),
    modeloTop,
    // ¿Hay algún dato de los que se empezaron a guardar en la v1.20? Sin esto,
    // un rango viejo pinta un panel vacío que se lee como «no has trabajado».
    conDatosNuevos: Object.keys(modelos).length > 0 || Object.keys(horas).length > 0,
  }
}

/// Rachas de días con trabajo. `actual` cuenta hacia atrás desde HOY: si hoy no
/// has trabajado es 0, aunque ayer cerraras diez días seguidos — una racha que
/// sigue contando con el día en blanco no es una racha.
export function rachas(claves, hoy = new Date()) {
  const activos = new Set(claves || [])
  let actual = 0
  const cursor = new Date(hoy)
  while (activos.has(claveDia(cursor))) {
    actual += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  let max = 0
  let corrida = 0
  let anterior = null
  for (const k of [...activos].sort()) {
    if (anterior) {
      const siguiente = new Date(`${anterior}T12:00:00`)
      siguiente.setDate(siguiente.getDate() + 1)
      corrida = claveDia(siguiente) === k ? corrida + 1 : 1
    } else {
      corrida = 1
    }
    if (corrida > max) max = corrida
    anterior = k
  }
  return { actual, max }
}

/// Reparto por modelo, de mayor a menor.
///
/// Más de `tope` series en un gráfico no se distinguen —los colores dejan de
/// tener separación suficiente—, así que la cola se junta en «otros» en vez de
/// pintar un color nuevo por modelo. El porcentaje se calcula sobre el total
/// REAL, incluida esa cola: si no, los porcentajes no suman 100.
export function porModelo(dias, tope = 4) {
  const acc = {}
  for (const d of dias) {
    for (const [m, v] of Object.entries(d.modelos || {})) {
      const a = (acc[m] ||= { id: m, entrada: 0, salida: 0, turnos: 0 })
      a.entrada += Number(v?.in) || 0
      a.salida += Number(v?.out) || 0
      a.turnos += Number(v?.tasks) || 0
    }
  }
  const lista = Object.values(acc)
    .map((a) => ({ ...a, total: a.entrada + a.salida }))
    .sort((a, b) => b.total - a.total)
  const total = lista.reduce((s, a) => s + a.total, 0)
  const cabeza = lista.slice(0, tope)
  const cola = lista.slice(tope)
  if (cola.length) {
    cabeza.push({
      id: '__otros__',
      otros: cola.length,
      entrada: cola.reduce((s, a) => s + a.entrada, 0),
      salida: cola.reduce((s, a) => s + a.salida, 0),
      turnos: cola.reduce((s, a) => s + a.turnos, 0),
      total: cola.reduce((s, a) => s + a.total, 0),
    })
  }
  return cabeza.map((a) => ({ ...a, pct: total ? (a.total / total) * 100 : 0 }))
}

/// Serie apilada: un día por columna, y dentro los tokens de cada modelo en el
/// MISMO orden que la leyenda. El orden importa: el color va con el modelo, no
/// con su puesto en el día, o al cambiar de rango los colores se reasignarían.
export function apiladas(dias, ids) {
  return dias.map((d) => {
    const partes = ids.map((id) => {
      if (id === '__otros__') {
        const conocidos = new Set(ids)
        return Object.entries(d.modelos || {})
          .filter(([m]) => !conocidos.has(m))
          .reduce((s, [, v]) => s + (Number(v?.in) || 0) + (Number(v?.out) || 0), 0)
      }
      const v = d.modelos?.[id]
      return (Number(v?.in) || 0) + (Number(v?.out) || 0)
    })
    return { key: d.key, partes, total: partes.reduce((a, b) => a + b, 0) }
  })
}

/// Rejilla del mapa de actividad: semanas en columnas y días de la semana en
/// filas, terminando HOY. Los días sin datos van con 0 —el hueco ES el dato— y
/// se rellenan aquí porque en disco no existen.
export function rejilla(all, semanas = 18, hoy = new Date()) {
  const fin = new Date(hoy)
  // La última columna se completa hasta el sábado para que las filas cuadren
  // (semana de domingo a sábado, como el calendario del sistema).
  fin.setDate(fin.getDate() + (6 - fin.getDay()))
  const celdas = []
  for (let i = semanas * 7 - 1; i >= 0; i--) {
    const f = new Date(fin)
    f.setDate(f.getDate() - i)
    const key = claveDia(f)
    const d = (all || {})[key]
    celdas.push({
      key,
      tokens: Number(d?.tokens) || 0,
      turnos: Number(d?.tasks) || 0,
      // Un día que aún no ha llegado no es un día vacío: se pinta como hueco.
      futuro: key > claveDia(hoy),
    })
  }
  return celdas
}

/// A qué paso de la rampa corresponde un valor (0 = sin actividad).
///
/// Por tramos sobre el máximo y no lineal: un día de 2M de tokens junto a varios
/// de 50k dejaba todo el resto en el primer paso, indistinguible de un día
/// vacío. Lo que se quiere ver es «hubo poco/algo/bastante/mucho».
export function nivel(valor, max) {
  const v = Number(valor) || 0
  if (v <= 0) return 0
  if (!max || max <= 0) return 1
  const r = v / max
  if (r <= 0.1) return 1
  if (r <= 0.35) return 2
  if (r <= 0.7) return 3
  return 4
}
