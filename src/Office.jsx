import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { MathUtils, Shape, ExtrudeGeometry, DoubleSide, TextureLoader, RepeatWrapping, ACESFilmicToneMapping, Vector3 } from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { OrbitControls, OrthographicCamera, ContactShadows, RoundedBox, Html } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, DepthOfField } from '@react-three/postprocessing'
import GltfProp from './scene/GltfProp.jsx'
import Character3D from './scene/Character3D.jsx'
import Pet from './scene/Pet.jsx'

// ── Paleta calcada de la referencia ─────────────────────────────────────────
// ── Temas de la sala ─────────────────────────────────────────────────────────
import { t, tl } from './lib/i18n.js'
import { fpsEscena, tickerActivo } from './lib/helpers.js'

export const THEMES = {
  clasico: {
    get label() { return t('theme.clasico') },
    floor: '#e6c6a4', wallBack: '#c08a72', wallLeft: '#e8e2d8', base: '#8a6a52',
    desk: '#cf9b7e', matColor: '#3c6b82', bg: '#b9ccd3',
    ambient: 0.9, hemi: ['#dbe8ec', '#4a3b2f', 0.7], dir: 2.1,
  },
  noche: {
    get label() { return t('theme.noche') },
    floor: '#8a7060', wallBack: '#6e5048', wallLeft: '#3a4a58', base: '#2a2018',
    desk: '#6b4a3a', matColor: '#1f4650', bg: '#080d14',
    ambient: 0.4, hemi: ['#3b5566', '#1a1410', 0.45], dir: 0.9,
    lampsOn: true, // las lámparas de piso se encienden
  },
  playa: {
    get label() { return t('theme.playa') },
    floor: '#f2dcbe', wallBack: '#e0b8a2', wallLeft: '#9fd0dc', base: '#b08a68',
    desk: '#c98a5a', matColor: '#d96a4f', bg: '#cfe9f0',
    ambient: 1.05, hemi: ['#eaf6fa', '#8a6a45', 0.8], dir: 2.4,
  },
  sakura: {
    get label() { return t('theme.sakura') },
    floor: '#e8cfc6', wallBack: '#c0909a', wallLeft: '#e6d2da', base: '#8a6270',
    desk: '#c9909a', matColor: '#8a5a6e', bg: '#ecd6dc',
    ambient: 0.95, hemi: ['#f5e4ea', '#5a3b45', 0.7], dir: 2.0,
    fall: 'petalos', // pétalos de cerezo cayendo 🌸
  },
  otono: {
    get label() { return t('theme.otono') },
    floor: '#d9ab7a', wallBack: '#b87a52', wallLeft: '#d8c4a8', base: '#7a4f30',
    desk: '#b8794a', matColor: '#8a5a2e', bg: '#d9b98a',
    ambient: 0.85, hemi: ['#f5dcb4', '#6b4520', 0.75], dir: 1.9,
    fall: 'hojas', // hojas secas planeando 🍂
  },
  invierno: {
    get label() { return t('theme.invierno') },
    floor: '#c8cfd6', wallBack: '#9fb0bd', wallLeft: '#dde6ec', base: '#5c6a76',
    desk: '#a8b4bd', matColor: '#6b8296', bg: '#dfeaf2',
    ambient: 1.0, hemi: ['#eaf4fb', '#54636e', 0.85], dir: 2.2,
    fall: 'nieve', // nevada suave ❄️
    lampsOn: true, // las lámparas encendidas dan calidez al frío
  },
}
// paleta activa (Office la fija en cada render según el tema elegido)
let T = THEMES.clasico
const METAL = '#b9c2c7'
const DARK = '#22282c'
const WHITE = '#eef2f4'

const DESK_H = 0.38
const TOP = DESK_H + 0.025
const ROOM = 7.0 // piso ROOM x ROOM, paredes en ±ROOM/2 (sala amplia para 6 puestos)
const HALF = ROOM / 2

const mat = (color, opts = {}) => (
  <meshStandardMaterial color={color} roughness={opts.rough ?? 0.8} metalness={opts.metal ?? 0} {...opts.extra} />
)

function RB({ args, r = 0.02, children, ...props }) {
  const radius = Math.max(Math.min(r, Math.min(...args) / 2 - 0.001), 0.004)
  return (
    <RoundedBox args={args} radius={radius} smoothness={3} {...props}>
      {children}
    </RoundedBox>
  )
}

// ── Materiales con textura (glow-up #111): ladrillo en la pared del fondo y
// madera en el piso, tintados con el color del tema para que Noche/Playa/Sakura
// mantengan su identidad. Los mapas son CC0 de ambientCG, 512px (~235KB total).
function useRoomTextures() {
  const [brickC, brickN, brickR, woodC, woodN, woodR] = useLoader(TextureLoader, [
    '/textures/brick-color.jpg',
    '/textures/brick-normal.jpg',
    '/textures/brick-rough.jpg',
    '/textures/wood-color.jpg',
    '/textures/wood-normal.jpg',
    '/textures/wood-rough.jpg',
  ])
  return useMemo(() => {
    const tile = (tex, x, y) => {
      const c = tex.clone()
      c.wrapS = c.wrapT = RepeatWrapping
      c.repeat.set(x, y)
      c.needsUpdate = true
      return c
    }
    return {
      brick: { map: tile(brickC, 4, 1.2), normalMap: tile(brickN, 4, 1.2), roughnessMap: tile(brickR, 4, 1.2) },
      wood: { map: tile(woodC, 3, 3), normalMap: tile(woodN, 3, 3), roughnessMap: tile(woodR, 3, 3) },
    }
  }, [brickC, brickN, brickR, woodC, woodN, woodR])
}

// ── Sala ─────────────────────────────────────────────────────────────────────
function Room() {
  const tex = useRoomTextures()
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM, ROOM]} />
        <meshStandardMaterial {...tex.wood} color={T.floor} roughness={0.72} />
      </mesh>
      <mesh position={[0, 1, -HALF]} receiveShadow castShadow>
        <boxGeometry args={[ROOM, 2, 0.08]} />
        <meshStandardMaterial {...tex.brick} color={T.wallBack} roughness={0.95} normalScale={[0.7, 0.7]} />
      </mesh>
      <mesh position={[-HALF, 1, 0]} receiveShadow castShadow>
        <boxGeometry args={[0.08, 2, ROOM]} />
        {mat(T.wallLeft, { rough: 0.9 })}
      </mesh>
      <mesh position={[0, 0.05, -HALF + 0.05]}>
        <boxGeometry args={[ROOM, 0.1, 0.03]} />
        {mat(T.base)}
      </mesh>
      <mesh position={[-HALF + 0.05, 0.05, 0]}>
        <boxGeometry args={[0.03, 0.1, ROOM]} />
        {mat(T.base)}
      </mesh>
    </group>
  )
}

function Window() {
  return (
    <group position={[-HALF + 0.04, 1.3, 0]} rotation={[0, Math.PI / 2, 0]}>
      <RB args={[1.05, 1.15, 0.08]} r={0.03} castShadow>{mat(WHITE)}</RB>
      <mesh position={[0, 0, 0.045]}>
        <planeGeometry args={[0.85, 0.95]} />
        <meshStandardMaterial color="#eaf6fa" emissive="#eaf6fa" emissiveIntensity={0.55} />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[0.87, 0.05, 0.02]} />
        {mat(WHITE)}
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[0.05, 0.97, 0.02]} />
        {mat(WHITE)}
      </mesh>
    </group>
  )
}

// ── Cuadro de Flutter: carga el SVG oficial y lo pinta tal cual ─────────────
function FlutterFrame({ position, rotation = [0, 0, 0] }) {
  const { paths } = useLoader(SVGLoader, '/flutter-logo.svg')
  // viewBox del SVG: .29 .22 77.26 95.75 → centro (38.92, 48.1)
  const s = 0.0062
  return (
    <group position={position} rotation={rotation}>
      {/* marco de madera oscura + lienzo mate: no debe florecer con el bloom
          ni quemarse con la luz de ventana (si no, no se ve el logo) */}
      <RB args={[0.72, 0.88, 0.05]} r={0.02} castShadow>{mat('#3a2c22', { rough: 0.85 })}</RB>
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[0.6, 0.76]} />
        {mat('#b9bfc4', { rough: 1 })}
      </mesh>
      {/* logo real, centrado y plano contra el lienzo (Y del SVG va hacia abajo → se voltea) */}
      <group position={[-38.92 * s, 48.1 * s, 0.03]} scale={[s, -s, 1]}>
        {paths.map((p, i) =>
          SVGLoader.createShapes(p).map((shape, j) => {
            const opacity = p.userData.style.fillOpacity ?? 1
            return (
              <mesh key={`${i}-${j}`} position={[0, 0, i * 0.0015]}>
                <shapeGeometry args={[shape]} />
                <meshStandardMaterial
                  color={p.userData.style.fill}
                  transparent={opacity < 1}
                  opacity={opacity}
                  roughness={0.6}
                  side={DoubleSide}
                />
              </mesh>
            )
          })
        )}
      </group>
    </group>
  )
}

// Partículas de estación: pétalos de cerezo 🌸, hojas secas 🍂 o nieve ❄️.
// Cada tipo cae y ondea distinto — la nieve baja recta y lenta, las hojas
// planean girando, los pétalos revolotean. Instanciado simple, sin costo real.
const FALL_KINDS = {
  petalos: {
    count: 46,
    colors: ['#f8c2d8', '#fbe0ea', '#f4aecb'],
    size: [0.035, 0.022],
    sides: 5,
    fall: [0.12, 0.18],
    sway: [0.15, 0.35],
    spin: [0.4, 1.4],
  },
  hojas: {
    count: 34,
    colors: ['#c9762f', '#a8531f', '#d9a441', '#8a4a22'],
    size: [0.055, 0.032],
    sides: 4,
    fall: [0.16, 0.22],
    sway: [0.25, 0.5], // planean más que los pétalos
    spin: [0.8, 2.2],
  },
  nieve: {
    count: 90,
    colors: ['#ffffff', '#eef6ff', '#dceaf7'],
    size: [0.018, 0.018],
    sides: 6,
    fall: [0.08, 0.14], // lenta y recta
    sway: [0.04, 0.12],
    spin: [0.1, 0.4],
  },
}

function Falling({ kind = 'petalos' }) {
  const cfg = FALL_KINDS[kind] || FALL_KINDS.petalos
  const ref = useRef()
  const seeds = useMemo(
    () =>
      Array.from({ length: cfg.count }, () => ({
        x: (Math.random() - 0.5) * ROOM * 0.95,
        z: (Math.random() - 0.5) * ROOM * 0.95,
        y: Math.random() * 2.2,
        spin: cfg.spin[0] + Math.random() * (cfg.spin[1] - cfg.spin[0]),
        fall: cfg.fall[0] + Math.random() * (cfg.fall[1] - cfg.fall[0]),
        sway: cfg.sway[0] + Math.random() * (cfg.sway[1] - cfg.sway[0]),
        phase: Math.random() * Math.PI * 2,
        color: cfg.colors[Math.floor(Math.random() * cfg.colors.length)],
      })),
    [cfg]
  )
  useFrame((state, dt) => {
    const g = ref.current
    if (!g) return
    const time = state.clock.elapsedTime
    g.children.forEach((p, i) => {
      const s = seeds[i]
      p.position.y -= s.fall * dt
      if (p.position.y < 0.02) p.position.y = 2.3
      p.position.x = s.x + Math.sin(time * 0.6 + s.phase) * s.sway
      p.position.z = s.z + Math.cos(time * 0.45 + s.phase) * s.sway * 0.6
      p.rotation.z = time * s.spin
      p.rotation.x = Math.sin(time * 0.8 + s.phase) * (kind === 'nieve' ? 0.15 : 0.7)
    })
  })
  return (
    <group ref={ref}>
      {seeds.map((s, i) => (
        <mesh key={i} position={[s.x, s.y, s.z]} scale={[cfg.size[0], cfg.size[1], 1]}>
          <circleGeometry args={[1, cfg.sides]} />
          <meshStandardMaterial
            color={s.color}
            side={DoubleSide}
            roughness={0.9}
            emissive={kind === 'nieve' ? '#cfe4f5' : '#000000'}
            emissiveIntensity={kind === 'nieve' ? 0.35 : 0}
            transparent
            opacity={0.92}
          />
        </mesh>
      ))}
    </group>
  )
}

// Spot de riel colgante (glow-up #111): los focos negros de la referencia loft,
// suspendidos del techo apuntando a la pared de ladrillo. Emiten luz cálida.
function TrackSpot({ position, on = false }) {
  return (
    <group position={position}>
      {/* varilla al techo */}
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.84, 6]} />
        {mat(DARK)}
      </mesh>
      {/* campana */}
      <mesh position={[0, 0, 0]} castShadow>
        <coneGeometry args={[0.11, 0.17, 16, 1, true]} />
        <meshStandardMaterial color="#1c2124" roughness={0.45} metalness={0.35} side={DoubleSide} />
      </mesh>
      {/* bombillo: brilla siempre un poco, fuerte de noche */}
      <mesh position={[0, -0.07, 0]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color="#fff2d8" emissive="#ffc078" emissiveIntensity={on ? 2.6 : 1.1} />
      </mesh>
      {on && <pointLight position={[0, -0.12, 0]} color="#ffc98a" intensity={7} distance={4.5} decay={1.7} castShadow={false} />}
    </group>
  )
}

// Lámpara de piso: decorativa siempre; en el tema Noche emite luz cálida real.
function FloorLamp({ position, on = false }) {
  // siempre encendidas: en temas claros la luz es tenue (se nota el brillo del
  // bombillo sin lavar la escena), de noche alumbran de verdad
  return (
    <group position={position}>
      <mesh position={[0, 0.03, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.16, 0.06, 12]} />
        {mat(DARK)}
      </mesh>
      <mesh position={[0, 0.58, 0]} castShadow>
        <cylinderGeometry args={[0.022, 0.022, 1.1, 8]} />
        {mat(METAL, { metal: 0.6, rough: 0.35 })}
      </mesh>
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.2, 0.26, 14, 1, true]} />
        <meshStandardMaterial
          color="#e8dcc8"
          emissive="#ffb26b"
          emissiveIntensity={on ? 1 : 0.35}
          side={DoubleSide}
        />
      </mesh>
      <pointLight position={[0, 1.15, 0]} color="#ffb27a" intensity={on ? 9 : 2.2} distance={on ? 6.5 : 4} decay={1.6} castShadow={false} />
    </group>
  )
}

// Aplique de pared (sconce): va montado alto en la pared, no ocupa piso. Ideal
// para las paredes que los escritorios tapan. Ilumina en Noche.
function WallSconce({ position, rotation = [0, 0, 0], on = false }) {
  return (
    <group position={position} rotation={rotation}>
      {/* placa contra la pared */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.1, 0.22, 0.05]} />
        {mat(DARK)}
      </mesh>
      {/* pantalla (semicono abierto hacia arriba/afuera) */}
      <mesh position={[0, 0.13, 0.09]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.1, 0.17, 14, 1, true]} />
        <meshStandardMaterial
          color="#e8dcc8"
          emissive="#ffb26b"
          emissiveIntensity={on ? 1 : 0.3}
          side={DoubleSide}
        />
      </mesh>
      <pointLight position={[0, 0.14, 0.28]} color="#ffcfa0" intensity={on ? 6 : 1.6} distance={on ? 5.5 : 3.5} decay={1.7} castShadow={false} />
    </group>
  )
}

// Lamparita de escritorio articulada (luz suave y puntual en Noche).
function DeskLamp({ position, rotation = [0, 0, 0], on = false }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow position={[0, 0.015, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.03, 10]} />
        {mat(DARK)}
      </mesh>
      <mesh castShadow position={[0.035, 0.1, 0]} rotation={[0, 0, -0.5]}>
        <cylinderGeometry args={[0.01, 0.01, 0.18, 6]} />
        {mat(METAL, { metal: 0.6, rough: 0.35 })}
      </mesh>
      <mesh castShadow position={[0.1, 0.17, 0]} rotation={[0, 0, 0.9]}>
        <coneGeometry args={[0.045, 0.07, 10, 1, true]} />
        <meshStandardMaterial
          color="#d8ccb8"
          emissive={on ? '#ffc27f' : '#000000'}
          emissiveIntensity={on ? 1.1 : 0}
          side={DoubleSide}
        />
      </mesh>
      {on && <pointLight position={[0.11, 0.13, 0]} color="#ffc27f" intensity={1.2} distance={1.8} decay={1.9} />}
    </group>
  )
}

// ── Escritorio en L genérico ─────────────────────────────────────────────────
// Superficie de UNA sola pieza (polígono en L extruido con bisel), no dos
// tablones cruzados. Esquina del L en el origen local; alas hacia +z y +x.
const L_TOP_GEOM = (() => {
  const W = 0.275 // media anchura del ala
  const LEN = 1.7 // largo de cada ala
  const s = new Shape()
  s.moveTo(-W, -W)
  s.lineTo(LEN, -W)
  s.lineTo(LEN, W)
  s.lineTo(W, W)
  s.lineTo(W, LEN)
  s.lineTo(-W, LEN)
  s.closePath()
  return new ExtrudeGeometry(s, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 2,
  })
})()

function LDesk({ position, rotation = [0, 0, 0] }) {
  const legs = [
    [0.15, 1.58],
    [1.58, 0.15],
    [0.18, 0.18],
  ]
  return (
    <group position={position} rotation={rotation}>
      {/* tabla en L continua (el shape XY se acuesta al plano XZ) */}
      <mesh geometry={L_TOP_GEOM} position={[0, DESK_H + 0.028, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        {mat(T.desk)}
      </mesh>
      {legs.map(([x, z], i) => (
        <RB key={i} args={[0.05, DESK_H, 0.05]} r={0.015} position={[x, DESK_H / 2, z]} castShadow>
          {mat(METAL, { metal: 0.5, rough: 0.4 })}
        </RB>
      ))}
    </group>
  )
}

// Monitor estilo iMac. Mientras su estación trabaja, la pantalla "late".
function Monitor({ working = false, position, rotation = [0, 0, 0] }) {
  const screen = useRef()
  useFrame(({ clock }) => {
    if (!screen.current) return
    screen.current.emissiveIntensity = working
      ? 0.55 + Math.sin(clock.elapsedTime * 3.2) * 0.3
      : 0.35
  })
  return (
    <group position={position} rotation={rotation}>
      <RB args={[0.16, 0.015, 0.12]} r={0.006} position={[0, 0.008, 0.03]} castShadow>{mat(METAL, { metal: 0.5 })}</RB>
      <RB args={[0.035, 0.16, 0.025]} r={0.01} position={[0, 0.09, 0.01]} castShadow>{mat(METAL, { metal: 0.5 })}</RB>
      <RB args={[0.5, 0.32, 0.03]} r={0.012} position={[0, 0.26, 0]} castShadow>{mat('#c9d2d6', { metal: 0.3 })}</RB>
      <mesh position={[0, 0.265, 0.017]}>
        <planeGeometry args={[0.45, 0.27]} />
        <meshStandardMaterial ref={screen} color="#171e24" emissive="#2dd4bf" emissiveIntensity={0.35} roughness={0.3} />
      </mesh>
    </group>
  )
}

function Laptop({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      <RB args={[0.3, 0.018, 0.2]} r={0.008} castShadow>{mat('#aab4b9', { metal: 0.6, rough: 0.35 })}</RB>
      <group position={[0, 0.1, -0.095]} rotation={[-0.4, 0, 0]}>
        <RB args={[0.3, 0.2, 0.012]} r={0.008} castShadow>{mat('#aab4b9', { metal: 0.6, rough: 0.35 })}</RB>
        <mesh position={[0, 0, 0.008]}>
          <planeGeometry args={[0.26, 0.16]} />
          <meshStandardMaterial color="#171e24" emissive="#1d3a44" emissiveIntensity={0.3} />
        </mesh>
      </group>
    </group>
  )
}

// Silla ergonómica blanca con base de 5 ruedas.
function Chair({ position, rotation }) {
  return (
    <group position={position} rotation={rotation}>
      <RB args={[0.34, 0.05, 0.32]} r={0.02} position={[0, 0.225, 0]} castShadow>{mat(WHITE, { rough: 0.5 })}</RB>
      <RB args={[0.32, 0.4, 0.05]} r={0.02} position={[0, 0.47, -0.155]} rotation={[-0.06, 0, 0]} castShadow>
        {mat(WHITE, { rough: 0.5 })}
      </RB>
      {[-0.185, 0.185].map((x) => (
        <RB key={x} args={[0.04, 0.05, 0.2]} r={0.012} position={[x, 0.31, 0]} castShadow>{mat('#cfd6da')}</RB>
      ))}
      <mesh position={[0, 0.115, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.17, 10]} />
        {mat(METAL, { metal: 0.6, rough: 0.3 })}
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i} rotation={[0, (i * Math.PI * 2) / 5, 0]}>
          <RB args={[0.035, 0.02, 0.17]} r={0.008} position={[0, 0.03, 0.09]} castShadow>
            {mat(METAL, { metal: 0.5 })}
          </RB>
          <mesh position={[0, 0.028, 0.17]} castShadow>
            <sphereGeometry args={[0.028, 10, 10]} />
            {mat(DARK)}
          </mesh>
        </group>
      ))}
    </group>
  )
}

// Estante flotante con cuadro y libros (pared del fondo).
function Shelf() {
  return (
    <group position={[1.3, 1.3, -HALF + 0.12]}>
      <RB args={[1.25, 0.05, 0.28]} r={0.015} castShadow receiveShadow>{mat(T.desk)}</RB>
      <group position={[-0.38, 0.21, -0.02]} rotation={[0.08, 0, 0]}>
        <RB args={[0.28, 0.36, 0.03]} r={0.01} castShadow>{mat('#e3e8ea')}</RB>
        <mesh position={[0, 0, 0.017]}>
          <planeGeometry args={[0.2, 0.28]} />
          {mat('#9fb7c4')}
        </mesh>
      </group>
      {[
        ['#3b62a8', 0.28, 0.05],
        ['#e8edf0', 0.24, 0.14],
        ['#4550a8', 0.26, 0.22],
      ].map(([c, h, x]) => (
        <RB key={c} args={[0.055, h, 0.18]} r={0.01} position={[x, h / 2 + 0.025, 0]} castShadow>{mat(c)}</RB>
      ))}
    </group>
  )
}

// Planta de piso con hojas de verdad (glow-up #111): monstera de Quaternius
// en maceta blanca hecha en código — como la referencia loft.
function FloorPlant({ position, height = 0.55, rotation = 0 }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.11, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.13, 0.1, 0.22, 20]} />
        {mat('#f0ece4')}
      </mesh>
      <GltfProp url="/models/props/Monstera.glb" position={[0, 0.2, 0]} fitHeight={height} />
    </group>
  )
}

// Árbol protagonista de la referencia: helecho frondoso texturizado (Quaternius)
// plantado alto en una maceta blanca — el punto verde grande del loft.
function PottedTree({ position, height = 1.15 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.17, 0.13, 0.32, 20]} />
        {mat('#f0ece4')}
      </mesh>
      {/* tronco corto hasta el follaje */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.05, 0.45, 10]} />
        {mat('#7a5c3e')}
      </mesh>
      <GltfProp url="/models/props/Fern.glb" position={[0, 0.62, 0]} fitHeight={height * 0.55} />
    </group>
  )
}

// Props chicos de Kenney: escritorio principal + estante + decoración de estaciones.
// Decoración pequeña de cada escritorio, ubicada sobre un BRAZO de la L (no en el
// hueco, que está vacío). El teclado y el mouse NO van aquí: se derivan del monitor
// en el render (KbMouse) para caer siempre sobre el brazo.
const PROPS = [
  // ── principal: rincón tras-izq, mira -z ──
  { url: '/models/props/PottedPlant.glb', position: [-3.0, TOP, -2.0], fitHeight: 0.4 },
  { url: '/models/furniture/books.glb', position: [-3.05, TOP, -2.55], scale: 1.0 },
  // ── SLOTS[0]: rincón tras-der, mira -z ──
  { url: '/models/props/HousePlant.glb', position: [3.0, TOP, -2.0], fitHeight: 0.42 },
  { url: '/models/furniture/radio.glb', position: [3.0, TOP, -1.55] },
  // ── SLOTS[1]: rincón frontal-izq, mira -x ──
  { url: '/models/furniture/books.glb', position: [-3.0, TOP, 1.9] },
  { url: '/models/props/PottedPlant.glb', position: [-1.9, TOP, 2.95], fitHeight: 0.4 },
  // ── SLOTS[2]: rincón frontal-der (isla), mira +z ──
  { url: '/models/furniture/speakerSmall.glb', position: [3.0, TOP, 1.9] },
  { url: '/models/props/HousePlant.glb', position: [1.9, TOP, 2.95], fitHeight: 0.42 },
  // ── SLOTS[3]: pared izquierda (medio, bajo ventana), mira -x ──
  { url: '/models/props/Monstera.glb', position: [-3.0, TOP, 0.4], fitHeight: 0.36 },
  // ── SLOTS[4]: lado derecho (medio), mira +x ──
  { url: '/models/props/Monstera.glb', position: [3.0, TOP, -0.8], fitHeight: 0.36 },
]

// Teclado + mouse derivados del monitor: se apoyan sobre el brazo de la L (media
// anchura 0.275), a un pasito del monitor hacia la silla. Garantiza que no floten.
function KbMouse({ monitor, chair }) {
  const [mx, , mz] = monitor
  const [cx, , cz] = chair
  const dx = cx - mx
  const dz = cz - mz
  const len = Math.hypot(dx, dz) || 1
  const ux = dx / len
  const uz = dz / len // dirección hacia la silla
  const FWD = 0.28 // avance sobre el brazo (≤0.31 para no salirse)
  const LAT = 0.24 // separación lateral teclado↔mouse
  const rot = [0, Math.atan2(ux, uz), 0]
  const kb = [mx + ux * FWD, TOP, mz + uz * FWD]
  const ms = [kb[0] - uz * LAT, TOP, kb[2] + ux * LAT]
  return (
    <>
      <GltfProp url="/models/furniture/computerKeyboard.glb" position={kb} rotation={rot} />
      <GltfProp url="/models/furniture/computerMouse.glb" position={ms} rotation={rot} />
    </>
  )
}

// ── Estación principal (dev) ────────────────────────────────────────────────
// Puesto en la esquina trasera-izquierda, mirando -z (la pantalla contra la pared).
// La L del escritorio (origen = esquina interior, brazos ~1.58) cubre x[-3.18,-1.6] z[-3.18,-1.6].
const CHAIR_POS = [-2.3, 0, -2.4]
const MONITOR_POS = [-2.3, 0, -3.22]
const YAW_DESK = Math.atan2(MONITOR_POS[0] - CHAIR_POS[0], MONITOR_POS[2] - CHAIR_POS[2])

// ── Puestos de trabajo (geometría fija). Quién los ocupa viene del squad ⚙️ ──
// Cada puesto tiene su L en una esquina, monitor en diagonal y punto de entrega.
// Igual que el principal: monitor recto SOBRE un ala de la L (no en diagonal)
// y la silla de frente a esa ala.
// 5 puestos secundarios (el principal va aparte): 4 esquinas + 2 medios (izq/der).
// El centro y el frente quedan libres para caminar/reunirse. WALL = borde interior.
// Cada escritorio (L de brazos ~1.58, origen = esquina interior) queda co-ubicado
// con su monitor y su silla: no flotan.
const WALL = HALF - 0.28
const SLOTS = [
  {
    // esquina trasera-derecha: mira -z (pantalla contra la pared del fondo)
    desk: [HALF - 0.32, 0, -HALF + 0.32],
    deskRot: [0, -Math.PI / 2, 0], // cubre x[1.6,3.18] z[-3.18,-1.6]
    monitor: [2.3, TOP, -WALL],
    monitorRot: [0, 0, 0],
    chair: [2.3, 0, -2.4],
    mat: { position: [2.3, 0.012, -2.35], args: [1.05, 0.02, 0.95] },
    deliver: [0.6, -1.3], // camina hacia el principal para entregar
  },
  {
    // esquina frontal-izquierda: mira -x (pantalla contra la pared izquierda)
    desk: [-HALF + 0.32, 0, HALF - 0.32],
    deskRot: [0, Math.PI / 2, 0], // cubre x[-3.18,-1.6] z[1.6,3.18]
    monitor: [-WALL, TOP, 2.3],
    monitorRot: [0, Math.PI / 2, 0],
    chair: [-2.4, 0, 2.3],
    mat: { position: [-2.35, 0.012, 2.3], args: [0.95, 0.02, 1.05] },
    deliver: [-1.3, 0.6],
  },
  {
    // esquina frontal-derecha (isla): mira +z (borde abierto del frente)
    desk: [HALF - 0.32, 0, HALF - 0.32],
    deskRot: [0, Math.PI, 0], // cubre x[1.6,3.18] z[1.6,3.18]
    monitor: [2.3, TOP, WALL],
    monitorRot: [0, Math.PI, 0],
    chair: [2.3, 0, 2.4],
    mat: { position: [2.3, 0.012, 2.35], args: [1.05, 0.02, 0.95] },
    deliver: [1.3, 0.6],
  },
  {
    // pared izquierda (medio, bajo la ventana): mira -x
    desk: [-HALF + 0.32, 0, 0.6],
    deskRot: [0, Math.PI / 2, 0], // cubre x[-3.18,-1.6] z[-0.98,0.6]
    monitor: [-WALL, TOP, -0.2],
    monitorRot: [0, Math.PI / 2, 0],
    chair: [-2.4, 0, -0.2],
    mat: { position: [-2.35, 0.012, -0.2], args: [0.95, 0.02, 1.05] },
    deliver: [-1.3, -0.3],
  },
  {
    // lado derecho (medio, borde abierto +x): mira +x
    desk: [HALF - 0.32, 0, -1.0],
    deskRot: [0, -Math.PI / 2, 0], // cubre x[1.6,3.18] z[-1.0,0.58]
    monitor: [WALL, TOP, -0.2],
    monitorRot: [0, -Math.PI / 2, 0],
    chair: [2.4, 0, -0.2],
    mat: { position: [2.35, 0.012, -0.2], args: [0.95, 0.02, 1.05] },
    deliver: [1.3, -0.3],
  },
]

// ── Detección de obstáculos al caminar (zonas prohibidas = escritorios) ──────
// AABB (con margen) de cada escritorio en L. La caja local del top de la L es
// [-0.275, 1.7] en x y z; con deskRot múltiplo de 90° la AABB sigue alineada.
const DESK_MARGIN = 0.35
function deskAABB([dx, , dz], rot) {
  const W = 0.275
  const LEN = 1.7
  const q = ((Math.round((rot?.[1] ?? 0) / (Math.PI / 2)) % 4) + 4) % 4 // 0=0°,1=90°,2=180°,3=270°
  let xr, zr
  if (q === 0) { xr = [-W, LEN]; zr = [-W, LEN] }
  else if (q === 1) { xr = [-W, LEN]; zr = [-LEN, W] }
  else if (q === 2) { xr = [-LEN, W]; zr = [-LEN, W] }
  else { xr = [-LEN, W]; zr = [-W, LEN] }
  return { x0: dx + xr[0] - DESK_MARGIN, x1: dx + xr[1] + DESK_MARGIN, z0: dz + zr[0] - DESK_MARGIN, z1: dz + zr[1] + DESK_MARGIN }
}
const DESK_ZONES = [
  deskAABB([-HALF + 0.32, 0, -HALF + 0.32], [0, 0, 0]), // principal
  ...SLOTS.map((s) => deskAABB(s.desk, s.deskRot)),
]
const zoneHas = (z, [x, zz]) => x >= z.x0 && x <= z.x1 && zz >= z.z0 && zz <= z.z1
// ¿el segmento a→b corta el rectángulo z? (recorte de Liang–Barsky)
function segHitsZone([ax, az], [bx, bz], z) {
  const dx = bx - ax
  const dz = bz - az
  let t0 = 0
  let t1 = 1
  const edges = [[-dx, ax - z.x0], [dx, z.x1 - ax], [-dz, az - z.z0], [dz, z.z1 - az]]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return t0 <= t1
}
// ¿el tramo a→b está libre? (puede atravesar el escritorio propio del origen o
// del destino, pero no un tercero en medio)
function segClear(a, b) {
  return !DESK_ZONES.some((z) => !zoneHas(z, a) && !zoneHas(z, b) && segHitsZone(a, b, z))
}
// Nodos "de pasillo" en la zona abierta: centro + corredores frente/fondo. Los
// laterales quedan tapados por los escritorios medios, así que se rodea por aquí.
const NAV_NODES = [
  [0, 0],
  [0, -1.35],
  [0, 1.35],
  [1.05, 0],
  [-1.05, 0],
]
// Waypoints para ir de `from` a `to` esquivando escritorios. Si la recta está
// libre → null (va directo). Si no, BFS sobre los nodos de pasillo para hallar el
// camino con menos saltos; devuelve los nodos intermedios (o [centro] de respaldo).
// Camino SIN cruzar escritorios: [] si la recta ya está libre, array de waypoints
// si el BFS encuentra ruta por los pasillos, o null si NO hay forma sin cruzar.
function navPath(from, to) {
  if (segClear(from, to)) return []
  const nodes = [from, ...NAV_NODES, to]
  const N = nodes.length
  const TARGET = N - 1
  const prev = new Array(N).fill(-1)
  const seen = new Array(N).fill(false)
  const queue = [0]
  seen[0] = true
  while (queue.length) {
    const u = queue.shift()
    if (u === TARGET) break
    for (let v = 0; v < N; v++) {
      if (!seen[v] && segClear(nodes[u], nodes[v])) {
        seen[v] = true
        prev[v] = u
        queue.push(v)
      }
    }
  }
  if (!seen[TARGET]) return null
  const path = []
  for (let at = prev[TARGET]; at > 0; at = prev[at]) path.unshift(nodes[at])
  return path
}
// ¿existe una ruta sin cruzar escritorios entre `from` y `to`?
const isReachable = (from, to) => navPath(from, to) !== null
// Waypoints para el tour. Si no hay ruta limpia (entrega obligatoria), va por el
// centro como último recurso. Devuelve null cuando la recta ya está libre.
function routeVia(from, to) {
  const p = navPath(from, to)
  if (p === null) return [[0, 0]]
  return p.length ? p : null
}

// ── Vida ambiental: mientras nadie trabaja, la oficina respira ───────────────
// genéricas + las de cada rol viven en el diccionario (#103), así la oficina
// también murmura en el idioma elegido
const phraseFor = (id) => {
  const own = tl(id)
  return rand([...own, ...own, ...tl('phrases')]) // doble peso a las del rol
}
// Puntos de paseo en el centro abierto de la sala (lejos de los escritorios,
// que ocupan la periferia) para que la vida ambiental no atraviese los muebles.
const WANDER_SPOTS = [
  { to: [0.2, 0.2], text: '💭' },
  { to: [1.1, -0.5], text: '🌿' },
  { to: [-1.1, 0.3], text: '🪟' },
  { to: [0.4, 1.2], text: '🚶' },
  { to: [-0.5, -0.3], text: '💬' },
]
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)]

// Con frameloop='demand' nada avanza solo: este ticker marca el ritmo. Se usa
// para todo lo que no sea trabajo en curso — en reposo a 30fps, y detrás de otra
// app a 4, solo hasta que el paseo que quedaba a medias termine.
//
// Ojo: NO confiar en que Chromium frene esto. Lo hacía con las ventanas ocultas
// (~1/s), pero `backgroundThrottling: false` en electron/main.js —necesario para
// que la escena no se congele en background— quita ese freno. El ritmo de aquí
// es el único que hay.
function DemandTicker({ fps = 30 }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const iv = setInterval(invalidate, 1000 / fps)
    return () => clearInterval(iv)
  }, [invalidate, fps])
  return null
}

// Grupo silla+personaje que gira suavemente hacia el yaw objetivo.
function Turn({ position, yaw, children }) {
  const ref = useRef()
  useFrame((_, dt) => {
    if (!ref.current) return
    ref.current.rotation.y = MathUtils.damp(ref.current.rotation.y, yaw, 3.5, dt)
  })
  return (
    <group ref={ref} position={position} rotation={[0, yaw, 0]}>
      {children}
    </group>
  )
}

// listening/talking → te mira (cámara); idle/working → mira su pantalla.
const YAW_CAMERA = Math.PI / 4
const yawFor = (state, yawScreen) => (state === 'listening' || state === 'talking' ? YAW_CAMERA : yawScreen)

// Checklist del agente (TodoWrite) junto al personaje mientras trabaja.
const todoIcon = (s) => (s === 'completed' ? '✅' : s === 'in_progress' ? '▶️' : '⬜')
function TodoCard({ items }) {
  const done = items.filter((it) => it.status === 'completed').length
  // la actual + vecinas: la lista completa no cabe junto al personaje
  const cur = Math.max(items.findIndex((it) => it.status !== 'completed'), 0)
  const shown = items.slice(Math.max(0, Math.min(cur - 1, items.length - 3)), Math.max(0, Math.min(cur - 1, items.length - 3)) + 3)
  return (
    <div className="todo-card">
      <div className="todo-head">📝 {done}/{items.length}</div>
      {shown.map((it, i) => (
        <div key={i} className={`todo-row ${it.status}`}>
          {todoIcon(it.status)} {it.text.length > 30 ? it.text.slice(0, 28) + '…' : it.text}
        </div>
      ))}
    </div>
  )
}

// Modo director (#98): la cámara hace paneo suave hacia quien está trabajando
// (y al centro cuando hay standup). Tocar los controles lo pausa unos segundos.
function Director({ controls, target, enabled }) {
  const pausedUntil = useRef(0)
  useEffect(() => {
    const ctl = controls.current
    if (!ctl) return
    const onStart = () => (pausedUntil.current = performance.now() + 6000)
    ctl.addEventListener('start', onStart)
    return () => ctl.removeEventListener('start', onStart)
  }, [controls])
  useFrame(() => {
    const ctl = controls.current
    if (!ctl || !enabled || !target || performance.now() < pausedUntil.current) return
    ctl.target.lerp(target, 0.035) // suave: nada de tirones
    ctl.update()
  })
  return null
}

// Ayudante temporal: aparece junto al escritorio cuando el agente delega
// trabajo a un subagente (tool Task). Parado entre la silla y el centro,
// mirando a su "jefe".
function HelperGhost({ chair }) {
  const dx = -chair[0]
  const dz = -chair[2]
  const len = Math.hypot(dx, dz) || 1
  const pos = [chair[0] + (dx / len) * 0.62, 0, chair[2] + (dz / len) * 0.62]
  const yaw = Math.atan2(chair[0] - pos[0], chair[2] - pos[2])
  return (
    <group position={pos} rotation={[0, yaw, 0]}>
      <GltfProp url="/models/pj/BaseCharacter.gltf" scale={0.19} />
      <Html position={[0, 0.62, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
        <div className="helper-tag">🤖 ayudante</div>
      </Html>
    </group>
  )
}

export default function Office({ roleStates = {}, status = '', squad = [], deliverTargets = {}, theme = 'clasico', tool = null, elapsed = {}, queued = {}, todos = {}, standup = [], subagents = [], pet = '', petHeight = 0.55, quality = 'normal', director = false, onTourDone, onPickMember }) {
  // Accesibilidad (#104): con «reducir movimiento» activo en el sistema, la
  // escena se queda quieta — nada de paseos, visitas, mascota ni partículas.
  // El trabajo real (entregas, estados) sigue viéndose.
  const reduceMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  T = THEMES[theme] || THEMES.clasico // fija la paleta antes de renderizar los hijos
  const main = squad[0] // miembro principal (escritorio grande)
  const devState = (main && roleStates[main.id]) || 'idle'

  // Ahorro de GPU/batería por VISIBILIDAD, no por foco: con varias pantallas
  // la ventana puede verse perfectamente sin tener el foco, y ahí debe seguir
  // a 60fps. document.visibilityState pasa a 'hidden' solo cuando la ventana
  // está minimizada o completamente tapada — recién entonces el render pasa a
  // 'demand', con un ticker que deja terminar los tours en curso (para que
  // nada quede a mitad de caminata ni salte el watchdog de entregas).
  // Cuenta como "en pausa" tanto la ventana oculta como la que está detrás de
  // otra app: ahí nadie mira la escena y el proceso ya no la frena solo (ver
  // backgroundThrottling: false en electron/main.js), así que la frenamos aquí.
  const enPausa = () => document.visibilityState === 'hidden' || !document.hasFocus()
  const [visible, setVisible] = useState(() => !enPausa())
  useEffect(() => {
    const onVis = () => setVisible(!enPausa())
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [])

  // silla de un miembro (para entregas dirigidas y visitas)
  const chairFor = (id) => {
    if (main && id === main.id) return CHAIR_POS
    const idx = squad.findIndex((m) => m?.id === id)
    return idx > 0 ? SLOTS[idx - 1]?.chair : null
  }
  // punto de pie junto a una silla (un pasito hacia el centro de la sala)
  const standNear = (chair) => {
    const len = Math.hypot(chair[0], chair[2]) || 1
    return [chair[0] - (chair[0] / len) * 0.6, chair[2] - (chair[2] / len) * 0.6]
  }

  // ── vida ambiental: {roleId: {kind, text?, tour?}} solo mientras están libres ──
  const [ambient, setAmbient] = useState({})
  const ambientRef = useRef(ambient)
  useEffect(() => {
    ambientRef.current = ambient
  }, [ambient])
  const timers = useRef({})
  const clearAmbient = (id) => {
    clearTimeout(timers.current[id])
    setAmbient((a) => {
      if (!a[id]) return a
      const copy = { ...a }
      delete copy[id]
      return copy
    })
  }

  // al recibir trabajo, se cancela lo que estuvieran haciendo (vuelven al puesto)
  useEffect(() => {
    for (const id of Object.keys(ambientRef.current)) {
      if (roleStates[id]) clearAmbient(id)
    }
  }, [roleStates])

  useEffect(() => {
    if (reduceMotion) return // sin vida ambiental si el sistema pide quietud
    const iv = setInterval(() => {
      // Nadie mirando: no programar frases ni paseos nuevos. Cuenta también la
      // ventana que está detrás de otra app, no solo la minimizada — si no, la
      // vida ambiental se agenda sola para siempre y el ticker de fondo nunca
      // llega a apagarse.
      if (enPausa()) return
      squad.forEach((m) => {
        if (!m || roleStates[m.id] || ambientRef.current[m.id]) return
        if (Math.random() > 0.4) return // ratos de calma
        const roll = Math.random()
        if (roll < 0.3) {
          // frase casual (con sabor al rol)
          setAmbient((a) => ({ ...a, [m.id]: { kind: 'phrase', text: phraseFor(m.id) } }))
          timers.current[m.id] = setTimeout(() => clearAmbient(m.id), 3800)
        } else if (roll < 0.55) {
          // escuchar música (con meneo)
          setAmbient((a) => ({ ...a, [m.id]: { kind: 'music', text: '🎧 ♪ ♫' } }))
          timers.current[m.id] = setTimeout(() => clearAmbient(m.id), 8000)
        } else if (roll < 0.8) {
          // paseo por la oficina (todos, el capitán incluido)
          const spot = rand(WANDER_SPOTS)
          const to = [spot.to[0] + (Math.random() - 0.5) * 0.3, spot.to[1] + (Math.random() - 0.5) * 0.3]
          setAmbient((a) => ({
            ...a,
            [m.id]: {
              kind: 'wander',
              text: spot.text,
              tour: { via: routeVia(standNear(chairFor(m.id)), to), to, pose: 'Idle', pauseMs: 2500 + Math.random() * 2500, onDone: () => clearAmbient(m.id) },
            },
          }))
        } else {
          // visita social: caminar al puesto de un compañero libre, pero SOLO si
          // se puede llegar sin cruzar escritorios (los laterales quedan tapados).
          const fromPt = standNear(chairFor(m.id))
          const hosts = squad.filter(
            (o) =>
              o &&
              o.id !== m.id &&
              !roleStates[o.id] &&
              !ambientRef.current[o.id]?.tour &&
              isReachable(fromPt, standNear(chairFor(o.id))),
          )
          const host = hosts.length ? rand(hosts) : null
          const chair = host && chairFor(host.id)
          if (!chair) return
          clearAmbient(host.id)
          setAmbient((a) => ({
            ...a,
            [m.id]: {
              kind: 'visit',
              text: t('scene.howsItGoing'),
              tour: {
                // si el camino recto cruza un escritorio, desvía por el centro
                via: routeVia(standNear(chairFor(m.id)), standNear(chair)),
                to: standNear(chair),
                face: [chair[0], chair[2]],
                pose: 'Idle',
                pauseMs: 3500 + Math.random() * 1500,
                onDone: () => clearAmbient(m.id),
              },
            },
            [host.id]: { kind: 'phrase', text: '👋' },
          }))
          timers.current[host.id] = setTimeout(() => clearAmbient(host.id), 6500)
        }
      })
    }, 5000)
    return () => clearInterval(iv)
  }, [squad, roleStates, reduceMotion])

  // ── Standup visual: los participantes se reúnen en círculo en el centro ──
  const MEET_CENTER = [0, 0.15]
  const meetTour = (id, chair) => {
    const group = squad.filter((m) => standup.includes(m.id))
    const k = Math.max(group.findIndex((m) => m.id === id), 0)
    const ang = (k / Math.max(group.length, 1)) * Math.PI * 2
    const to = [MEET_CENTER[0] + 0.85 * Math.sin(ang), MEET_CENTER[1] + 0.85 * Math.cos(ang)]
    // pauseMs larguísimo: se quedan de pie hasta que su reporte termina (el
    // cambio de estado les quita el tour y vuelven solos a su silla)
    return { via: routeVia(standNear(chair), to), to, face: MEET_CENTER, pose: 'Idle', pauseMs: 600000 }
  }
  const inStandup = (id, st) => standup.includes(id) && (st === 'listening' || st === 'working' || st === 'talking')

  // Construye el tour de ENTREGA (con desvío por el centro si hace falta).
  const deliverTour = (chair, id, fbTo, fbFace) => {
    const tc = deliverTargets[id] ? chairFor(deliverTargets[id]) : null
    return tc
      ? { via: routeVia(standNear(chair), standNear(tc)), to: standNear(tc), face: [tc[0], tc[2]], onDone: () => onTourDone?.(id) }
      : { via: routeVia(standNear(chair), fbTo), to: fbTo, face: fbFace, onDone: () => onTourDone?.(id) }
  }
  // Tour activo del principal (una sola vez), usado por Character3D (que además
  // secuencia la silla: gira antes de pararse y a la pantalla al sentarse).
  const mainTour = !main
    ? null
    : inStandup(main.id, devState)
      ? meetTour(main.id, CHAIR_POS)
      : devState === 'delivering'
        ? deliverTour(CHAIR_POS, main.id, [-0.6, -0.6])
        : devState === 'idle'
          ? ambient[main.id]?.tour || null
          : null

  // Modo director: a quién sigue la cámara — el círculo del standup, o el
  // último agente que se puso a trabajar (su silla).
  const camTarget = useMemo(() => {
    if (!director) return null
    if (standup.length) return new Vector3(0, 0.9, 0.15)
    const activo = squad.find((m) => m && ['working', 'listening', 'talking'].includes(roleStates[m.id]))
    if (!activo) return new Vector3(0, 0.35, 0) // sin trabajo: encuadre general
    const c = activo.id === squad[0]?.id ? CHAIR_POS : SLOTS[squad.findIndex((m) => m?.id === activo.id) - 1]?.chair
    return c ? new Vector3(c[0] * 0.75, 0.8, c[2] * 0.75) : null
  }, [director, standup, squad, roleStates])

  // ¿hay movimiento en curso? (agentes activos o paseos de la vida ambiental)
  // Oculta, la escena solo sigue pintando para que eso termine limpio.
  const anyMotion = Object.keys(roleStates).length > 0 || Object.values(ambient).some((a) => a && a.tour)

  // Ritmo de la escena: ver fpsEscena en lib/helpers.js. A ritmo de pantalla
  // costaba dos tercios de un núcleo con la app quieta, que en un M3 sin
  // ventilador es medio equipo por mirar una oficina en la que no pasa nada.
  const trabajando = Object.keys(roleStates).length > 0
  const fps = fpsEscena({ visible, trabajando })
  const conTicker = tickerActivo({ visible, trabajando, hayMovimiento: anyMotion })

  // ── Cámara persistente: zoom/ángulo se guardan al soltar el control y se
  // restauran al arrancar; doble-click en la escena vuelve al encuadre default.
  const controlsRef = useRef()
  const CAM_DEFAULT = { pos: [11, 9.5, 11], zoom: 80, target: [0, 0.35, 0] }
  const saveCamera = () => {
    const ctl = controlsRef.current
    if (!ctl) return
    try {
      localStorage.setItem(
        'oficina-camera',
        JSON.stringify({ pos: ctl.object.position.toArray(), zoom: ctl.object.zoom, target: ctl.target.toArray() })
      )
    } catch {}
  }
  const applyCamera = (c) => {
    const ctl = controlsRef.current
    if (!ctl || !c) return
    ctl.object.position.set(...c.pos)
    ctl.object.zoom = c.zoom
    ctl.object.updateProjectionMatrix()
    ctl.target.set(...c.target)
    ctl.update()
  }
  useEffect(() => {
    let saved = null
    try {
      saved = JSON.parse(localStorage.getItem('oficina-camera'))
    } catch {}
    if (!saved) return
    // los controles montan dentro del Canvas (async): reintenta hasta verlos
    let tries = 0
    const iv = setInterval(() => {
      if (controlsRef.current) {
        applyCamera(saved)
        clearInterval(iv)
      } else if (++tries > 20) clearInterval(iv)
    }, 100)
    return () => clearInterval(iv)
  }, [])
  const resetCamera = () => {
    applyCamera(CAM_DEFAULT)
    try {
      localStorage.removeItem('oficina-camera')
    } catch {}
  }

  return (
    <div style={{ width: '100%', height: '100%' }} onDoubleClick={resetCamera} title="Doble click: restablecer cámara">
    <Canvas
      shadows={quality === 'ligera' ? true : 'soft'}
      dpr={[1, quality === 'ligera' ? 1.5 : 2]}
      frameloop={visible && trabajando ? 'always' : 'demand'}
      gl={{ antialias: true, stencil: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping // look de película
        gl.toneMappingExposure = 1.15
      }}
      style={{ width: '100%', height: '100%' }}
    >
      {conTicker && <DemandTicker fps={fps} />}
      <color attach="background" args={[T.bg]} />

      <OrthographicCamera makeDefault position={[11, 9.5, 11]} zoom={80} near={0.1} far={100} />
      <Director controls={controlsRef} target={camTarget} enabled={director && !reduceMotion} />
      <OrbitControls ref={controlsRef} target={[0, 0.35, 0]} enablePan={false} minZoom={45} maxZoom={280} onEnd={saveCamera} />

      <ambientLight intensity={T.ambient} />
      <hemisphereLight args={T.hemi} />
      <directionalLight
        position={[5, 9, 5]}
        intensity={T.dir}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-radius={4}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-camera-near={0.1}
        shadow-camera-far={25}
      />
      {/* luz de ventana (glow-up #111): haz cálido que entra por la izquierda,
          como en la referencia loft — da dirección y contraste a la sala */}
      <spotLight
        position={[-HALF - 1.2, 2.6, 0]}
        target-position={[1.2, 0.15, 0.9]}
        angle={0.85}
        penumbra={0.9}
        intensity={T.lampsOn ? 5 : 17}
        color={T.lampsOn ? '#8aa8c8' : '#fff0d8'}
        distance={16}
        decay={1.1}
        castShadow={false}
      />
      {/* rebote cálido del piso de madera: sube el tono general sin aplanar */}
      <pointLight position={[0, 0.5, 1.2]} intensity={T.lampsOn ? 2 : 4} color="#ffd9b0" distance={9} decay={1.8} />

      <Room />
      <Window />
      {T.fall && !reduceMotion && <Falling kind={T.fall} />}
      <Shelf />

      {/* estación principal (dev): L en la esquina trasera-izquierda */}
      <LDesk position={[-HALF + 0.32, 0, -HALF + 0.32]} />
      <Monitor working={devState === 'working'} position={MONITOR_POS.map((v, i) => (i === 1 ? TOP : v))} />
      {/* laptop en el ala izquierda del escritorio principal */}
      <Laptop position={[-WALL + 0.2, TOP, -1.9]} rotation={[0, Math.PI / 2, 0]} />
      {/* gabinete y archivadores contra la pared trasera (hueco central) */}
      <RB args={[0.35, 0.3, 0.42]} r={0.02} position={[-0.9, 0.15, -HALF + 0.32]} castShadow>{mat(DARK)}</RB>
      {['#3a4750', '#51616c', '#2e3a42'].map((c, i) => (
        <RB key={c} args={[0.05, 0.26, 0.18]} r={0.012} position={[-2.7 + i * 0.07, 0.13, -HALF + 0.32]} castShadow>
          {mat(c)}
        </RB>
      ))}
      {/* alfombra del principal (bajo su silla) */}
      <RB args={[1.05, 0.02, 0.95]} r={0.03} position={[-2.3, 0.012, -2.35]} receiveShadow>{mat(T.matColor)}</RB>
      {/* plantas en los pasillos frente/fondo (verificado: fuera de las huellas):
          hojas de verdad (glow-up #111) — el árbol frondoso es el protagonista */}
      <FloorPlant position={[0.6, 0, -HALF + 0.45]} height={0.5} rotation={0.7} />
      <PottedTree position={[0, 0, HALF - 0.45]} height={1.15} />
      <FloorPlant position={[-0.7, 0, -HALF + 0.45]} height={0.44} rotation={-1.9} />
      {/* lámparas de piso grandes en los extremos de la franja central, pegadas a
          la pared del fondo y al borde frontal (los lados los ocupan los escritorios) */}
      <FloorLamp position={[-1.1, 0, -HALF + 0.45]} on={!!T.lampsOn} />
      <FloorLamp position={[1.1, 0, -HALF + 0.45]} on={!!T.lampsOn} />
      <FloorLamp position={[-1.1, 0, HALF - 0.45]} on={!!T.lampsOn} />
      <FloorLamp position={[1.1, 0, HALF - 0.45]} on={!!T.lampsOn} />
      {/* apliques de pared (altos, sobre los escritorios): iluminan las paredes
          del fondo e izquierda que los escritorios tapan a nivel de piso */}
      <WallSconce position={[-1.9, 1.7, -HALF + 0.06]} on={!!T.lampsOn} />
      <WallSconce position={[1.9, 1.7, -HALF + 0.06]} on={!!T.lampsOn} />
      <WallSconce position={[-HALF + 0.06, 1.7, -1.9]} rotation={[0, Math.PI / 2, 0]} on={!!T.lampsOn} />
      <WallSconce position={[-HALF + 0.06, 1.7, 1.9]} rotation={[0, Math.PI / 2, 0]} on={!!T.lampsOn} />
      {/* spots de riel colgantes sobre la pared de ladrillo (referencia loft) */}
      <TrackSpot position={[-1.0, 1.92, -HALF + 0.55]} on={!!T.lampsOn} />
      <TrackSpot position={[0.6, 1.92, -HALF + 0.55]} on={!!T.lampsOn} />
      <TrackSpot position={[2.2, 1.92, -HALF + 0.55]} on={!!T.lampsOn} />
      {/* lamparita de escritorio del principal (en la esquina de su L, NO frente al monitor) */}
      <DeskLamp position={[-3.02, TOP, -2.95]} rotation={[0, -Math.PI / 4, 0]} on={!!T.lampsOn} />

      <Suspense fallback={null}>
        <FlutterFrame position={[0, 1.32, -HALF + 0.07]} />
        {/* teclado+mouse del principal (dentro de Suspense: carga modelos) */}
        <KbMouse monitor={MONITOR_POS} chair={CHAIR_POS} />
        {PROPS.map((p, i) => (
          <GltfProp key={i} {...p} />
        ))}

        {main && (
          <>
            {/* la silla ahora la renderiza Character3D (secuenciada con pararse/
                sentarse); el personaje camina, la silla se queda en el puesto */}
            <Character3D
              key={`${main.id}-${main.url}`}
              url={main.url}
              clip="SitDown"
              once
              scale={0.27}
              position={CHAIR_POS}
              rotation={[0, YAW_DESK, 0]}
              yaw={yawFor(devState, YAW_DESK)}
              sitAt={[CHAIR_POS[0], 0.3, CHAIR_POS[2]]}
              colors={{ ...(main.human !== false ? { Skin: '#e8b890' } : {}), Face: main.hair, Hair: main.hair, Shirt: main.color }}
              sway={devState === 'working' || (devState === 'idle' && ambient[main.id]?.kind === 'music')}
              tour={mainTour}
              seat={<Chair position={[0, 0, 0]} rotation={[0, 0, 0]} />}
              onSelect={onPickMember ? () => onPickMember(main.id) : null}
            >
              <Html position={[0, 3.1, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                <div className="nametag" style={{ borderColor: main.color }}>{main.name}</div>
              </Html>
              {queued[main.id] > 0 && (
                <Html position={[0, 2.55, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                  <div className="queue-badge">⏳ {queued[main.id]}</div>
                </Html>
              )}
              {devState === 'working' && todos[main.id]?.length > 0 && (
                <Html position={[1.15, 2.2, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                  <TodoCard items={todos[main.id]} />
                </Html>
              )}
              {devState === 'idle' && ambient[main.id]?.text && (
                <Html position={[0, 4.0, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                  <div className="bubble3d">{ambient[main.id].text}</div>
                </Html>
              )}
            </Character3D>
            {devState === 'working' && subagents.includes(main.id) && <HelperGhost chair={CHAIR_POS} />}
          </>
        )}

        {/* mascota de la oficina 🦊 (preferencia) — pasea por el centro libre */}
        {pet && !reduceMotion && (
          <Pet url={`/models/pets/${pet}.glb`} spots={WANDER_SPOTS.map((s) => s.to)} standup={standup.length > 0} height={petHeight} />
        )}

        {/* squad: research / design / qa — cada uno con su L y su monitor */}
        {SLOTS.map((s, i) => {
          const m = squad[i + 1] // ocupante del puesto (o vacío)
          const st = (m && roleStates[m.id]) || 'idle'
          const amb = m ? ambient[m.id] : null
          const yawScreen = Math.atan2(s.monitor[0] - s.chair[0], s.monitor[2] - s.chair[2])
          const bubble = m && inStandup(m.id, st)
            ? `📋 ${m.emoji} ${t('scene.inStandup')}`
            : st === 'working'
              ? `${m.emoji} ${tool?.role === m.id && tool.detail ? String(tool.detail).slice(0, 30) : t('scene.working')}${elapsed[m.id] ? ` · ${elapsed[m.id]}` : ''}`
              : st === 'listening'
                ? t('scene.listening')
                : st === 'talking'
                  ? '💬'
                  : st === 'delivering'
                    ? `${m.emoji} ${t('scene.ready')}`
                    : amb?.text || null
          const busyBubble = st !== 'idle'
          // tour activo del ocupante (standup/entrega/paseo/visita), una sola vez
          const slotTour = !m
            ? null
            : inStandup(m.id, st)
              ? meetTour(m.id, s.chair)
              : st === 'delivering'
                ? deliverTour(s.chair, m.id, s.deliver, [CHAIR_POS[0], CHAIR_POS[2]])
                : st === 'idle'
                  ? amb?.tour || null
                  : null
          return (
            <group key={i}>
              <LDesk position={s.desk} rotation={s.deskRot} />
              <RB args={s.mat.args} r={0.03} position={s.mat.position} receiveShadow>{mat(T.matColor)}</RB>
              <Monitor working={st === 'working'} position={s.monitor} rotation={s.monitorRot} />
              <KbMouse monitor={s.monitor} chair={s.chair} />
              {/* puesto vacío: silla estática mirando la pantalla. Ocupado: la
                  silla la renderiza Character3D (secuenciada con pararse/sentarse) */}
              {!m && (
                <Turn position={s.chair} yaw={yawScreen}>
                  <Chair position={[0, 0, 0]} rotation={[0, 0, 0]} />
                </Turn>
              )}
              {m && (
                <Character3D
                  key={`${m.id}-${m.url}`}
                  url={m.url}
                  clip="SitDown"
                  once
                  scale={0.27}
                  position={s.chair}
                  rotation={[0, yawScreen, 0]}
                  yaw={yawFor(st, yawScreen)}
                  sitAt={[s.chair[0], 0.3, s.chair[2]]}
                  colors={{ ...(m.human !== false ? { Skin: '#e8b890' } : {}), Face: m.hair, Hair: m.hair, Shirt: m.color }}
                  sway={st === 'working' || (st === 'idle' && amb?.kind === 'music')}
                  tour={slotTour}
                  seat={<Chair position={[0, 0, 0]} rotation={[0, 0, 0]} />}
                  onSelect={onPickMember ? () => onPickMember(m.id) : null}
                >
                  <Html position={[0, 3.1, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                    <div className="nametag" style={{ borderColor: m.color }}>{m.name}</div>
                  </Html>
                  {queued[m.id] > 0 && (
                    <Html position={[0, 2.55, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                      <div className="queue-badge">⏳ {queued[m.id]}</div>
                    </Html>
                  )}
                  {st === 'working' && todos[m.id]?.length > 0 && (
                    <Html position={[1.15, 2.2, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                      <TodoCard items={todos[m.id]} />
                    </Html>
                  )}
                  {bubble && (
                    <Html position={[0, 4.0, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                      <div className={busyBubble ? 'bubble3d busy' : 'bubble3d'}>{bubble}</div>
                    </Html>
                  )}
                </Character3D>
              )}
              {m && st === 'working' && subagents.includes(m.id) && <HelperGhost chair={s.chair} />}
            </group>
          )
        })}
      </Suspense>

      {/* globo del principal: solo mientras tiene una conversación activa */}
      {status && devState !== 'idle' && devState !== 'delivering' && (
        <Html position={[CHAIR_POS[0], 1.06, CHAIR_POS[2]]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
          <div className="bubble3d busy">
            {status}
            {main && elapsed[main.id] ? ` · ${elapsed[main.id]}` : ''}
          </div>
        </Html>
      )}

      

      <ContactShadows position={[0, 0.004, 0]} opacity={0.4} scale={9} blur={2.5} far={3} />

      {/* Acabado de cámara (glow-up #111): bloom en lámparas y pantallas,
          tilt-shift para el efecto maqueta, viñeta y antialiasing. En calidad
          «ligera» se apaga entero; oculta la ventana tampoco se compone. */}
      {/* `enabled` en vez de desmontarlo con `visible`.
          Desmontar el compositor tira sus render targets —varios buffers a
          pantalla completa más la cadena de mipmaps del bloom— y volver a
          montarlo crea otros. Con la ventana ocultándose y volviendo decenas de
          veces al día, eso deja memoria de GPU por el camino: se midió 1,1 GB en
          `IOAccelerator` repartidos en 1.512 regiones tras seis horas de uso.
          Apagado no compone nada, que era todo el ahorro que se buscaba. */}
      {quality !== 'ligera' && (
        <EffectComposer multisampling={0} enableNormalPass={false} enabled={visible}>
          <Bloom intensity={quality === 'cine' ? 0.75 : 0.45} luminanceThreshold={0.82} luminanceSmoothing={0.5} mipmapBlur radius={0.72} />
          {/* tilt-shift: efecto maqueta, solo en calidad Cine */}
          {quality === 'cine' && <DepthOfField focusDistance={0.015} focalLength={0.05} bokehScale={2.6} height={480} />}
          <Vignette offset={0.3} darkness={0.4} />
        </EffectComposer>
      )}
    </Canvas>
    </div>
  )
}
