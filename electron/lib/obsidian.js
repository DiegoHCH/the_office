// Las conversaciones, en tu vault de Obsidian.
//
// El historial de la app es un JSON por conversación en su carpeta de datos:
// sirve para retomarla, no para leerla ni buscarla dentro de tus notas. Esto
// escribe además una nota Markdown por conversación, **separada por perfil y por
// proyecto**, para que work y private no se mezclen y cada repo tenga las suyas.
//
// Aquí solo vive lo que se puede probar sin tocar disco: dónde va cada nota, cómo
// se llama y qué contiene. El fs está en electron/ipc/obsidian.js.
//
// LA REGLA QUE MANDA: la nota se REESCRIBE en cada guardado —una conversación
// crece con cada respuesta—, así que todo lo que escribas tú dentro se perdería.
// De ahí el separador: lo que pongas DEBAJO se conserva intacto. Sin eso, esto
// sería una función que borra las notas del usuario cada pocos minutos.
const SEPARADOR = '<!-- ↓ tus notas: lo que escribas debajo de esta línea se conserva ↓ -->'
// Marca de agua para reconocer una nota nuestra. Un archivo que no la tenga NO se
// sobrescribe: es de la persona, o de otra herramienta, y no nos toca.
const MARCA = '<!-- generado por La Oficina -->'

/// Un nombre de carpeta o archivo que no pelee con el sistema ni con Obsidian.
///
/// Se quitan los caracteres que rompen rutas (`/ \ : * ? " < > |`) y los que
/// Obsidian usa para enlazar (`[ ] # ^ |`): un `#` en el nombre convierte el
/// enlace en una referencia a encabezado, y el enlace deja de resolver.
function sanitiza(nombre, tope = 60) {
  const limpio = String(nombre || '')
    .replace(/[/\\:*?"<>|[\]#^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, tope)
    .trim()
    // un punto al final lo pierde macOS y deja `nota .md`
    .replace(/\.+$/, '')
  return limpio || 'sin-titulo'
}

/// Carpeta de una conversación: vault / perfil / proyecto.
///
/// Del proyecto se usa el ÚLTIMO segmento, no la ruta entera: una carpeta
/// `Users/diego/Workspace/front-mobile-b2c` dentro del vault sería un árbol de
/// cuatro niveles para no decir nada. Sin proyecto va a «sin-proyecto», que es
/// mejor que dejarlas suelas en la raíz del perfil mezcladas con las demás.
function carpetaDeNota({ vault, perfil, proyecto }, join) {
  if (!vault) return null
  const p = String(proyecto || '').replace(/\/+$/, '')
  const hoja = p ? p.split('/').filter(Boolean).pop() : ''
  return join(vault, sanitiza(perfil || 'sin-perfil', 40), sanitiza(hoja || 'sin-proyecto', 40))
}

/// Nombre del archivo: título legible + los 8 primeros del id.
///
/// El id va en el nombre porque el título CAMBIA —sale del primer mensaje, y se
/// puede renombrar— y sin él la nota de ayer y la de hoy se pisarían al coincidir
/// de título. Con el sufijo, además, se puede encontrar la nota vieja para
/// renombrarla en vez de dejar dos.
const nombreDeNota = (titulo, id) => `${sanitiza(titulo || 'conversación')} ${String(id || '').slice(0, 8)}.md`

/// ¿Este archivo es la nota de esta conversación? Por el sufijo del id.
const esNotaDe = (archivo, id) => archivo.endsWith(` ${String(id || '').slice(0, 8)}.md`)

/// La nota de memoria de un perfil+proyecto: lo que quieres que el squad sepa
/// SIEMPRE en ese repo, escrito por ti en Obsidian.
///
/// Vive junto a las conversaciones de ese proyecto y empieza por `_` para que
/// quede arriba en el explorador de Obsidian, separada de las conversaciones.
const nombreMemoria = () => '_memoria.md'
const rutaDeMemoria = (donde, join) => {
  const c = carpetaDeNota(donde, join)
  return c ? join(c, nombreMemoria()) : null
}

/// Plantilla de la nota de memoria. Se crea vacía de contenido pero con la forma,
/// porque un archivo en blanco no dice qué se espera dentro — y lo que se espera
/// aquí no es un diario, son las cuatro cosas que hay que saber siempre.
const PLANTILLA_MEMORIA = `---
tags: [la-oficina, memoria]
---

<!--
  Esta nota la lee La Oficina: lo que escribas AQUÍ FUERA del comentario se le
  pasa al squad en cada conversación de este proyecto, dentro de su system
  prompt. No hace falta que nadie la busque ni la lea.

  Estas instrucciones van en un comentario a propósito: así te las ves al editar
  pero NO se le envían al agente, que no necesita que le expliquen cómo funciona
  su propia memoria.

  Sé breve. Esto viaja en cada turno, y lo que sobra ocupa el contexto que hace
  falta para trabajar. Si algo solo importa una vez, dilo en el chat.
-->

## Qué es este proyecto

## Decisiones que no se discuten

## Cosas que ya se intentaron y no funcionaron

## Vocabulario propio
`

/// El texto de la memoria listo para inyectar, con tope.
///
/// Se recorta con aviso por lo mismo de siempre: un texto cortado en seco parece
/// completo. Y se quita el frontmatter, que son metadatos de Obsidian y no le
/// dicen nada al agente — solo ocuparían contexto.
function memoriaParaPersona(texto, tope = 8000) {
  let t = String(texto || '').trim()
  if (!t) return ''
  if (t.startsWith('---')) {
    const fin = t.indexOf('\n---', 3)
    if (fin > 0) t = t.slice(fin + 4).trim()
  }
  // Los comentarios HTML son notas PARA TI —empezando por las de la plantilla— y
  // no para el agente: se ven al editar en Obsidian y no se envían. Sin esto, el
  // «sé breve, esto viaja en cada turno» viajaba en cada turno.
  t = t.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (t.length > tope) t = `${t.slice(0, tope)}\n… (recortado; el resto está en la nota)`
  return t
}

/// Lee el frontmatter de una nota. Solo lo que esta app escribe: `clave: "valor"`,
/// números sueltos y `tags: [a, b]`. No es un parser de YAML y no pretende serlo
/// —arrastrar uno para leer ocho claves propias sería pagar mucho por poco—, pero
/// tiene que aguantar que la persona edite la nota a mano sin romper la lista.
function leeFrontmatter(texto) {
  const t = String(texto || '')
  if (!t.startsWith('---')) return null
  const fin = t.indexOf('\n---', 3)
  if (fin < 0) return null
  const out = {}
  for (const linea of t.slice(4, fin).split('\n')) {
    const m = linea.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (v.startsWith('[') && v.endsWith(']')) {
      out[m[1]] = v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean)
      continue
    }
    // comillas opcionales; se desescapan las internas como las escribimos
    if (v.startsWith('"') && v.endsWith('"') && v.length > 1) v = v.slice(1, -1).replace(/\\"/g, '"')
    out[m[1]] = /^\d+$/.test(v) ? Number(v) : v
  }
  return out
}

/// Una entrada de la lista del historial, sacada de la nota.
///
/// El vault es el ÍNDICE: decide qué conversaciones existen y cómo se llaman. Los
/// mensajes y las sesiones siguen viniendo del JSON por su id, que es lo que
/// permite retomarlas — una nota es legible pero no basta para devolver contexto.
function entradaDeNota(texto, archivo = '') {
  const fm = leeFrontmatter(texto)
  if (!fm?.id) return null
  return {
    id: fm.id,
    title: fm.titulo || archivo.replace(/\.md$/, ''),
    profile: fm.perfil || '',
    project: fm.proyecto || '',
    count: Number(fm.mensajes) || 0,
    updatedAt: fm.actualizada ? Date.parse(fm.actualizada) || 0 : 0,
    nota: archivo,
  }
}

/// El cuerpo de la conversación en Markdown. Lo comparten la exportación a un
/// archivo y la nota del vault: si cada una tuviera su formato, la misma
/// conversación se leería distinta según por dónde saliera.
function cuerpoDeConversacion(convo, { titulo = true } = {}) {
  const when = convo.updatedAt ? new Date(convo.updatedAt).toLocaleString('es') : ''
  const lines = []
  if (titulo) {
    lines.push(`# ${convo.title || 'Conversación'}`, '')
    lines.push(
      `> Perfil: ${convo.profile || '—'} · Proyecto: \`${convo.project || '—'}\` · Modelo: ${convo.model || '—'}${when ? ` · ${when}` : ''}`,
      ''
    )
  }
  for (const m of convo.messages || []) {
    const head = m.role === 'user' ? `## 👤 Tú${m.to ? ` → ${m.to}` : ''}` : `## 🤖 ${m.who || 'Agente'}`
    lines.push(head, '', m.text || '', '')
    if (m.artifact) lines.push(`> 📄 Documento: \`${m.artifact}\``, '')
    if (m.atts?.length) lines.push(`> 📎 Adjuntos: ${m.atts.map((a) => `\`${a.name || a.path || a}\``).join(', ')}`, '')
  }
  return lines.join('\n')
}

// Los títulos salen del primer mensaje del usuario, así que traen saltos de línea
// a menudo. Sin aplanarlos, el valor se parte en varias líneas y el frontmatter
// deja de ser válido: visto en el vault real, un título quedó como `"Luffy refi
// tecnico local de esta HU:` con la comilla colgando y el resto fuera.
const yamlSeguro = (v) =>
  `"${String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/"/g, '\\"')}"`

/// La nota completa: frontmatter + conversación + separador.
///
/// El frontmatter son propiedades de Obsidian, así que el perfil y el proyecto se
/// pueden filtrar y agrupar desde el propio vault. Y `parent` sale como enlace
/// `[[…]]` cuando la conversación es de un subagente: en el grafo se ve colgando
/// de la que repartió el trabajo, que es donde tiene sentido.
function notaDeConversacion(convo, { padre = '' } = {}) {
  const fecha = convo.updatedAt ? new Date(convo.updatedAt).toISOString() : ''
  const front = [
    '---',
    `titulo: ${yamlSeguro(convo.title || 'Conversación')}`,
    `perfil: ${yamlSeguro(convo.profile || '')}`,
    `proyecto: ${yamlSeguro(convo.project || '')}`,
    `modelo: ${yamlSeguro(convo.model || '')}`,
    `mensajes: ${(convo.messages || []).length}`,
    `actualizada: ${yamlSeguro(fecha)}`,
    `id: ${yamlSeguro(convo.id || '')}`,
    // Etiquetas para poder buscar por perfil o por proyecto sin abrir la nota.
    `tags: [la-oficina, ${sanitiza(convo.profile || 'sin-perfil', 30).replace(/\s+/g, '-')}]`,
    ...(padre ? [`madre: "[[${padre.replace(/\.md$/, '')}]]"`] : []),
    '---',
    '',
    MARCA,
    '',
  ]
  return `${front.join('\n')}${cuerpoDeConversacion(convo)}\n\n${SEPARADOR}\n`
}

/// Qué escribir, dado lo que ya había en el archivo.
///
/// Tres casos, y los tres importan:
///   · no existe            → la nota entera.
///   · existe y es nuestra  → nota nueva + TODO lo que hubiera bajo el separador.
///   · existe y NO es nuestra → null, no se toca. Puede ser una nota tuya que
///     coincidió de nombre, y sobrescribirla sería perder tu trabajo.
function contenidoAEscribir(convo, previo, opciones = {}) {
  const nueva = notaDeConversacion(convo, opciones)
  if (!previo) return nueva
  if (!previo.includes(MARCA)) return null // no es nuestra: se respeta
  const i = previo.indexOf(SEPARADOR)
  if (i < 0) return nueva // nuestra pero de una versión anterior sin separador
  // Lo que hay tras el separador es tuyo y viaja tal cual, empezando por el salto
  // de línea que dejó la nota anterior. Se corta la nota nueva justo en su
  // separador y se pega: sin regex, que aquí solo servía para equivocarse.
  const corte = nueva.lastIndexOf(SEPARADOR) + SEPARADOR.length
  return nueva.slice(0, corte) + previo.slice(i + SEPARADOR.length)
}

module.exports = { sanitiza, leeFrontmatter, entradaDeNota, carpetaDeNota, rutaDeMemoria, nombreMemoria, PLANTILLA_MEMORIA, memoriaParaPersona, nombreDeNota, esNotaDe, cuerpoDeConversacion, notaDeConversacion, contenidoAEscribir, SEPARADOR, MARCA }
