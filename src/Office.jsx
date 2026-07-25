import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { MathUtils, Shape, ExtrudeGeometry, DoubleSide } from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { OrbitControls, OrthographicCamera, ContactShadows, RoundedBox, Html } from '@react-three/drei'
import GltfProp from './scene/GltfProp.jsx'
import Character3D from './scene/Character3D.jsx'

// ── Paleta calcada de la referencia ─────────────────────────────────────────
// ── Temas de la sala ─────────────────────────────────────────────────────────
export const THEMES = {
  clasico: {
    label: '🏢 Clásico',
    floor: '#c9917b', wallBack: '#3d5866', wallLeft: '#35505d', base: '#2f434e',
    desk: '#cf9b7e', matColor: '#3c6b82', bg: '#b9ccd3',
    ambient: 0.9, hemi: ['#dbe8ec', '#4a3b2f', 0.7], dir: 2.1,
  },
  noche: {
    label: '🌙 Noche',
    floor: '#5a4a44', wallBack: '#2a4058', wallLeft: '#22364a', base: '#182838',
    desk: '#6b4a3a', matColor: '#1f4650', bg: '#080d14',
    ambient: 0.4, hemi: ['#3b5566', '#1a1410', 0.45], dir: 0.9,
    lampsOn: true, // las lámparas de piso se encienden
  },
  playa: {
    label: '🏖 Playa',
    floor: '#e2c290', wallBack: '#6ba8bb', wallLeft: '#5d99ad', base: '#4a7f92',
    desk: '#c98a5a', matColor: '#d96a4f', bg: '#cfe9f0',
    ambient: 1.05, hemi: ['#eaf6fa', '#8a6a45', 0.8], dir: 2.4,
  },
  sakura: {
    label: '🌸 Sakura',
    floor: '#d9b8b0', wallBack: '#6b4d61', wallLeft: '#5d4255', base: '#4a3545',
    desk: '#c9909a', matColor: '#8a5a6e', bg: '#ecd6dc',
    ambient: 0.95, hemi: ['#f5e4ea', '#5a3b45', 0.7], dir: 2.0,
  },
}
// paleta activa (Office la fija en cada render según el tema elegido)
let T = THEMES.clasico
const METAL = '#b9c2c7'
const DARK = '#22282c'
const WHITE = '#eef2f4'
const POT = '#ece6db'
const GREEN1 = '#3a8f5f'
const GREEN2 = '#49a56d'

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

// ── Sala ─────────────────────────────────────────────────────────────────────
function Room() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM, ROOM]} />
        {mat(T.floor)}
      </mesh>
      <mesh position={[0, 1, -HALF]} receiveShadow castShadow>
        <boxGeometry args={[ROOM, 2, 0.08]} />
        {mat(T.wallBack)}
      </mesh>
      <mesh position={[-HALF, 1, 0]} receiveShadow castShadow>
        <boxGeometry args={[0.08, 2, ROOM]} />
        {mat(T.wallLeft)}
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
      {/* marco + lienzo */}
      <RB args={[0.72, 0.88, 0.05]} r={0.02} castShadow>{mat(WHITE)}</RB>
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[0.6, 0.76]} />
        {mat('#eef4f7')}
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

// Lámpara de piso: decorativa siempre; en el tema Noche emite luz cálida real.
function FloorLamp({ position, on = false }) {
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
          emissive={on ? '#ffb26b' : '#000000'}
          emissiveIntensity={on ? 1 : 0}
          side={DoubleSide}
        />
      </mesh>
      {on && <pointLight position={[0, 1.15, 0]} color="#ffb27a" intensity={9} distance={6.5} decay={1.5} castShadow={false} />}
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
          emissive={on ? '#ffb26b' : '#000000'}
          emissiveIntensity={on ? 1 : 0}
          side={DoubleSide}
        />
      </mesh>
      {on && <pointLight position={[0, 0.14, 0.28]} color="#ffcfa0" intensity={6} distance={5.5} decay={1.6} castShadow={false} />}
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

function FiddlePlant({ position, scale = 0.5 }) {
  const leaves = [
    [0.0, 1.55, 0.0, 0, 0],
    [0.28, 1.25, 0.05, 0.5, 0.4],
    [-0.26, 1.3, -0.05, -0.5, -0.4],
    [0.1, 1.0, 0.26, 0.3, 0.9],
    [-0.12, 1.05, -0.24, -0.3, -0.9],
  ]
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.34, 0.26, 0.7, 16]} />
        {mat(POT)}
      </mesh>
      <mesh position={[0, 1.05, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 0.9, 8]} />
        {mat('#6b7d4a')}
      </mesh>
      {leaves.map(([x, y, z, rz, ry], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0.2, ry, rz]} scale={[0.42, 0.6, 0.14]} castShadow>
          <sphereGeometry args={[1, 16, 16]} />
          {mat(i % 2 ? GREEN1 : GREEN2, { extra: { flatShading: true } })}
        </mesh>
      ))}
    </group>
  )
}

// Props chicos de Kenney: escritorio principal + estante + decoración de estaciones.
// Decoración pequeña de cada escritorio, ubicada sobre un BRAZO de la L (no en el
// hueco, que está vacío). El teclado y el mouse NO van aquí: se derivan del monitor
// en el render (KbMouse) para caer siempre sobre el brazo.
const PROPS = [
  // ── principal: rincón tras-izq, mira -z ──
  { url: '/models/furniture/plantSmall3.glb', position: [-3.0, TOP, -2.0] },
  { url: '/models/furniture/books.glb', position: [-3.05, TOP, -2.55], scale: 1.0 },
  // ── SLOTS[0]: rincón tras-der, mira -z ──
  { url: '/models/furniture/plantSmall1.glb', position: [3.0, TOP, -2.0] },
  { url: '/models/furniture/radio.glb', position: [3.0, TOP, -1.55] },
  // ── SLOTS[1]: rincón frontal-izq, mira -x ──
  { url: '/models/furniture/books.glb', position: [-3.0, TOP, 1.9] },
  { url: '/models/furniture/plantSmall2.glb', position: [-1.9, TOP, 2.95] },
  // ── SLOTS[2]: rincón frontal-der (isla), mira +z ──
  { url: '/models/furniture/speakerSmall.glb', position: [3.0, TOP, 1.9] },
  { url: '/models/furniture/plantSmall3.glb', position: [1.9, TOP, 2.95] },
  // ── SLOTS[3]: pared izquierda (medio, bajo ventana), mira -x ──
  { url: '/models/furniture/plantSmall2.glb', position: [-3.0, TOP, 0.4] },
  // ── SLOTS[4]: lado derecho (medio), mira +x ──
  { url: '/models/furniture/plantSmall1.glb', position: [3.0, TOP, -0.8] },
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
const YAW_FRONT = Math.PI / 4
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
const PHRASES = [
  '☕ necesito otro café',
  '🤔 mmm…',
  '🍕 ¿pedimos algo?',
  '👀 ¿vieron el deploy?',
  '🥱 qué sueño',
  '🔥 en racha hoy',
]
// frases con sabor a cada rol (se mezclan con las genéricas, con más peso)
const PHRASES_BY_ROLE = {
  dev: ['🐛 este bug no se me escapa', '⌨️ un refactor y quedo', '🚀 listo pa deployar', '✨ hoy compila a la primera'],
  research: ['📚 qué artículo tan bueno', '🔍 encontré algo interesante', '🗺️ mapeando el código…', '🧠 dato curioso…'],
  design: ['🎨 ese contraste no va', '✨ pixel perfect o nada', '🖌️ probando una paleta', '📐 4px más de padding…'],
  qa: ['🧪 eso huele a flaky', '🐞 lo voy a romper', '✅ verde, todo verde', '🚦 ¿quién probó esto?'],
  pr: ['🔎 ese diff está grande', '📝 LGTM… casi', '🧐 aquí falta un test', '🚦 aprobado con comentarios'],
  docs: ['📖 si no está documentado, no pasó', '✍️ puliendo el README', '🗒️ esto merece un ADR'],
}
const phraseFor = (id) => {
  const own = PHRASES_BY_ROLE[id] || []
  return rand([...own, ...own, ...PHRASES]) // doble peso a las del rol
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

export default function Office({ roleStates = {}, status = '', squad = [], deliverTargets = {}, theme = 'clasico', tool = null, onTourDone, onPickMember }) {
  T = THEMES[theme] || THEMES.clasico // fija la paleta antes de renderizar los hijos
  const main = squad[0] // miembro principal (escritorio grande)
  const devState = (main && roleStates[main.id]) || 'idle'

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
    const iv = setInterval(() => {
      squad.forEach((m, idx) => {
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
              text: '🗣️ ¿cómo vas?',
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
  }, [squad, roleStates])

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
    : devState === 'delivering'
      ? deliverTour(CHAIR_POS, main.id, [-0.6, -0.6])
      : devState === 'idle'
        ? ambient[main.id]?.tour || null
        : null

  return (
    <Canvas shadows dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={[T.bg]} />

      <OrthographicCamera makeDefault position={[11, 9.5, 11]} zoom={80} near={0.1} far={100} />
      <OrbitControls target={[0, 0.35, 0]} enablePan={false} minZoom={45} maxZoom={280} />

      <ambientLight intensity={T.ambient} />
      <hemisphereLight args={T.hemi} />
      <directionalLight
        position={[5, 9, 5]}
        intensity={T.dir}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-camera-near={0.1}
        shadow-camera-far={25}
      />

      <Room />
      <Window />
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
      {/* plantas en los pasillos frente/fondo (verificado: fuera de las huellas) */}
      <FiddlePlant position={[0.6, 0, -HALF + 0.45]} scale={0.4} />
      <FiddlePlant position={[0, 0, HALF - 0.45]} scale={0.46} />
      <FiddlePlant position={[-0.7, 0, -HALF + 0.45]} scale={0.38} />
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
      {/* lamparita de escritorio del principal (en la esquina de su L, NO frente al monitor) */}
      <DeskLamp position={[-3.02, TOP, -2.95]} rotation={[0, -Math.PI / 4, 0]} on={!!T.lampsOn} />

      <Suspense fallback={null}>
        <FlutterFrame position={[-0.7, 1.35, -HALF + 0.07]} />
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
              {devState === 'idle' && ambient[main.id]?.text && (
                <Html position={[0, 4.0, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                  <div className="bubble3d">{ambient[main.id].text}</div>
                </Html>
              )}
            </Character3D>
          </>
        )}

        {/* squad: research / design / qa — cada uno con su L y su monitor */}
        {SLOTS.map((s, i) => {
          const m = squad[i + 1] // ocupante del puesto (o vacío)
          const st = (m && roleStates[m.id]) || 'idle'
          const amb = m ? ambient[m.id] : null
          const yawScreen = Math.atan2(s.monitor[0] - s.chair[0], s.monitor[2] - s.chair[2])
          const bubble =
            st === 'working'
              ? `${m.emoji} ${tool?.role === m.id && tool.detail ? String(tool.detail).slice(0, 30) : 'trabajando…'}`
              : st === 'listening'
                ? '👂 escuchando…'
                : st === 'talking'
                  ? '💬'
                  : st === 'delivering'
                    ? `${m.emoji} ¡listo!`
                    : amb?.text || null
          const busyBubble = st !== 'idle'
          // tour activo del ocupante (entrega/paseo/visita), una sola vez
          const slotTour = !m
            ? null
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
                  {bubble && (
                    <Html position={[0, 4.0, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                      <div className={busyBubble ? 'bubble3d busy' : 'bubble3d'}>{bubble}</div>
                    </Html>
                  )}
                </Character3D>
              )}
            </group>
          )
        })}
      </Suspense>

      {/* globo del principal: solo mientras tiene una conversación activa */}
      {status && devState !== 'idle' && devState !== 'delivering' && (
        <Html position={[CHAIR_POS[0], 1.06, CHAIR_POS[2]]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
          <div className="bubble3d busy">{status}</div>
        </Html>
      )}

      <ContactShadows position={[0, 0.004, 0]} opacity={0.4} scale={9} blur={2.5} far={3} />
    </Canvas>
  )
}
