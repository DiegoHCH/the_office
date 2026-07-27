// Generador de la guía en inglés (#118).
//
// public/ayuda.html es el documento canónico: estructura, estilos y texto en
// español. La versión inglesa NO se edita a mano — se genera de aquí con el
// mapa docs/guia.en.json, que traduce cada cadena del original.
//
// Si añades algo al español y no lo traduces, el generador FALLA con la lista
// de cadenas pendientes. Ese es el punto: las dos versiones ya no pueden
// desincronizarse en silencio, que es lo que pasó al nacer la inglesa (salió
// sin las pestañas de conversación y con la mascota como «un zorrito»).
//
//   node scripts/guia.mjs           → regenera public/ayuda.en.html
//   node scripts/guia.mjs --check   → solo verifica que esté al día (CI)
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
export const ORIGEN = join(raiz, 'public/ayuda.html')
export const DESTINO = join(raiz, 'public/ayuda.en.html')
export const MAPA = join(raiz, 'docs/guia.en.json')

// El contenido de <style> es CSS, no texto: se deja intacto.
const SIN_TEXTO = /^<(style|script)\b/i

// Divide el HTML en piezas alternando etiqueta / texto, y marca cuáles son
// texto de verdad (fuera de <style> y no solo espacios).
export function trocear(html) {
  const piezas = html.split(/(<[^>]+>)/)
  let dentroDeCss = false
  return piezas.map((p) => {
    const esEtiqueta = p.startsWith('<')
    if (esEtiqueta) {
      if (SIN_TEXTO.test(p)) dentroDeCss = true
      else if (/^<\/(style|script)>/i.test(p)) dentroDeCss = false
      return { texto: p, traducible: false }
    }
    // sin letras no hay nada que traducir: separadores como «·», «/» o «:»
    // aparecen decenas de veces con espaciados distintos y solo dan ruido
    return { texto: p, traducible: !dentroDeCss && /\p{L}/u.test(p) }
  })
}

// La clave se busca recortada (estable frente a saltos de línea del original),
// pero el valor se emite TAL CUAL: el inglés lleva sus propios espacios. Antes
// se le aplicaban los del español y se comían separaciones donde la frase se
// parte distinto («<b>⏳ N</b> badge» quedaba pegado).
function traducirPieza(pieza, mapa, faltantes) {
  const clave = pieza.texto.trim()
  const traducida = mapa[clave]
  if (traducida === undefined) {
    faltantes.push(clave)
    return pieza.texto
  }
  return traducida
}

export function generar(htmlEs, mapa) {
  const faltantes = []
  const salida = trocear(htmlEs)
    .map((p) => (p.traducible ? traducirPieza(p, mapa, faltantes) : p.texto))
    .join('')
    // lo único que no es texto interno: el idioma del documento
    .replace('<html lang="es">', '<html lang="en">')
  return { html: salida, faltantes }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('guia.mjs')) {
  const html = readFileSync(ORIGEN, 'utf8')
  const mapa = JSON.parse(readFileSync(MAPA, 'utf8'))
  const { html: salida, faltantes } = generar(html, mapa)
  if (faltantes.length) {
    console.error(`✗ ${faltantes.length} cadenas sin traducir en docs/guia.en.json:\n`)
    for (const f of faltantes) console.error(`  ${JSON.stringify(f)}: "",`)
    process.exit(1)
  }
  if (process.argv.includes('--check')) {
    const actual = readFileSync(DESTINO, 'utf8')
    if (actual !== salida) {
      console.error('✗ public/ayuda.en.html está desactualizada — corre `npm run guia`')
      process.exit(1)
    }
    console.log('✓ la guía en inglés está al día')
  } else {
    writeFileSync(DESTINO, salida)
    console.log(`✓ ${DESTINO.split('/').pop()} regenerada`)
  }
}
