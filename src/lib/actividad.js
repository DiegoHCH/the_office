// El rastro de lo que va haciendo el agente: qué lee, qué escribe, qué ejecuta.
//
// La app ya recibía un evento por cada herramienta, pero solo guardaba LA
// ÚLTIMA: el siguiente `tool_use` la sobrescribía. Así que se veía qué está
// haciendo ahora y nada de por dónde ha pasado — que es justo lo que sirve para
// supervisar. Esto acumula el rastro por conversación.
//
// Vive aparte de App.jsx porque la clasificación es criterio, no formato: de qué
// familia es cada herramienta decide el color, el verbo y si merece la pena
// mostrar la ruta. Equivocarse aquí no da un error, da un panel que miente sobre
// lo que el agente tocó.

/// Cuántos pasos se recuerdan por conversación. Un turno largo puede pasar de
/// mil llamadas y guardarlas todas no aporta: lo que se supervisa es lo
/// reciente. El corte es por conversación, no global, para que abrir otra
/// pestaña no borre el rastro de esta.
export const TOPE_PASOS = 300

/// Familias de herramienta. El nombre exacto lo pone Claude Code, así que lo que
/// no se reconozca cae en `otro` en vez de desaparecer: una herramienta nueva
/// —o de un MCP— tiene que verse igual, aunque sea sin adornos.
const FAMILIAS = {
  lee: ['Read', 'NotebookRead', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool'],
  escribe: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'],
  corre: ['Bash', 'BashOutput', 'KillShell'],
  piensa: ['TodoWrite', 'Task', 'Agent', 'ExitPlanMode', 'Skill'],
}

export function familiaDe(name = '') {
  for (const [fam, nombres] of Object.entries(FAMILIAS)) {
    if (nombres.includes(name)) return fam
  }
  // Los MCP llegan como `mcp__servidor__herramienta`: son consultas a un
  // servicio externo, así que cuentan como lectura salvo que digan otra cosa.
  if (name.startsWith('mcp__')) return 'lee'
  return 'otro'
}

/// Ruta legible: relativa al proyecto y sin la parte de en medio si es muy larga.
///
/// Una ruta absoluta de sesenta caracteres no se lee de un vistazo, y lo que
/// importa es el final —el archivo— y el principio —dónde vive—. El medio es
/// ruido. Se recorta por SEGMENTOS y no por caracteres: cortar a mitad de un
/// nombre de carpeta produce rutas que parecen otras.
export function rutaCorta(ruta = '', proyecto = '', maxSegmentos = 4) {
  if (!ruta) return ''
  let r = ruta
  if (proyecto && r.startsWith(proyecto)) {
    r = r.slice(proyecto.length).replace(/^\//, '')
    if (!r) return '.'
  }
  const partes = r.split('/').filter(Boolean)
  if (partes.length <= maxSegmentos) return r
  return `${partes[0]}/…/${partes.slice(-(maxSegmentos - 1)).join('/')}`
}

/// La carpeta de una ruta de archivo, que es lo que agrupa el trabajo.
export function carpetaDe(ruta = '') {
  const i = ruta.lastIndexOf('/')
  return i <= 0 ? '' : ruta.slice(0, i)
}

/// Añade un paso al rastro, sin duplicar el inmediatamente anterior.
///
/// Un agente que lee el mismo archivo tres veces seguidas —cosa que pasa: lee,
/// edita, vuelve a leer para comprobar— llenaría el panel de líneas idénticas y
/// escondería lo demás. Se cuentan las repeticiones en vez de repetirlas.
/// Solo se compara con el ÚLTIMO: si volvió a ese archivo después de pasar por
/// otro, eso es información y merece su línea.
export function registra(lista = [], paso, tope = TOPE_PASOS) {
  if (!paso?.name) return lista
  const nuevo = {
    t: paso.t || 0,
    role: paso.role || '',
    name: paso.name,
    detail: paso.detail || '',
    path: paso.path || '',
    familia: familiaDe(paso.name),
    veces: 1,
    // Para poder abrir el paso y ver qué se pidió y qué contestaron. El id es el
    // del tool_use, que es como llega después su resultado.
    id: paso.id || '',
    entrada: paso.entrada || '',
    salida: '',
  }
  const ultimo = lista[lista.length - 1]
  if (ultimo && ultimo.role === nuevo.role && ultimo.name === nuevo.name && ultimo.detail === nuevo.detail) {
    const copia = lista.slice(0, -1)
    // La fila agrupada se queda con el detalle de la ÚLTIMA vez, y por eso también
    // con su id: si conservara el primero, la salida que llegue después se
    // colgaría de una llamada que ya no se está mirando.
    copia.push({ ...ultimo, veces: ultimo.veces + 1, t: nuevo.t || ultimo.t, id: nuevo.id, entrada: nuevo.entrada, salida: '' })
    return limpiaViejos(copia)
  }
  const salida = [...lista, nuevo]
  return limpiaViejos(salida.length > tope ? salida.slice(salida.length - tope) : salida)
}

/// Cuántos pasos conservan su entrada y su salida completas.
///
/// El rastro guarda 300 pasos, pero el detalle de cada uno pesa: entre el comando
/// y su salida, un paso puede ocupar 3 KB, y multiplicado por 300 y por pestaña ya
/// son megas en memoria. Lo que se abre a mirar es lo reciente, así que los pasos
/// viejos se quedan con su línea —la fila sigue ahí, el rastro no se pierde— y
/// suelta el contenido.
export const PASOS_CON_DETALLE = 60

function limpiaViejos(lista) {
  if (lista.length <= PASOS_CON_DETALLE) return lista
  const corte = lista.length - PASOS_CON_DETALLE
  return lista.map((p, i) => (i < corte && (p.entrada || p.salida) ? { ...p, entrada: '', salida: '', purgado: true } : p))
}

/// Cuelga la salida de una herramienta del paso que la pidió.
///
/// Se busca por el id del tool_use y del final hacia atrás: el resultado llega
/// justo después de su llamada, así que lo normal es acertar en el primer intento.
/// Un id que no está —el paso ya salió del tope, o era una delegación que no se
/// registra como herramienta— se ignora sin ruido.
export function anotaSalida(lista = [], id, salida, isError = false) {
  if (!id || !salida) return lista
  for (let i = lista.length - 1; i >= 0; i--) {
    if (lista[i].id !== id) continue
    const copia = [...lista]
    copia[i] = { ...copia[i], salida, salidaError: !!isError }
    return copia
  }
  return lista
}

/// Resumen de un rastro: cuántas lecturas, escrituras y comandos, y qué
/// carpetas se han tocado.
///
/// Es lo que va en el botón, para que decida si merece la pena abrir el panel
/// sin tener que abrirlo.
export function resumen(lista = []) {
  const cuenta = { lee: 0, escribe: 0, corre: 0, piensa: 0, otro: 0 }
  const carpetas = new Set()
  const archivos = new Set()
  for (const p of lista) {
    cuenta[p.familia] = (cuenta[p.familia] || 0) + p.veces
    if (p.path) {
      archivos.add(p.path)
      const c = carpetaDe(p.path)
      if (c) carpetas.add(c)
    }
  }
  return { pasos: lista.reduce((n, p) => n + p.veces, 0), cuenta, carpetas: [...carpetas], archivos: [...archivos] }
}
