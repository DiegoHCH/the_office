import { describe, expect, it } from 'vitest'

import { anotaSalida, carpetaDe, familiaDe, PASOS_CON_DETALLE, registra, resumen, rutaCorta, TOPE_PASOS } from './actividad.js'

describe('familiaDe', () => {
  it('separa leer, escribir y ejecutar', () => {
    expect(familiaDe('Read')).toBe('lee')
    expect(familiaDe('Edit')).toBe('escribe')
    expect(familiaDe('Bash')).toBe('corre')
    expect(familiaDe('TodoWrite')).toBe('piensa')
  })

  it('una herramienta de MCP cuenta como consulta', () => {
    expect(familiaDe('mcp__claude_ai_Slack__slack_read_channel')).toBe('lee')
  })

  it('una herramienta desconocida NO desaparece', () => {
    // Los nombres los pone Claude Code y cambian entre versiones. Si lo que no
    // reconocemos se cayera del panel, el rastro mentiría por omisión — y eso es
    // peor que mostrarlo sin adornos.
    expect(familiaDe('HerramientaQueNoExisteAun')).toBe('otro')
  })
})

describe('rutaCorta', () => {
  it('quita la raíz del proyecto', () => {
    expect(rutaCorta('/Users/yo/proyecto/src/App.jsx', '/Users/yo/proyecto')).toBe('src/App.jsx')
  })

  it('recorta por segmentos, nunca a mitad de un nombre', () => {
    // Cortar por caracteres produce rutas que parecen otras carpetas.
    const r = rutaCorta('/a/b/c/d/e/f/archivo.dart', '')
    expect(r).toBe('a/…/e/f/archivo.dart')
    expect(r).not.toContain('archi…')
  })

  it('la raíz del proyecto en sí se ve como «.», no vacía', () => {
    expect(rutaCorta('/Users/yo/proyecto', '/Users/yo/proyecto')).toBe('.')
  })

  it('una ruta de fuera del proyecto conserva la barra inicial', () => {
    // Es la señal de que está FUERA. Quitarla la haría parecer del proyecto, y
    // que un agente toque algo de fuera es justo lo que quieres ver.
    expect(rutaCorta('/etc/hosts', '/Users/yo/proyecto')).toBe('/etc/hosts')
  })
})

describe('carpetaDe', () => {
  it('devuelve la carpeta del archivo', () => {
    expect(carpetaDe('/a/b/c.txt')).toBe('/a/b')
  })

  it('un nombre suelto no tiene carpeta', () => {
    expect(carpetaDe('archivo.txt')).toBe('')
  })
})

describe('registra', () => {
  it('agrupa la repetición inmediata en vez de duplicar la línea', () => {
    // Leer, editar y volver a leer el mismo archivo es normal. Sin agrupar, el
    // panel se llena de líneas idénticas y esconde lo demás.
    let l = []
    l = registra(l, { role: 'dev', name: 'Read', detail: 'a.js', t: 1 })
    l = registra(l, { role: 'dev', name: 'Read', detail: 'a.js', t: 2 })
    l = registra(l, { role: 'dev', name: 'Read', detail: 'a.js', t: 3 })
    expect(l).toHaveLength(1)
    expect(l[0].veces).toBe(3)
    expect(l[0].t).toBe(3) // la hora es la de la última vez
  })

  it('volver a un archivo DESPUÉS de otro sí merece su línea', () => {
    // Eso no es repetición: es que volvió, y saberlo es el objetivo del panel.
    let l = []
    l = registra(l, { role: 'dev', name: 'Read', detail: 'a.js' })
    l = registra(l, { role: 'dev', name: 'Read', detail: 'b.js' })
    l = registra(l, { role: 'dev', name: 'Read', detail: 'a.js' })
    expect(l).toHaveLength(3)
  })

  it('dos agentes con la misma herramienta no se agrupan entre ellos', () => {
    let l = []
    l = registra(l, { role: 'dev', name: 'Bash', detail: 'npm test' })
    l = registra(l, { role: 'qa', name: 'Bash', detail: 'npm test' })
    expect(l).toHaveLength(2)
  })

  it('un evento sin nombre de herramienta no entra', () => {
    expect(registra([], { detail: 'algo' })).toEqual([])
  })

  it('al pasar el tope se van los más viejos, no los nuevos', () => {
    let l = []
    for (let i = 0; i < TOPE_PASOS + 20; i++) l = registra(l, { name: 'Read', detail: `f${i}.js` })
    expect(l).toHaveLength(TOPE_PASOS)
    expect(l[l.length - 1].detail).toBe(`f${TOPE_PASOS + 19}.js`)
  })

  it('no muta la lista que recibe', () => {
    const l = [{ name: 'Read', detail: 'a', role: 'dev', familia: 'lee', veces: 1, t: 0, path: '' }]
    const r = registra(l, { name: 'Write', detail: 'b', role: 'dev' })
    expect(l).toHaveLength(1)
    expect(r).toHaveLength(2)
  })
})

describe('resumen', () => {
  it('cuenta por familia y junta carpetas y archivos sin repetir', () => {
    let l = []
    l = registra(l, { role: 'dev', name: 'Read', detail: 'a', path: '/p/src/a.js' })
    l = registra(l, { role: 'dev', name: 'Edit', detail: 'b', path: '/p/src/b.js' })
    l = registra(l, { role: 'dev', name: 'Bash', detail: 'npm test' })
    l = registra(l, { role: 'dev', name: 'Bash', detail: 'npm test' })
    const r = resumen(l)
    expect(r.cuenta.lee).toBe(1)
    expect(r.cuenta.escribe).toBe(1)
    expect(r.cuenta.corre).toBe(2) // las dos veces del comando repetido
    expect(r.pasos).toBe(4)
    expect(r.carpetas).toEqual(['/p/src'])
    expect(r.archivos).toEqual(['/p/src/a.js', '/p/src/b.js'])
  })

  it('un rastro vacío no rompe', () => {
    expect(resumen([]).pasos).toBe(0)
  })
})

// Detalle por paso: qué se le pidió a la herramienta y qué contestó. Antes el
// stream traía las dos cosas y se aprovechaba media — del tool_use solo una línea
// de resumen, y el contenido del tool_result se tiraba.
describe('detalle de cada paso', () => {
  const paso = (extra = {}) => ({ name: 'Bash', role: 'dev', t: 1, detail: 'make generate', ...extra })

  it('guarda el id y la entrada del paso', () => {
    const l = registra([], paso({ id: 'tu_1', entrada: 'make generate' }))
    expect(l[0].id).toBe('tu_1')
    expect(l[0].entrada).toBe('make generate')
    expect(l[0].salida).toBe('')
  })

  it('cuelga la salida del paso que la pidió', () => {
    let l = registra([], paso({ id: 'tu_1' }))
    l = registra(l, paso({ name: 'Read', detail: 'a.dart', id: 'tu_2' }))
    l = anotaSalida(l, 'tu_1', 'Generated 12 outputs')
    expect(l[0].salida).toBe('Generated 12 outputs')
    expect(l[1].salida).toBe('') // la del otro paso no se toca
  })

  it('marca la salida que vino con error', () => {
    let l = registra([], paso({ id: 'tu_1' }))
    l = anotaSalida(l, 'tu_1', 'command not found', true)
    expect(l[0].salidaError).toBe(true)
  })

  it('un id que no existe no revienta ni cambia la lista', () => {
    // pasa de verdad: el paso pudo salir del tope, o era una delegación que no se
    // registra como herramienta
    const l = registra([], paso({ id: 'tu_1' }))
    expect(anotaSalida(l, 'no-existe', 'algo')).toBe(l)
    expect(anotaSalida(l, '', 'algo')).toBe(l)
    expect(anotaSalida(l, 'tu_1', '')).toBe(l)
  })

  it('al agrupar repeticiones se queda con el id y la entrada de la ÚLTIMA', () => {
    // si conservara el primero, la salida que llegue después se colgaría de una
    // llamada que ya no es la que estás mirando
    let l = registra([], paso({ id: 'tu_1', entrada: 'make generate' }))
    l = registra(l, paso({ id: 'tu_2', entrada: 'make generate' }))
    expect(l).toHaveLength(1)
    expect(l[0].veces).toBe(2)
    expect(l[0].id).toBe('tu_2')
    l = anotaSalida(l, 'tu_2', 'ok')
    expect(l[0].salida).toBe('ok')
  })

  it('los pasos viejos suel tan su contenido pero conservan su línea', () => {
    let l = []
    for (let i = 0; i < PASOS_CON_DETALLE + 5; i++) {
      l = registra(l, paso({ id: `tu_${i}`, detail: `cmd ${i}`, entrada: `comando numero ${i}` }))
    }
    expect(l).toHaveLength(PASOS_CON_DETALLE + 5)
    expect(l[0].entrada).toBe('') // el más viejo, purgado
    expect(l[0].purgado).toBe(true)
    expect(l[0].detail).toBe('cmd 0') // pero su línea sigue ahí
    expect(l[l.length - 1].entrada).toBe(`comando numero ${PASOS_CON_DETALLE + 4}`)
  })
})
