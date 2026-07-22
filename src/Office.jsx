import { Suspense, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { MathUtils } from 'three'
import { OrbitControls, OrthographicCamera, ContactShadows, RoundedBox, Html } from '@react-three/drei'
import GltfProp from './scene/GltfProp.jsx'
import Character3D from './scene/Character3D.jsx'

// ── Paleta calcada de la referencia ─────────────────────────────────────────
const FLOOR = '#c9917b' // piso rosado-terracota
const WALL_BACK = '#3d5866' // azul acero oscuro
const WALL_LEFT = '#35505d'
const BASE = '#2f434e'
const DESK = '#cf9b7e' // madera rosada del escritorio
const METAL = '#b9c2c7'
const DARK = '#22282c'
const WHITE = '#eef2f4'
const MAT_BLUE = '#3c6b82' // tapete azul bajo la silla
const POT = '#ece6db'
const GREEN1 = '#3a8f5f'
const GREEN2 = '#49a56d'

const DESK_H = 0.38 // altura de la superficie del escritorio
const TOP = DESK_H + 0.025 // cara superior de la tabla

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
        <planeGeometry args={[3.6, 3.6]} />
        {mat(FLOOR)}
      </mesh>
      <mesh position={[0, 0.9, -1.8]} receiveShadow castShadow>
        <boxGeometry args={[3.6, 1.8, 0.08]} />
        {mat(WALL_BACK)}
      </mesh>
      <mesh position={[-1.8, 0.9, 0]} receiveShadow castShadow>
        <boxGeometry args={[0.08, 1.8, 3.6]} />
        {mat(WALL_LEFT)}
      </mesh>
      <mesh position={[0, 0.05, -1.75]}>
        <boxGeometry args={[3.6, 0.1, 0.03]} />
        {mat(BASE)}
      </mesh>
      <mesh position={[-1.75, 0.05, 0]}>
        <boxGeometry args={[0.03, 0.1, 3.6]} />
        {mat(BASE)}
      </mesh>
    </group>
  )
}

// Ventana en la pared IZQUIERDA (como la referencia), sobre el ala del escritorio.
function Window() {
  return (
    <group position={[-1.75, 1.25, -0.85]} rotation={[0, Math.PI / 2, 0]}>
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

// ── Escritorio en L (ancho, color propio) ────────────────────────────────────
function DeskL() {
  const legs = [
    [-1.19, -0.05],
    [0.13, -1.19],
    [-1.19, -1.19],
  ]
  return (
    <group>
      {/* ala contra la pared izquierda */}
      <RB args={[0.55, 0.05, 1.7]} r={0.02} position={[-1.42, DESK_H, -0.85]} castShadow receiveShadow>
        {mat(DESK)}
      </RB>
      {/* ala contra la pared del fondo */}
      <RB args={[1.9, 0.05, 0.55]} r={0.02} position={[-0.75, DESK_H, -1.42]} castShadow receiveShadow>
        {mat(DESK)}
      </RB>
      {legs.map(([x, z], i) => (
        <RB key={i} args={[0.05, DESK_H, 0.05]} r={0.015} position={[x, DESK_H / 2, z]} castShadow>
          {mat(METAL, { metal: 0.5, rough: 0.4 })}
        </RB>
      ))}
      {/* caja oscura bajo el ala del fondo (como la referencia) */}
      <RB args={[0.35, 0.3, 0.42]} r={0.02} position={[0.0, 0.15, -1.42]} castShadow>{mat(DARK)}</RB>
      {/* archivadores bajo el ala izquierda */}
      {['#3a4750', '#51616c', '#2e3a42'].map((c, i) => (
        <RB key={c} args={[0.05, 0.26, 0.18]} r={0.012} position={[-1.32 + i * 0.07, 0.13, -0.25]} castShadow>
          {mat(c)}
        </RB>
      ))}
    </group>
  )
}

// Monitor estilo iMac (oscuro). Mientras Claude trabaja, la pantalla "late".
function Monitor({ working = false }) {
  const screen = useRef()
  useFrame(({ clock }) => {
    if (!screen.current) return
    screen.current.emissiveIntensity = working
      ? 0.55 + Math.sin(clock.elapsedTime * 3.2) * 0.3
      : 0.35
  })
  return (
    <group position={[-0.55, TOP, -1.48]}>
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

// Laptop abierta sobre el ala izquierda, mirando hacia la sala.
function Laptop() {
  return (
    <group position={[-1.42, TOP, -0.5]} rotation={[0, Math.PI / 2, 0]}>
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

// Silla ergonómica blanca con base de 5 ruedas (como la referencia).
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

// Estante flotante con cuadro y libros (pared del fondo, lado derecho).
function Shelf() {
  return (
    <group position={[0.75, 1.2, -1.68]}>
      <RB args={[1.25, 0.05, 0.28]} r={0.015} castShadow receiveShadow>{mat(DESK)}</RB>
      {/* cuadro apoyado */}
      <group position={[-0.38, 0.21, -0.02]} rotation={[0.08, 0, 0]}>
        <RB args={[0.28, 0.36, 0.03]} r={0.01} castShadow>{mat('#e3e8ea')}</RB>
        <mesh position={[0, 0, 0.017]}>
          <planeGeometry args={[0.2, 0.28]} />
          {mat('#9fb7c4')}
        </mesh>
      </group>
      {/* libros de pie (azul / blanco / índigo, como la referencia) */}
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

// Planta grande tipo fiddle-leaf en maceta blanca (junto a la ventana).
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

// Props chicos de Kenney sobre el escritorio.
const PROPS = [
  { url: '/models/furniture/computerKeyboard.glb', position: [-0.75, TOP, -1.16] },
  { url: '/models/furniture/computerMouse.glb', position: [-0.32, TOP, -1.2] },
  { url: '/models/furniture/plantSmall3.glb', position: [-0.15, TOP, -1.45] },
  { url: '/models/furniture/pottedPlant.glb', position: [-1.45, TOP, -1.42], scale: 0.6 },
  { url: '/models/furniture/plantSmall2.glb', position: [-1.45, TOP, -0.15] },
  { url: '/models/furniture/books.glb', position: [1.15, 1.225, -1.7], scale: 1.4 },
]

// Silla y personaje comparten pose. Mirando al frente cuando espera; al
// trabajar, la silla gira suavemente hacia el escritorio (y de vuelta).
const CHAIR_POS = [-0.72, 0, -0.66]
const MONITOR_POS = [-0.55, 0, -1.48]
const YAW_FRONT = Math.PI / 4 // hacia la cámara
// yaw exacto hacia el monitor (no hacia la esquina)
const YAW_DESK = Math.atan2(MONITOR_POS[0] - CHAIR_POS[0], MONITOR_POS[2] - CHAIR_POS[2])

function Swivel({ working, children }) {
  const ref = useRef()
  useFrame((_, dt) => {
    if (!ref.current) return
    const target = working ? YAW_DESK : YAW_FRONT
    ref.current.rotation.y = MathUtils.damp(ref.current.rotation.y, target, 3.5, dt)
  })
  return (
    <group ref={ref} position={CHAIR_POS} rotation={[0, YAW_FRONT, 0]}>
      {children}
    </group>
  )
}

export default function Office({ working = false, status = '' }) {
  return (
    <Canvas shadows dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={['#b9ccd3']} />

      <OrthographicCamera makeDefault position={[9, 8, 9]} zoom={150} near={0.1} far={100} />
      <OrbitControls target={[0, 0.35, 0]} enablePan={false} minZoom={80} maxZoom={320} />

      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#dbe8ec', '#4a3b2f', 0.7]} />
      <directionalLight
        position={[4, 7, 4]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
        shadow-camera-near={0.1}
        shadow-camera-far={20}
      />

      <Room />
      <Window />
      <DeskL />
      <Monitor working={working} />
      <Laptop />
      <Shelf />
      {/* tapete azul + silla giratoria con el personaje sentado */}
      <RB args={[1.05, 0.02, 0.95]} r={0.03} position={[-0.72, 0.012, -0.66]} receiveShadow>{mat(MAT_BLUE)}</RB>
      <FiddlePlant position={[-1.38, 0, 0.85]} />

      <Suspense fallback={null}>
        {PROPS.map((p, i) => (
          <GltfProp key={i} {...p} />
        ))}
        <Swivel working={working}>
          <Chair position={[0, 0, 0]} rotation={[0, 0, 0]} />
          <Character3D
            url="/models/pj/Casual_Male.gltf"
            clip="SitDown"
            once
            scale={0.27}
            position={[0, 0, 0]}
            rotation={[0, 0, 0]}
            sitAt={[-0.72, 0.3, -0.66]}
            colors={{ Skin: '#e8b890', Face: '#5c402e' }}
            sway={working}
          />
        </Swivel>
      </Suspense>

      {/* globo de estado sobre la cabeza del personaje */}
      {status && (
        <Html position={[CHAIR_POS[0], 1.06, CHAIR_POS[2]]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
          <div className={working ? 'bubble3d busy' : 'bubble3d'}>{status}</div>
        </Html>
      )}

      <ContactShadows position={[0, 0.004, 0]} opacity={0.4} scale={6} blur={2.5} far={3} />
    </Canvas>
  )
}
