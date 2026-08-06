import { describe, expect, it } from 'vitest'
import obs from './obsidian.js'

const { sanitiza, carpetaDeNota, nombreDeNota, esNotaDe, cuerpoDeConversacion, notaDeConversacion, contenidoAEscribir, SEPARADOR, MARCA } = obs

// join de node:path sin importar node:path (los tests corren en jsdom-less pero
// la función recibe el join para poder probarse con uno de juguete)
const join = (...p) => p.filter(Boolean).join('/')

const convo = (extra = {}) => ({
  id: 'ce156916-6f2c-4bf8-8026-5262a6ad8f1c',
  title: 'Revisar el módulo de stocks',
  profile: 'work',
  project: '/Users/diego/Workspace/front-mobile-b2c',
  model: 'claude-opus-5[1m]',
  updatedAt: 1786000000000,
  messages: [
    { role: 'user', text: 'Nami, revisa stocks' },
    { role: 'assistant', who: 'Nami', text: 'Listo, encontré dos cosas.' },
  ],
  ...extra,
})

describe('sanitiza', () => {
  it('quita lo que rompe rutas', () => {
    expect(sanitiza('feat/AWC-1: usa *esto*?')).toBe('feat AWC-1 usa esto')
  })

  it('quita lo que rompe los enlaces de Obsidian', () => {
    // un # en el nombre convierte [[nota#x]] en referencia a encabezado y el
    // enlace deja de resolver
    expect(sanitiza('nota #1 [borrador] ^ver|otro')).toBe('nota 1 borrador ver otro')
  })

  it('un punto final no se queda: macOS lo pierde y deja «nota .md»', () => {
    expect(sanitiza('pendiente...')).toBe('pendiente')
  })

  it('nunca devuelve vacío', () => {
    expect(sanitiza('///')).toBe('sin-titulo')
    expect(sanitiza('')).toBe('sin-titulo')
    expect(sanitiza(null)).toBe('sin-titulo')
  })

  it('recorta largo pero sin dejar espacios al final', () => {
    expect(sanitiza('a'.repeat(200)).length).toBe(60)
  })
})

describe('carpetaDeNota', () => {
  it('separa por perfil y por proyecto, que es el punto', () => {
    expect(carpetaDeNota({ vault: '/v', perfil: 'work', proyecto: '/Users/d/Workspace/front-mobile-b2c' }, join)).toBe(
      '/v/work/front-mobile-b2c'
    )
  })

  it('del proyecto usa solo la última carpeta, no el árbol entero', () => {
    expect(carpetaDeNota({ vault: '/v', perfil: 'private', proyecto: '/Users/d/personal/la-oficina/' }, join)).toBe(
      '/v/private/la-oficina'
    )
  })

  it('sin proyecto o sin perfil no las deja suel tas en la raíz', () => {
    expect(carpetaDeNota({ vault: '/v', perfil: '', proyecto: '' }, join)).toBe('/v/sin-perfil/sin-proyecto')
  })

  it('sin vault no hay carpeta', () => {
    expect(carpetaDeNota({ vault: '', perfil: 'work', proyecto: '/x' }, join)).toBe(null)
  })
})

describe('nombreDeNota', () => {
  it('título legible + los 8 del id', () => {
    expect(nombreDeNota('Revisar stocks', 'ce156916-6f2c')).toBe('Revisar stocks ce156916.md')
  })

  it('dos conversaciones con el mismo título NO se pisan', () => {
    // el título sale del primer mensaje y se repite mucho; sin el id, la de hoy
    // sobrescribiría la de ayer
    expect(nombreDeNota('hola', 'aaaaaaaa-1')).not.toBe(nombreDeNota('hola', 'bbbbbbbb-1'))
  })

  it('se reconoce la nota de una conversación por su sufijo', () => {
    const f = nombreDeNota('cualquier cosa', 'ce156916-6f2c')
    expect(esNotaDe(f, 'ce156916-6f2c')).toBe(true)
    expect(esNotaDe(f, 'otro-id-9999')).toBe(false)
    // así se encuentra la nota vieja cuando el título cambió, para renombrarla
    expect(esNotaDe('Título viejo ce156916.md', 'ce156916-6f2c')).toBe(true)
  })
})

describe('cuerpoDeConversacion', () => {
  it('cada mensaje con quién habla', () => {
    const md = cuerpoDeConversacion(convo())
    expect(md).toContain('## 👤 Tú')
    expect(md).toContain('## 🤖 Nami')
    expect(md).toContain('Listo, encontré dos cosas.')
  })

  it('anota documentos y adjuntos', () => {
    const md = cuerpoDeConversacion(
      convo({ messages: [{ role: 'assistant', who: 'Franky', text: 'ahí va', artifact: 'informe.html', atts: [{ name: 'captura.png' }] }] })
    )
    expect(md).toContain('informe.html')
    expect(md).toContain('captura.png')
  })

  it('una conversación sin mensajes no revienta', () => {
    expect(() => cuerpoDeConversacion({ id: 'x' })).not.toThrow()
  })
})

describe('notaDeConversacion', () => {
  it('lleva frontmatter con perfil y proyecto, para filtrar desde el vault', () => {
    const n = notaDeConversacion(convo())
    expect(n.startsWith('---\n')).toBe(true)
    expect(n).toContain('perfil: "work"')
    expect(n).toContain('proyecto: "/Users/diego/Workspace/front-mobile-b2c"')
    expect(n).toContain('mensajes: 2')
    expect(n).toContain('tags: [la-oficina, work]')
  })

  it('un título con comillas no rompe el YAML', () => {
    expect(notaDeConversacion(convo({ title: 'el "modo" raro' }))).toContain('titulo: "el \\"modo\\" raro"')
  })

  it('la conversación de un subagente enlaza a su madre', () => {
    expect(notaDeConversacion(convo(), { padre: 'Encargo grande abcd1234.md' })).toContain('madre: "[[Encargo grande abcd1234]]"')
  })

  it('termina con el separador y lleva la marca de agua', () => {
    const n = notaDeConversacion(convo())
    expect(n).toContain(MARCA)
    expect(n.trimEnd().endsWith(SEPARADOR)).toBe(true)
  })
})

// El comportamiento que evita perder trabajo del usuario. La nota se reescribe en
// CADA guardado —una conversación crece con cada respuesta—, así que sin esto
// serían notas borradas cada pocos minutos.
describe('contenidoAEscribir', () => {
  it('si no existe, escribe la nota entera', () => {
    expect(contenidoAEscribir(convo(), null)).toContain('## 🤖 Nami')
  })

  it('conserva TAL CUAL lo que escribiste bajo el separador', () => {
    const previo = notaDeConversacion(convo()) + '\n## Mis conclusiones\n\nOjo con el datasource.\n'
    const nuevo = contenidoAEscribir(convo({ messages: [...convo().messages, { role: 'user', text: 'otra cosa' }] }), previo)
    expect(nuevo).toContain('## Mis conclusiones')
    expect(nuevo).toContain('Ojo con el datasource.')
    expect(nuevo).toContain('otra cosa') // y además la conversación al día
  })

  it('NO toca un archivo que no sea nuestro', () => {
    // pudo coincidir de nombre con una nota tuya: sobrescribirla sería perder tu
    // trabajo, así que se devuelve null y quien llama no escribe
    expect(contenidoAEscribir(convo(), '# Mi nota de siempre\n\nnada que ver')).toBe(null)
  })

  it('una nota nuestra de antes del separador se regenera sin perder nada', () => {
    const vieja = `---\nid: "x"\n---\n\n${MARCA}\n\n# algo`
    const nuevo = contenidoAEscribir(convo(), vieja)
    expect(nuevo).toContain(SEPARADOR)
    expect(nuevo).toContain('## 🤖 Nami')
  })

  it('no duplica el separador al reescribir', () => {
    const previo = notaDeConversacion(convo()) + '\nmis notas\n'
    const nuevo = contenidoAEscribir(convo(), previo)
    expect(nuevo.split(SEPARADOR).length - 1).toBe(1)
  })
})

// La memoria del proyecto: la dirección contraria a las notas — aquí el vault no
// recibe, alimenta el system prompt de cada agente.
describe('memoria del proyecto', () => {
  const { rutaDeMemoria, memoriaParaPersona, PLANTILLA_MEMORIA } = obs

  it('vive junto a las conversaciones de ese perfil y proyecto', () => {
    expect(rutaDeMemoria({ vault: '/v', perfil: 'work', proyecto: '/x/front-mobile-b2c' }, join)).toBe(
      '/v/work/front-mobile-b2c/_memoria.md'
    )
  })

  it('quita el frontmatter: son metadatos de Obsidian, no le dicen nada al agente', () => {
    expect(memoriaParaPersona('---\ntags: [x]\n---\n\nUsar Riverpod 3.')).toBe('Usar Riverpod 3.')
  })

  it('NO envía los comentarios: son notas para ti, no para el agente', () => {
    // el fallo que evita: la plantilla explica cómo funciona la memoria, y esa
    // explicación se enviaba en cada turno
    const inyectado = memoriaParaPersona(PLANTILLA_MEMORIA)
    expect(inyectado).not.toContain('Sé breve')
    expect(inyectado).not.toContain('system prompt')
    expect(inyectado).toContain('## Decisiones que no se discuten')
  })

  it('lo que escribes sí se envía', () => {
    const nota = PLANTILLA_MEMORIA.replace('## Vocabulario propio', '## Vocabulario propio\n\n- «tren» es el release semanal.')
    expect(memoriaParaPersona(nota)).toContain('«tren» es el release semanal')
  })

  it('sin nota o vacía no se inyecta nada', () => {
    expect(memoriaParaPersona('')).toBe('')
    expect(memoriaParaPersona(null)).toBe('')
    expect(memoriaParaPersona('---\ntags: [x]\n---\n\n<!-- solo comentarios -->')).toBe('')
  })

  it('se recorta con aviso si alguien escribe una novela', () => {
    const r = memoriaParaPersona('x'.repeat(9000), 8000)
    expect(r.length).toBeLessThan(8100)
    expect(r).toContain('recortado')
  })
})

// El vault como ÍNDICE del historial: la lista sale de las notas, y el dato
// (mensajes, sesiones) sigue viniendo del JSON por el id de cada nota.
describe('leer la lista desde las notas', () => {
  const { leeFrontmatter, entradaDeNota } = obs

  it('lee las claves que escribimos', () => {
    const fm = leeFrontmatter(notaDeConversacion(convo()))
    expect(fm.id).toBe('ce156916-6f2c-4bf8-8026-5262a6ad8f1c')
    expect(fm.perfil).toBe('work')
    expect(fm.mensajes).toBe(2)
    expect(fm.tags).toEqual(['la-oficina', 'work'])
  })

  it('aguanta comillas dentro del título', () => {
    const fm = leeFrontmatter(notaDeConversacion(convo({ title: 'el "modo" raro' })))
    expect(fm.titulo).toBe('el "modo" raro')
  })

  it('una nota da la entrada de la lista', () => {
    const e = entradaDeNota(notaDeConversacion(convo()), 'Revisar stocks ce156916.md')
    expect(e.id).toBe('ce156916-6f2c-4bf8-8026-5262a6ad8f1c')
    expect(e.title).toBe('Revisar el módulo de stocks')
    expect(e.project).toBe('/Users/diego/Workspace/front-mobile-b2c')
    expect(e.count).toBe(2)
    expect(e.updatedAt).toBe(1786000000000)
  })

  it('sin id no hay entrada: no se puede ni buscar su dato ni retomarla', () => {
    expect(entradaDeNota('# una nota tuya', 'mia.md')).toBe(null)
    expect(entradaDeNota('---\ntitulo: "x"\n---\n', 'x.md')).toBe(null)
  })

  it('una nota editada a mano no rompe la lista', () => {
    // el caso real: alguien reordena o añade claves suyas en Obsidian
    const n = '---\nmias: [a, b]\nid: "zz-1"\ntitulo: "Editada"\n---\n\ntexto'
    expect(entradaDeNota(n, 'Editada zz.md')).toMatchObject({ id: 'zz-1', title: 'Editada' })
  })

  it('sin frontmatter no es una nota nuestra', () => {
    expect(leeFrontmatter('texto suelto')).toBe(null)
    expect(leeFrontmatter('')).toBe(null)
  })
})

describe('títulos con saltos de línea', () => {
  it('un título multilínea no rompe el frontmatter', () => {
    // pasa siempre: el título sale del primer mensaje del usuario, que suele traer
    // saltos. Visto en el vault real: quedaba «"Luffy refi tecnico local de esta
    // HU:» con la comilla colgando y la lista mal
    const n = obs.notaDeConversacion({ id: 'x-1', title: 'Luffy refi tecnico\n\nde esta HU:\n', messages: [] })
    const e = obs.entradaDeNota(n, 'nota x.md')
    expect(e.title).toBe('Luffy refi tecnico de esta HU:')
    expect(e.id).toBe('x-1')
  })
})
