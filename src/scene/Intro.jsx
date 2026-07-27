import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { PerspectiveCamera, RoundedBox, ContactShadows } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { DoubleSide, BackSide, MathUtils, TextureLoader, RepeatWrapping, ACESFilmicToneMapping, CanvasTexture } from 'three'
import GltfProp from './GltfProp.jsx'

// ── Intro cinemática (#112) ──────────────────────────────────────────────────
// El edificio de La Oficina visto desde fuera: mismo lenguaje visual que la
// sala (ladrillo y madera texturizados, luz cálida, bloom y ACES), con las
// ventanas encendidas para que se sienta que el squad ya está adentro.
// La cámara hace dolly a la entrada, las puertas se abren y un destello funde.

const WOOD_TRIM = '#c08a52' // cornisas y marcos de madera cálida
const WOOD_DARK = '#7a5636'
const STONE = '#e2dbcd' // zócalo claro
const PATH = '#cfc6b4'

function RB({ args, r = 0.02, children, ...props }) {
  const radius = Math.max(Math.min(r, Math.min(...args) / 2 - 0.001), 0.004)
  return (
    <RoundedBox args={args} radius={radius} smoothness={3} {...props}>
      {children}
    </RoundedBox>
  )
}

// Mismas texturas que la sala: el edificio es "la misma casa" por fuera.
function useFacadeTextures() {
  const [brickC, brickN, brickR, woodC] = useLoader(TextureLoader, [
    '/textures/brick-color.jpg',
    '/textures/brick-normal.jpg',
    '/textures/brick-rough.jpg',
    '/textures/wood-color.jpg',
  ])
  return useMemo(() => {
    const tile = (t, x, y) => {
      const c = t.clone()
      c.wrapS = c.wrapT = RepeatWrapping
      c.repeat.set(x, y)
      c.needsUpdate = true
      return c
    }
    return {
      brick: { map: tile(brickC, 3, 2), normalMap: tile(brickN, 3, 2), roughnessMap: tile(brickR, 3, 2) },
      deck: { map: tile(woodC, 4, 4) },
    }
  }, [brickC, brickN, brickR, woodC])
}

// Ventana con luz interior cálida (la oficina encendida). El marco es de
// madera, como los muebles de adentro.
function WarmWindow({ position, rotation = [0, 0, 0], w = 0.52, h = 0.62, lit = true }) {
  return (
    <group position={position} rotation={rotation}>
      <RB args={[w + 0.07, h + 0.07, 0.05]} r={0.015} castShadow>
        <meshStandardMaterial color={WOOD_TRIM} roughness={0.75} />
      </RB>
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial
          color={lit ? '#ffd9a0' : '#5d7484'}
          emissive={lit ? '#ffb267' : '#22303a'}
          emissiveIntensity={lit ? 1.5 : 0.15}
        />
      </mesh>
      {/* cruceta */}
      <mesh position={[0, 0, 0.045]}>
        <boxGeometry args={[w, 0.022, 0.01]} />
        <meshStandardMaterial color={WOOD_TRIM} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.045]}>
        <boxGeometry args={[0.022, h, 0.01]} />
        <meshStandardMaterial color={WOOD_TRIM} roughness={0.8} />
      </mesh>
    </group>
  )
}


// Fachada de vidrio generada en canvas: paneles individuales separados por
// montantes oscuros, unos encendidos (cálidos) y otros apagados (azules) —
// como en la referencia. Una textura por torre en vez de miles de mallas.
function makeFacade(seed = 1, cols = 4, rows = 4) {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')
  let s2 = seed * 9301 + 49297
  const rnd = () => ((s2 = (s2 * 9301 + 49297) % 233280) / 233280)
  ctx.fillStyle = '#232a30' // montantes / estructura
  ctx.fillRect(0, 0, 128, 128)
  const cw = 128 / cols
  const ch = 128 / rows
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const r = rnd()
      // 30% encendida (cálida), 45% vidrio azul con reflejo, resto apagada
      const fill = r < 0.3 ? '#ffca85' : r < 0.75 ? '#5aa8dd' : '#2f4a5c'
      ctx.fillStyle = fill
      ctx.fillRect(x * cw + 1.5, y * ch + 2.5, cw - 3, ch - 5)
      // brillo diagonal del vidrio (solo en los azules)
      if (r >= 0.3 && r < 0.75) {
        const g = ctx.createLinearGradient(x * cw, y * ch, (x + 1) * cw, (y + 1) * ch)
        g.addColorStop(0, 'rgba(255,255,255,0.35)')
        g.addColorStop(0.5, 'rgba(255,255,255,0.05)')
        g.addColorStop(1, 'rgba(255,255,255,0.18)')
        ctx.fillStyle = g
        ctx.fillRect(x * cw + 1.5, y * ch + 2.5, cw - 3, ch - 5)
      }
    }
  }
  const tex = new CanvasTexture(c)
  tex.wrapS = tex.wrapT = RepeatWrapping
  return tex
}

// Torre moderna: losas blancas entre pisos y muro cortina de vidrio.
function GlassTower({ position, w, d, h, rot = 0, seed = 1 }) {
  const floors = Math.max(2, Math.round(h / 0.62))
  const tex = useMemo(() => {
    const t = makeFacade(seed, 4, 3)
    t.repeat.set(Math.max(1, Math.round(w * 1.6)), Math.max(1, floors))
    return t
  }, [seed, w, floors])
  const face = (
    <meshStandardMaterial
      map={tex}
      emissiveMap={tex}
      emissive="#ffffff"
      emissiveIntensity={0.42}
      roughness={0.18}
      metalness={0.5}
    />
  )
  return (
    <group position={position} rotation={[0, rot, 0]}>
      {/* núcleo (se ve en las esquinas, entre las fachadas) */}
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.98, h, d * 0.98]} />
        <meshStandardMaterial color="#eceae4" roughness={0.75} />
      </mesh>
      {/* muro cortina en las 4 caras */}
      {[
        [[0, h / 2, d / 2 + 0.008], [0, 0, 0], w],
        [[0, h / 2, -d / 2 - 0.008], [0, Math.PI, 0], w],
        [[w / 2 + 0.008, h / 2, 0], [0, Math.PI / 2, 0], d],
        [[-w / 2 - 0.008, h / 2, 0], [0, -Math.PI / 2, 0], d],
      ].map(([pos, r, width], i) => (
        <mesh key={i} position={pos} rotation={r}>
          <planeGeometry args={[width * 0.94, h * 0.96]} />
          {face}
        </mesh>
      ))}
      {/* losas blancas entre pisos: el rasgo que define la referencia */}
      {Array.from({ length: floors + 1 }, (_, f) => (
        <mesh key={f} position={[0, (h / floors) * f, 0]} castShadow>
          <boxGeometry args={[w + 0.1, 0.09, d + 0.1]} />
          <meshStandardMaterial color="#f4f2ec" roughness={0.8} />
        </mesh>
      ))}
      {/* remate y antena */}
      <mesh position={[0, h + 0.09, 0]} castShadow>
        <boxGeometry args={[w + 0.16, 0.1, d + 0.16]} />
        <meshStandardMaterial color="#d8d4cb" roughness={0.7} />
      </mesh>
      {h > 3.8 && (
        <mesh position={[0, h + 0.5, 0]}>
          <cylinderGeometry args={[0.015, 0.02, 0.8, 6]} />
          <meshStandardMaterial color="#8d959c" metalness={0.7} roughness={0.3} />
        </mesh>
      )}
    </group>
  )
}

// Arbolito de acera (mismo lenguaje low-poly de la escena)
function StreetTree({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.28, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.06, 0.56, 7]} />
        <meshStandardMaterial color="#6b4a30" roughness={0.95} />
      </mesh>
      {[
        [0, 0.78, 0, 0.28],
        [0.14, 0.66, 0.06, 0.2],
        [-0.12, 0.68, -0.05, 0.18],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color={['#4a8f3c', '#5aa346', '#3f7d34'][i]} roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  )
}

function City() {
  // Manzanas en cuadrícula: las avenidas cruzan en x=0 y z=0 (semiancho 1.9),
  // así que cada bloque vive dentro de un cuadrante y NUNCA pisa la calzada.
  // El cuadrante frontal-izquierdo se deja libre: ahí está nuestro edificio.
  const { blocks, trees } = useMemo(() => {
    const AV = 1.9 // semiancho de avenida
    const b = []
    const t = []
    const quadrants = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (const [sx, sz] of quadrants) {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const cx = sx * (AV + 1.6 + i * 3.4)
          const cz = sz * (AV + 1.6 + j * 3.4)
          // el cuadrante del edificio propio (frente-izquierda cercano) libre
          if (Math.abs(cx) < 6 && cz > 0 && Math.abs(cz) < 6) continue
          const w = 1.7 + rnd() * 1.1
          const d = 1.7 + rnd() * 1.1
          const h = 2.2 + rnd() * 3.6
          b.push([cx, cz, w, d, h, 0.3 + rnd() * 0.4])
          // arbolitos en la acera que da a la avenida
          t.push([cx - sx * (w / 2 + 0.55), cz + (rnd() - 0.5) * 1.2, 0.85 + rnd() * 0.4])
          if (rnd() > 0.5) t.push([cx + (rnd() - 0.5) * 1.4, cz - sz * (d / 2 + 0.55), 0.8 + rnd() * 0.4])
        }
      }
    }
    return { blocks: b, trees: t }
  }, [])
  return (
    <group>
      {/* terreno base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.34, 0]} receiveShadow>
        <planeGeometry args={[52, 52]} />
        <meshStandardMaterial color="#6f7a6a" roughness={1} />
      </mesh>
      {/* CALZADA en cruz: asfalto oscuro con aceras claras elevadas */}
      {[
        [52, 4.6, [0, Math.PI / 2]],
        [4.6, 52, [0, 0]],
      ].map(([w, d], i) => (
        <mesh key={`road${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.325, 0]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color="#33373b" roughness={0.95} />
        </mesh>
      ))}
      {/* aceras a ambos lados de cada avenida */}
      {[
        [0, 2.55, 52, 0.5],
        [0, -2.55, 52, 0.5],
        [2.55, 0, 0.5, 52],
        [-2.55, 0, 0.5, 52],
      ].map(([x, z, w, d], i) => (
        <mesh key={`walk${i}`} position={[x, -0.29, z]} receiveShadow castShadow>
          <boxGeometry args={[w, 0.09, d]} />
          <meshStandardMaterial color="#a8a49b" roughness={1} />
        </mesh>
      ))}
      {/* línea central discontinua de cada avenida (fuera del cruce) */}
      {Array.from({ length: 22 }, (_, i) => {
        const off = 3.6 + i * 2.1
        return [off, -off].map((o) => (
          <group key={`ln${i}${o}`}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[o, -0.318, 0]}>
              <planeGeometry args={[1.1, 0.11]} />
              <meshStandardMaterial color="#e8dfc0" roughness={0.9} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.318, o]}>
              <planeGeometry args={[0.11, 1.1]} />
              <meshStandardMaterial color="#e8dfc0" roughness={0.9} />
            </mesh>
          </group>
        ))
      })}
      {/* pasos de cebra en las cuatro bocas del cruce */}
      {[
        [3.1, 0, true],
        [-3.1, 0, true],
        [0, 3.1, false],
        [0, -3.1, false],
      ].map(([x, z, vert], k) =>
        Array.from({ length: 7 }, (_, i) => {
          const o = -1.8 + i * 0.6
          return (
            <mesh
              key={`cb${k}${i}`}
              rotation={[-Math.PI / 2, 0, 0]}
              position={vert ? [x, -0.317, o] : [o, -0.317, z]}
            >
              <planeGeometry args={vert ? [0.75, 0.3] : [0.3, 0.75]} />
              <meshStandardMaterial color="#efe9da" roughness={0.9} />
            </mesh>
          )
        })
      )}
      {blocks.map((b, i) => (
        <GlassTower key={i} position={[b[0], -0.3, b[1]]} w={b[2]} d={b[3]} h={b[4]} seed={i + 3} />
      ))}
      {trees.map((t, i) => (
        <StreetTree key={i} position={[t[0], -0.3, t[1]]} scale={t[2]} />
      ))}
    </group>
  )
}

function Building({ doorOpen, tex }) {
  const left = useRef()
  const right = useRef()
  useFrame(() => {
    const a = doorOpen.current * (Math.PI / 2.2)
    if (left.current) left.current.rotation.y = MathUtils.lerp(left.current.rotation.y, -a, 0.15)
    if (right.current) right.current.rotation.y = MathUtils.lerp(right.current.rotation.y, a, 0.15)
  })
  // rejilla de ventanas cálidas de la fachada frontal (2 pisos)
  const front = []
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 4; c++) {
      const x = -0.95 + c * 0.72
      const y = 0.95 + r * 0.85
      // nada de ventanas sobre la entrada (x global entre -1.2 y 0.1, piso bajo)
      if (y < 1.6 && 0.5 + x > -1.25 && 0.5 + x < 0.2) continue
      front.push([x, y])
    }
  return (
    <group>
      {/* base: deck de madera con césped alrededor, como una maqueta */}
      <RB args={[6.4, 0.28, 5.4]} r={0.12} position={[0, -0.14, 0]} receiveShadow>
        <meshStandardMaterial color={WOOD_DARK} roughness={0.95} />
      </RB>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <planeGeometry args={[6.2, 5.2]} />
        <meshStandardMaterial color="#7ba85c" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.55, 0.012, 2.1]} receiveShadow>
        <planeGeometry args={[1.5, 1.5]} />
        <meshStandardMaterial {...tex.deck} color="#d9b98a" roughness={0.85} />
      </mesh>

      {/* CUERPO PRINCIPAL en ladrillo (la misma pared que se ve adentro) */}
      <mesh position={[0.5, 1.3, -0.4]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 2.6, 2.8]} />
        <meshStandardMaterial {...tex.brick} color="#c08a72" roughness={0.95} normalScale={[0.6, 0.6]} />
      </mesh>
      {front.map(([x, y], i) => (
        <WarmWindow key={i} position={[0.5 + x, y, 1.02]} lit={i !== 3} />
      ))}
      <WarmWindow position={[2.31, 1.35, -0.4]} rotation={[0, Math.PI / 2, 0]} w={0.6} h={0.66} />
      <WarmWindow position={[2.31, 1.35, -1.3]} rotation={[0, Math.PI / 2, 0]} w={0.6} h={0.66} lit={false} />
      {/* cornisa y zócalo de madera cálida */}
      <RB args={[3.8, 0.2, 3.0]} r={0.045} position={[0.5, 2.68, -0.4]} castShadow>
        <meshStandardMaterial color={WOOD_TRIM} roughness={0.7} />
      </RB>
      <RB args={[3.7, 0.16, 2.9]} r={0.03} position={[0.5, 0.08, -0.4]}>
        <meshStandardMaterial color={STONE} roughness={0.9} />
      </RB>

      {/* ALA IZQUIERDA más baja, también en ladrillo */}
      <mesh position={[-1.9, 0.9, -0.2]} castShadow receiveShadow>
        <boxGeometry args={[2.0, 1.8, 2.4]} />
        <meshStandardMaterial {...tex.brick} color="#b8836c" roughness={0.95} normalScale={[0.6, 0.6]} />
      </mesh>
      <WarmWindow position={[-2.4, 1.05, 1.02]} />
      <WarmWindow position={[-1.55, 1.05, 1.02]} lit={false} />
      <RB args={[2.2, 0.18, 2.6]} r={0.04} position={[-1.9, 1.88, -0.2]} castShadow>
        <meshStandardMaterial color={WOOD_TRIM} roughness={0.7} />
      </RB>

      {/* ENTRADA: el pórtico es un MARCO (dintel + jambas), no un bloque macizo
          — antes no había vano y al abrir las puertas se veía la propia fachada */}
      {[
        [[-1.175, 0.78, 1.16], [0.2, 1.56, 0.3]], // jamba izquierda
        [[0.075, 0.78, 1.16], [0.2, 1.56, 0.3]], // jamba derecha
        [[-0.55, 1.44, 1.16], [1.45, 0.24, 0.3]], // dintel
      ].map(([pos, size], i) => (
        <RB key={i} args={size} r={0.04} position={pos} castShadow>
          <meshStandardMaterial color={WOOD_TRIM} roughness={0.7} />
        </RB>
      ))}
      {/* PANEL negro que cierra el vano: es lo que se ve al abrir las hojas
          (la caja con BackSide era invisible desde fuera y dejaba ver la
          fachada de ladrillo detrás) */}
      <mesh position={[-0.55, 0.66, 1.05]}>
        <planeGeometry args={[1.12, 1.36]} />
        <meshBasicMaterial color="#04060a" />
      </mesh>
      {/* y el túnel hacia adentro envuelve a la cámara cuando cruza el panel */}
      <mesh position={[-0.55, 0.62, 0.0]}>
        <boxGeometry args={[1.06, 1.28, 2.0]} />
        <meshBasicMaterial color="#04060a" side={BackSide} />
      </mesh>
      {/* tenue luz cálida lamiendo el piso del zaguán */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.55, 0.02, 0.55]}>
        <planeGeometry args={[0.9, 0.5]} />
        <meshStandardMaterial color="#241a12" emissive="#8a5a2e" emissiveIntensity={0.3} />
      </mesh>
      {/* HOJAS: cubren el vano completo (entre jambas: 1.05 de ancho por 1.32
          de alto) — antes medían 0.6 en total y dejaban ver el fondo por los
          costados. Bisagra en cada jamba, abren hacia adentro. */}
      <group position={[-0.55, 0.66, 1.29]}>
        {[
          ['left', -0.525, left],
          ['right', 0.525, right],
        ].map(([k, hinge, ref]) => (
          <group key={k} ref={ref} position={[hinge, 0, 0]}>
            <mesh position={[hinge < 0 ? 0.2625 : -0.2625, 0, 0]} castShadow>
              <boxGeometry args={[0.525, 1.3, 0.055]} />
              <meshStandardMaterial color={WOOD_DARK} roughness={0.5} />
            </mesh>
            {/* vidrio de la hoja */}
            <mesh position={[hinge < 0 ? 0.2625 : -0.2625, 0.06, 0.035]}>
              <planeGeometry args={[0.4, 1.05]} />
              <meshStandardMaterial color="#20303c" emissive="#3a2a18" emissiveIntensity={0.35} side={DoubleSide} />
            </mesh>
            {/* manija vertical junto al borde libre */}
            <mesh position={[hinge < 0 ? 0.47 : -0.47, 0.02, 0.06]}>
              <cylinderGeometry args={[0.014, 0.014, 0.42, 8]} />
              <meshStandardMaterial color="#c9b28a" metalness={0.7} roughness={0.3} />
            </mesh>
          </group>
        ))}
      </group>
      {/* letrero iluminado sobre la puerta */}
      <RB args={[0.95, 0.17, 0.06]} r={0.03} position={[-0.55, 1.68, 1.3]}>
        <meshStandardMaterial color="#e8dcc4" emissive="#d9a86a" emissiveIntensity={0.55} />
      </RB>
      {/* apliques a los lados de la entrada (como los de adentro) */}
      {[-1.35, 0.25].map((x) => (
        <group key={x} position={[x, 1.15, 1.24]}>
          <mesh castShadow>
            <coneGeometry args={[0.08, 0.13, 12, 1, true]} />
            <meshStandardMaterial color="#1c2124" roughness={0.45} metalness={0.35} side={DoubleSide} />
          </mesh>
          <mesh position={[0, -0.05, 0]}>
            <sphereGeometry args={[0.035, 10, 10]} />
            <meshStandardMaterial color="#fff2d8" emissive="#ffc078" emissiveIntensity={2.4} />
          </mesh>
        </group>
      ))}
      <RB args={[1.5, 0.07, 0.28]} r={0.02} position={[-0.55, 0.04, 1.52]} receiveShadow>
        <meshStandardMaterial color={PATH} roughness={1} />
      </RB>

      {/* jardinería: las MISMAS plantas que decoran la oficina por dentro */}
      <group position={[-2.75, 0, 1.75]}>
        <mesh position={[0, 0.14, 0]} castShadow>
          <cylinderGeometry args={[0.17, 0.13, 0.28, 18]} />
          <meshStandardMaterial color="#f0ece4" roughness={0.85} />
        </mesh>
        <GltfProp url="/models/props/Fern.glb" position={[0, 0.27, 0]} fitHeight={0.62} />
      </group>
      {[
        [-1.85, 2.15, 0.42],
        [2.45, 1.75, 0.5],
        [2.75, 0.5, 0.36],
      ].map(([x, z, h], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.09, 0]} castShadow>
            <cylinderGeometry args={[0.11, 0.085, 0.18, 16]} />
            <meshStandardMaterial color="#f0ece4" roughness={0.85} />
          </mesh>
          <GltfProp url="/models/props/Monstera.glb" position={[0, 0.17, 0]} fitHeight={h} />
        </group>
      ))}
    </group>
  )
}

// Vuelo: arranca alto sobre la ciudad, desciende hacia el edificio y termina
// cruzando la puerta (la cámara entra: el edificio sale de cuadro y funde a
// negro). Perspectiva, no orto: la sensación de acercarse la da el encuadre.
function IntroCamera({ progress }) {
  const cam = useRef()
  // keyframes [t, posición, mirada]
  const KEYS = [
    [0.0, [13.6, 15.4, 16.6], [0, 1.2, 0]],
    [0.14, [12.4, 14.6, 15.4], [0, 1.2, 0]], // deriva suave del plano aéreo
    [0.45, [5.5, 5.6, 8.4], [-0.4, 1.2, 0.6]],
    [0.78, [-0.5, 1.15, 3.6], [-0.55, 0.72, 1.2]],
    [1.0, [-0.55, 0.66, 0.6], [-0.55, 0.62, -1.4]], // cruzando el vano
  ]
  useFrame(() => {
    const c = cam.current
    if (!c) return
    const p = Math.min(Math.max(progress.current, 0), 1)
    let i = 0
    while (i < KEYS.length - 2 && p > KEYS[i + 1][0]) i++
    const [t0, p0, l0] = KEYS[i]
    const [t1, p1, l1] = KEYS[i + 1]
    const raw = (p - t0) / (t1 - t0 || 1)
    const k = raw < 0.5 ? 2 * raw * raw : 1 - (-2 * raw + 2) ** 2 / 2 // easeInOut
    c.position.set(MathUtils.lerp(p0[0], p1[0], k), MathUtils.lerp(p0[1], p1[1], k), MathUtils.lerp(p0[2], p1[2], k))
    c.lookAt(MathUtils.lerp(l0[0], l1[0], k), MathUtils.lerp(l0[1], l1[1], k), MathUtils.lerp(l0[2], l1[2], k))
  })
  return <PerspectiveCamera ref={cam} makeDefault fov={52} position={[13, 15, 16]} near={0.05} far={200} />
}

function Scene({ doorOpen }) {
  const tex = useFacadeTextures()
  return (
    <>
      <City />
      <Building doorOpen={doorOpen} tex={tex} />
    </>
  )
}

/**
 * Intro: ~3.6s. Fases: acercarse · abrir puertas · destello → onDone().
 */
export default function Intro({ onDone, bg = '#e8b98a' }) {
  const progress = useRef(0)
  const doorOpen = useRef(0)
  const [flash, setFlash] = useState(0)
  const startedAt = useRef(performance.now())
  const done = useRef(false)

  const finish = () => {
    if (done.current) return
    done.current = true
    onDone?.()
  }

  useEffect(() => {
    let raf
    // Ritmo de la toma (en segundos):
    //  0.0-1.6  la cámara sostiene el plano aéreo de la ciudad (respira)
    //  1.6-7.0  desciende y vuela hacia el edificio, sin prisa
    //  5.6      las puertas empiezan a abrirse, ya de frente a la entrada
    //  6.6-8.0  cruza el umbral fundiendo a negro
    //  8.0-8.9  el negro se sostiene antes de entregar la oficina
    const HOLD = 1.6
    const FLIGHT = 5.4
    const tick = () => {
      const t = (performance.now() - startedAt.current) / 1000
      progress.current = t < HOLD ? 0 : Math.min((t - HOLD) / FLIGHT, 1)
      doorOpen.current = t > 5.6 ? Math.min((t - 5.6) / 1.1, 1) : 0
      if (t > 6.6) setFlash(Math.min((t - 6.6) / 1.4, 1))
      if (t > 8.9) return finish()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const esc = (e) => e.key === 'Escape' && finish()
    window.addEventListener('keydown', esc)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', esc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="intro">
      <Canvas
        shadows="soft"
        dpr={[1, 2]}
        gl={{ antialias: true, stencil: false }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping // mismo look que la sala
          gl.toneMappingExposure = 1.15
        }}
      >
        <color attach="background" args={[bg]} />
        <IntroCamera progress={progress} />
        {/* atardecer cálido: la hora a la que uno llega a la oficina */}
        <ambientLight intensity={0.75} />
        <hemisphereLight args={['#f0dcc4', '#4a3b2f', 0.7]} />
        <directionalLight
          position={[6, 7, 7]}
          intensity={2.0}
          color="#ffe6c4"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-radius={4}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
        />
        <Suspense fallback={null}>
          <Scene doorOpen={doorOpen} />
        </Suspense>
        <ContactShadows position={[0, 0.02, 0]} opacity={0.4} scale={12} blur={2.6} far={4} />
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <Bloom intensity={0.85} luminanceThreshold={0.78} luminanceSmoothing={0.5} mipmapBlur radius={0.75} />
          <Vignette offset={0.3} darkness={0.45} />
        </EffectComposer>
      </Canvas>
      <div className="intro-flash" style={{ opacity: flash }} />
      <button type="button" className="intro-skip" onClick={finish}>
        Saltar intro
      </button>
    </div>
  )
}
