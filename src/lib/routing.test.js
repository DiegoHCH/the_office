import { describe, expect, it } from 'vitest'
import { routeMessage, detectHandoff } from './routing.js'
import { safeRegex, ROLE_META } from '../data/roles.js'

// Squad de prueba con nombres que ejercitan tildes, mayúsculas y keywords.
const SQUAD = [
  { id: 'dev', name: 'Luffy', kw: safeRegex('codigo, bug, fix') },
  { id: 'research', name: 'Nami', kw: safeRegex('investiga, busca') },
  { id: 'design', name: 'Sanji', kw: safeRegex('diseño, ui, ux') },
  { id: 'qa', name: 'Zoro', kw: safeRegex('test, prueba') },
  { id: 'docs', name: 'Andrés', kw: safeRegex('documenta, readme') },
]
const P = 'dev' // principal

describe('routeMessage', () => {
  it('sin pistas va al principal', () => {
    expect(routeMessage('hola, ¿cómo vas?', SQUAD, P)).toBe('dev')
  })

  it('nombre al inicio manda sobre todo', () => {
    expect(routeMessage('Zoro, corre los tests', SQUAD, P)).toBe('qa')
    expect(routeMessage('Sanji revisa esta pantalla', SQUAD, P)).toBe('design')
  })

  it('el nombre al inicio gana aunque haya keywords de otro rol', () => {
    // "test" es keyword de QA, pero el mensaje empieza llamando a Sanji
    expect(routeMessage('Sanji, mira el test de la pantalla', SQUAD, P)).toBe('design')
  })

  it('@nombre en cualquier parte del texto', () => {
    expect(routeMessage('oye @Nami investiga esto porfa', SQUAD, P)).toBe('research')
    expect(routeMessage('esto es para @Zoro', SQUAD, P)).toBe('qa')
  })

  it('es insensible a mayúsculas y tildes', () => {
    expect(routeMessage('ANDRÉS, documenta el módulo', SQUAD, P)).toBe('docs')
    expect(routeMessage('andres, documenta el módulo', SQUAD, P)).toBe('docs')
    expect(routeMessage('@ANDRES revisa', SQUAD, P)).toBe('docs')
  })

  it('keywords rutean cuando no hay nombre', () => {
    expect(routeMessage('hay un bug en el login', SQUAD, P)).toBe('dev')
    expect(routeMessage('investiga las alternativas', SQUAD, P)).toBe('research')
    expect(routeMessage('corre los test del carrito', SQUAD, P)).toBe('qa')
  })

  it('las keywords del principal no le roban el turno a otros', () => {
    // 'codigo' es del principal: igual llega a él, sin ambigüedad
    expect(routeMessage('revisa el codigo', SQUAD, P)).toBe('dev')
  })

  it('saluda y luego nombra: es interpelación directa', () => {
    // el caso que fallaba: iba al principal en vez de a Nami
    expect(routeMessage('Hola Nami, cuál es tu cargo en la oficina?', SQUAD, P)).toBe('research')
    expect(routeMessage('oye Zoro, corre los tests', SQUAD, P)).toBe('qa')
    expect(routeMessage('buenas tardes Sanji: mira esto', SQUAD, P)).toBe('design')
  })

  it('saludar y nombrar funciona con coma o sin ella', () => {
    expect(routeMessage('Hola Nami', SQUAD, P)).toBe('research')
    expect(routeMessage('hola nami como estas?', SQUAD, P)).toBe('research')
    expect(routeMessage('Hola Nami cuál es tu cargo en la oficina?', SQUAD, P)).toBe('research')
    expect(routeMessage('buenas Zoro', SQUAD, P)).toBe('qa')
    expect(routeMessage('buenos días Sanji', SQUAD, P)).toBe('design')
    expect(routeMessage('hey nami que tal', SQUAD, P)).toBe('research')
    expect(routeMessage('por favor Nami investiga esto', SQUAD, P)).toBe('research')
  })

  it('el nombre al final tras coma también interpela', () => {
    expect(routeMessage('revisa el login, Zoro', SQUAD, P)).toBe('qa')
    expect(routeMessage('¿puedes con esto, Nami?', SQUAD, P)).toBe('research')
  })

  it('nombrar a alguien rutea esté donde esté el nombre', () => {
    // decisión explícita: se prefiere que nombrar siempre funcione, aunque a
    // veces rutee una mención de pasada, a tener que recordar dónde ponerlo
    expect(routeMessage('esto lo vio Zoro ayer', SQUAD, P)).toBe('qa')
    expect(routeMessage('el bug que reportó Nami sigue vivo', SQUAD, P)).toBe('research')
    expect(routeMessage('mañana Nami lo revisa', SQUAD, P)).toBe('research')
  })

  it('con varios nombres gana el que aparece antes, no el orden del squad', () => {
    expect(routeMessage('Nami investiga y pásaselo a Luffy', SQUAD, P)).toBe('research')
    expect(routeMessage('dile a Luffy que Nami ya lo vio', SQUAD, P)).toBe('dev')
  })

  it('nombres que son prefijo de una palabra no matchean', () => {
    // "Namibia" no debe rutear a Nami
    expect(routeMessage('Namibia queda en África', SQUAD, P)).toBe('dev')
  })

  it('tolera texto vacío', () => {
    expect(routeMessage('', SQUAD, P)).toBe('dev')
  })

  it('el principal también compite por keyword', () => {
    // antes quedaba excluido de la ronda de keywords, así que cualquier keyword
    // ajena le robaba el mensaje aunque la suya apareciera primero
    expect(routeMessage('arregla el codigo y luego lo diseñamos', SQUAD, P)).toBe('dev')
    expect(routeMessage('hay un bug en el ui del carrito', SQUAD, P)).toBe('dev')
  })

  it('con varias keywords gana la que aparece antes, no el orden del squad', () => {
    expect(routeMessage('documenta lo que investigó el equipo', SQUAD, P)).toBe('docs')
    expect(routeMessage('investiga y documenta el hallazgo', SQUAD, P)).toBe('research')
    // el principal no tiene privilegio: si su keyword va después, pierde
    expect(routeMessage('corre el test y arregla el codigo', SQUAD, P)).toBe('qa')
  })
})

describe('keywords con tildes', () => {
  it('una keyword acentuada sí rutea (el mensaje se compara normalizado)', () => {
    // antes quedaba muerta en silencio: safeRegex guardaba «diseño» pero el
    // ruteo compara contra texto sin tildes, así que el rol nunca se activaba
    const conTildes = [
      { id: 'dev', name: 'Luffy', kw: safeRegex('codigo') },
      { id: 'design', name: 'Sanji', kw: safeRegex('diseño, botón, tipografía') },
    ]
    expect(routeMessage('revisa el diseño de la home', conTildes, 'dev')).toBe('design')
    expect(routeMessage('el botón no se ve', conTildes, 'dev')).toBe('design')
    expect(routeMessage('cambia la tipografía', conTildes, 'dev')).toBe('design')
  })
})

describe('afinidad de conversación', () => {
  it('un seguimiento sin pistas se queda con quien venía trabajando', () => {
    expect(routeMessage('ahora hazlo general para todo el módulo', SQUAD, P, 'design')).toBe('design')
    expect(routeMessage('listo, y lo mismo en la otra', SQUAD, P, 'research')).toBe('research')
    expect(routeMessage('eso, tal cual', SQUAD, P, 'qa')).toBe('qa')
  })

  it('sin seguimiento manda el principal, no el último', () => {
    expect(routeMessage('hola, ¿cómo vas?', SQUAD, P, 'design')).toBe('dev')
    expect(routeMessage('necesito otra cosa', SQUAD, P, 'design')).toBe('dev')
  })

  it('la afinidad no le gana a las keywords ni a los nombres', () => {
    // «ahora» arranca continuación, pero el encargo es claramente de diseño
    expect(routeMessage('ahora el diseño de la home', SQUAD, P, 'dev')).toBe('design')
    expect(routeMessage('ahora investiga las alternativas', SQUAD, P, 'dev')).toBe('research')
    expect(routeMessage('ahora Zoro lo prueba', SQUAD, P, 'dev')).toBe('qa')
  })

  it('ignora un último que ya no está en el squad', () => {
    expect(routeMessage('ahora hazlo general', SQUAD, P, 'publish')).toBe('dev')
  })

  it('sin último se comporta como antes', () => {
    expect(routeMessage('ahora hazlo general', SQUAD, P)).toBe('dev')
    expect(routeMessage('ahora hazlo general', SQUAD, P, null)).toBe('dev')
  })

  it('no confunde un «ahora» que no arranca el mensaje', () => {
    expect(routeMessage('no me gusta ahora que lo veo', SQUAD, P, 'design')).toBe('dev')
  })
})

// El ruteo real depende de los kw del catálogo, no de los del squad de prueba:
// estos casos fijan el vocabulario con el que se convive a diario.
describe('routeMessage con las keywords del catálogo', () => {
  const REAL = [
    { id: 'dev', name: 'Luffy', kw: ROLE_META.dev.kw },
    { id: 'design', name: 'Sanji', kw: ROLE_META.design.kw },
    { id: 'qa', name: 'Zoro', kw: ROLE_META.qa.kw },
  ]

  it('un follow-up de código no se va a UI/UX por decir «estilo»', () => {
    // el caso reportado: iba a design por «estilo» pese a hablar de un widget
    expect(
      routeMessage(
        'Ahora ese componente o widget del disclaimer, con el estilo centrado que usamos en las pantallas de compra y venta, ¿lo hiciste general para todo el módulo stocks?',
        REAL,
        'dev'
      )
    ).toBe('dev')
    expect(routeMessage('refactoriza ese widget del disclaimer con el estilo centrado', REAL, 'dev')).toBe('dev')
  })

  it('el vocabulario de Flutter es del dev', () => {
    expect(routeMessage('el provider de stocks no refresca despues de la compra', REAL, 'dev')).toBe('dev')
    expect(routeMessage('migra el widget a Riverpod 3 y corre build_runner', REAL, 'dev')).toBe('dev')
    expect(routeMessage('el layout de la pantalla de venta se desborda', REAL, 'dev')).toBe('dev')
  })

  it('los encargos de diseño siguen llegando a UI/UX', () => {
    expect(routeMessage('diseña la pantalla de detalle de la accion', REAL, 'dev')).toBe('design')
    expect(routeMessage('cambia la tipografia del titulo', REAL, 'dev')).toBe('design')
    expect(routeMessage('esto no cumple el ux del flujo', REAL, 'dev')).toBe('design')
  })

  it('QA sigue quedándose con las pruebas', () => {
    expect(routeMessage('agrega tests unitarios al usecase de compra', REAL, 'dev')).toBe('qa')
  })
})

describe('detectHandoff', () => {
  it('detecta la flecha explícita', () => {
    expect(detectHandoff('Nami -> Luffy: pásale el análisis', SQUAD, 'research')).toBe('dev')
    expect(detectHandoff('investiga y → Zoro', SQUAD, 'research')).toBe('qa')
  })

  it('detecta el verbo de entrega con destinatario', () => {
    expect(detectHandoff('investiga esto y pásaselo a Zoro', SQUAD, 'research')).toBe('qa')
    expect(detectHandoff('arregla el bug para que Zoro lo pruebe', SQUAD, 'dev')).toBe('qa')
  })

  it('no hay handoff sin verbo de entrega', () => {
    expect(detectHandoff('Zoro ya lo revisó ayer', SQUAD, 'dev')).toBe(null)
    expect(detectHandoff('arregla el login', SQUAD, 'dev')).toBe(null)
  })

  it('nunca se entrega a sí mismo', () => {
    expect(detectHandoff('arréglalo y pásaselo a Luffy', SQUAD, 'dev')).toBe(null)
  })

  it('funciona con tildes en el destinatario', () => {
    expect(detectHandoff('termina y pásaselo a Andrés', SQUAD, 'dev')).toBe('docs')
  })
})

// «Publicar» no es de un solo rol. El Publicador sube documentos a GitHub Pages;
// publicar una app en una tienda es del dev. Antes bastaba con que la palabra
// apareciera antes en la frase para que se lo llevara el Publicador.
describe('publicar: tienda de apps vs GitHub Pages', () => {
  const squad = Object.entries(ROLE_META).map(([id, m], i) => ({ id, ...m, name: `A${i}` }))
  const va = (txt) => routeMessage(txt, squad, 'dev', null)

  it('publicar una app en una tienda es del dev', () => {
    expect(va('Ya publique la app en la play store, qué me falta para el app store')).toBe('dev')
    expect(va('cómo subo el ipa a TestFlight')).toBe('dev')
    expect(va('necesito el provisioning profile para publicar')).toBe('dev')
  })

  it('publicar un documento sigue siendo del Publicador', () => {
    expect(va('publica el documento en github pages')).toBe('publish')
    expect(va('sube este artifact a la web')).toBe('publish')
    expect(va('despliega la pagina')).toBe('publish')
    expect(va('publica el reporte de ayer')).toBe('publish')
  })
})
