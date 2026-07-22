import { Suspense, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { MathUtils } from 'three'
import { OrbitControls, OrthographicCamera, ContactShadows, RoundedBox, Html } from '@react-three/drei'
import GltfProp from './scene/GltfProp.jsx'
import Character3D from './scene/Character3D.jsx'

// ── Paleta calcada de la referencia ─────────────────────────────────────────
const FLOOR = '#c9917b'
const WALL_BACK = '#3d5866'
const WALL_LEFT = '#35505d'
const BASE = '#2f434e'
const DESK = '#cf9b7e'
const METAL = '#b9c2c7'
const DARK = '#22282c'
const WHITE = '#eef2f4'
const MAT_BLUE = '#3c6b82'
const POT = '#ece6db'
const GREEN1 = '#3a8f5f'
const GREEN2 = '#49a56d'

const DESK_H = 0.38
const TOP = DESK_H + 0.025
const ROOM = 5.2 // piso ROOM x ROOM, paredes en ±ROOM/2
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
        {mat(FLOOR)}
      </mesh>
      <mesh position={[0, 1, -HALF]} receiveShadow castShadow>
        <boxGeometry args={[ROOM, 2, 0.08]} />
        {mat(WALL_BACK)}
      </mesh>
      <mesh position={[-HALF, 1, 0]} receiveShadow castShadow>
        <boxGeometry args={[0.08, 2, ROOM]} />
        {mat(WALL_LEFT)}
      </mesh>
      <mesh position={[0, 0.05, -HALF + 0.05]}>
        <boxGeometry args={[ROOM, 0.1, 0.03]} />
        {mat(BASE)}
      </mesh>
      <mesh position={[-HALF + 0.05, 0.05, 0]}>
        <boxGeometry args={[0.03, 0.1, ROOM]} />
        {mat(BASE)}
      </mesh>
    </group>
  )
}

function Window() {
  return (
    <group position={[-HALF + 0.04, 1.3, -1.4]} rotation={[0, Math.PI / 2, 0]}>
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

// ── Escritorio en L genérico ─────────────────────────────────────────────────
// Esquina del L en el origen local; alas hacia +z y +x. Se rota por estación.
function LDesk({ position, rotation = [0, 0, 0] }) {
  const legs = [
    [0.15, 1.58],
    [1.58, 0.15],
    [0.18, 0.18],
  ]
  return (
    <group position={position} rotation={rotation}>
      <RB args={[0.55, 0.05, 1.7]} r={0.02} position={[0, DESK_H, 0.85]} castShadow receiveShadow>
        {mat(DESK)}
      </RB>
      <RB args={[1.7, 0.05, 0.55]} r={0.02} position={[0.85, DESK_H + 0.001, 0]} castShadow receiveShadow>
        {mat(DESK)}
      </RB>
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
      <RB args={[1.25, 0.05, 0.28]} r={0.015} castShadow receiveShadow>{mat(DESK)}</RB>
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

// Props chicos de Kenney sobre el escritorio principal + estante.
const PROPS = [
  { url: '/models/furniture/computerKeyboard.glb', position: [-1.62, TOP, -1.95] },
  { url: '/models/furniture/computerMouse.glb', position: [-1.28, TOP, -1.98] },
  { url: '/models/furniture/plantSmall3.glb', position: [-1.05, TOP, -2.32] },
  { url: '/models/furniture/pottedPlant.glb', position: [-2.28, TOP, -2.28], scale: 0.6 },
  { url: '/models/furniture/plantSmall2.glb', position: [-2.3, TOP, -0.75] },
  { url: '/models/furniture/books.glb', position: [1.55, 1.325, -2.5], scale: 1.4 },
]

// ── Estación principal (dev) ────────────────────────────────────────────────
const CHAIR_POS = [-1.5, 0, -1.5]
const MONITOR_POS = [-1.5, 0, -2.32]
const YAW_FRONT = Math.PI / 4
const YAW_DESK = Math.atan2(MONITOR_POS[0] - CHAIR_POS[0], MONITOR_POS[2] - CHAIR_POS[2])

// ── Squad: research (investiga/artifacts), design (UI/UX), qa (tests) ──────
// Cada estación tiene su L en una esquina, monitor en diagonal y personaje.
const STATIONS = [
  {
    id: 'research',
    name: 'Nami',
    emoji: '🔍',
    desk: [HALF - 0.32, 0, -HALF + 0.32],
    deskRot: [0, -Math.PI / 2, 0], // alas hacia -x (pared fondo) y +z
    monitor: [1.95, TOP, -1.95],
    monitorRot: [0, -Math.PI / 4, 0],
    chair: [1.4, 0, -1.4],
    chairRot: [0, (Math.PI * 3) / 4, 0],
    deliver: [-0.6, -0.95], // a dónde camina a entregarle a Luffy
    url: '/models/pj/Casual_Female.gltf',
    shirt: '#6366f1',
    hair: '#f97316', // Nami: pelo naranja
  },
  {
    id: 'design',
    name: 'Sanji',
    emoji: '🎨',
    desk: [-HALF + 0.32, 0, HALF - 0.32],
    deskRot: [0, Math.PI / 2, 0], // alas hacia -z (pared izq) y +x
    monitor: [-1.95, TOP, 1.95],
    monitorRot: [0, (Math.PI * 3) / 4, 0],
    chair: [-1.4, 0, 1.4],
    chairRot: [0, -Math.PI / 4, 0],
    deliver: [-1.05, -0.4],
    url: '/models/pj/Casual2_Male.gltf',
    shirt: '#f472b6',
    hair: '#eab308', // Sanji: rubio
  },
  {
    id: 'qa',
    name: 'Zoro',
    emoji: '🧪',
    desk: [HALF - 0.32, 0, HALF - 0.32],
    deskRot: [0, Math.PI, 0], // alas hacia -x y -z (isla en la esquina frontal)
    monitor: [1.95, TOP, 1.95],
    monitorRot: [0, (-Math.PI * 3) / 4, 0],
    chair: [1.4, 0, 1.4],
    chairRot: [0, Math.PI / 4, 0],
    deliver: [-0.45, -0.65],
    url: '/models/pj/Casual3_Male.gltf',
    shirt: '#f5a524',
    hair: '#3a8f5f', // Zoro: pelo verde
  },
]

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

export default function Office({ roleStates = {}, status = '', onTourDone }) {
  const devState = roleStates.dev || 'idle'
  return (
    <Canvas shadows dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={['#b9ccd3']} />

      <OrthographicCamera makeDefault position={[9, 8, 9]} zoom={105} near={0.1} far={100} />
      <OrbitControls target={[0, 0.35, 0]} enablePan={false} minZoom={60} maxZoom={280} />

      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#dbe8ec', '#4a3b2f', 0.7]} />
      <directionalLight
        position={[5, 9, 5]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-camera-near={0.1}
        shadow-camera-far={25}
      />

      <Room />
      <Window />
      <Shelf />

      {/* estación principal (dev): L en la esquina trasera-izquierda */}
      <LDesk position={[-HALF + 0.32, 0, -HALF + 0.32]} />
      <Monitor working={devState === 'working'} position={MONITOR_POS.map((v, i) => (i === 1 ? TOP : v))} />
      <Laptop position={[-2.3, TOP, -1.3]} rotation={[0, Math.PI / 2, 0]} />
      {/* gabinete y archivadores bajo el ala del fondo */}
      <RB args={[0.35, 0.3, 0.42]} r={0.02} position={[-0.75, 0.15, -2.28]} castShadow>{mat(DARK)}</RB>
      {['#3a4750', '#51616c', '#2e3a42'].map((c, i) => (
        <RB key={c} args={[0.05, 0.26, 0.18]} r={0.012} position={[-1.95 + i * 0.07, 0.13, -2.28]} castShadow>
          {mat(c)}
        </RB>
      ))}
      <RB args={[1.05, 0.02, 0.95]} r={0.03} position={[-1.5, 0.012, -1.45]} receiveShadow>{mat(MAT_BLUE)}</RB>
      <FiddlePlant position={[2.3, 0, 0.1]} />

      <Suspense fallback={null}>
        {PROPS.map((p, i) => (
          <GltfProp key={i} {...p} />
        ))}

        <Turn position={CHAIR_POS} yaw={yawFor(devState, YAW_DESK)}>
          <Chair position={[0, 0, 0]} rotation={[0, 0, 0]} />
          <Character3D
            url="/models/pj/Casual_Male.gltf"
            clip="SitDown"
            once
            scale={0.27}
            position={[0, 0, 0]}
            rotation={[0, 0, 0]}
            sitAt={[CHAIR_POS[0], 0.3, CHAIR_POS[2]]}
            colors={{ Skin: '#e8b890', Face: '#1f2937', Hair: '#1f2937', Shirt: '#2dd4bf' }}
            sway={devState === 'working'}
          />
        </Turn>
        {/* etiqueta con el nombre del principal (Luffy: pelo negro) */}
        <Html position={[CHAIR_POS[0], 0.82, CHAIR_POS[2]]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
          <div className="nametag" style={{ borderColor: '#2dd4bf' }}>Luffy</div>
        </Html>

        {/* squad: research / design / qa — cada uno con su L y su monitor */}
        {STATIONS.map((s) => {
          const st = roleStates[s.id] || 'idle'
          const yawScreen = Math.atan2(s.monitor[0] - s.chair[0], s.monitor[2] - s.chair[2])
          const bubble =
            st === 'working'
              ? `${s.emoji} trabajando…`
              : st === 'listening'
                ? '👂 escuchando…'
                : st === 'talking'
                  ? '💬'
                  : st === 'delivering'
                    ? `${s.emoji} ¡listo!`
                    : null
          return (
            <group key={s.id}>
              <LDesk position={s.desk} rotation={s.deskRot} />
              <Monitor working={st === 'working'} position={s.monitor} rotation={s.monitorRot} />
              <Turn position={s.chair} yaw={yawFor(st, yawScreen)}>
                <Chair position={[0, 0, 0]} rotation={[0, 0, 0]} />
              </Turn>
              {/* el personaje vive fuera del Turn para poder levantarse y caminar;
                  nametag y globo van DENTRO (coords locales /0.27) y lo siguen */}
              <Character3D
                url={s.url}
                clip="SitDown"
                once
                scale={0.27}
                position={s.chair}
                rotation={[0, yawScreen, 0]}
                yaw={yawFor(st, yawScreen)}
                sitAt={[s.chair[0], 0.3, s.chair[2]]}
                colors={{ Skin: '#e8b890', Face: s.hair, Hair: s.hair, Shirt: s.shirt }}
                sway={st === 'working'}
                tour={
                  st === 'delivering'
                    ? { to: s.deliver, face: [CHAIR_POS[0], CHAIR_POS[2]], onDone: () => onTourDone?.(s.id) }
                    : null
                }
              >
                <Html position={[0, 3.1, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                  <div className="nametag" style={{ borderColor: s.shirt }}>{s.name}</div>
                </Html>
                {bubble && (
                  <Html position={[0, 4.0, 0]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
                    <div className="bubble3d busy">{bubble}</div>
                  </Html>
                )}
              </Character3D>
            </group>
          )
        })}
      </Suspense>

      {/* globo de estado sobre la cabeza del personaje principal */}
      {status && (
        <Html position={[CHAIR_POS[0], 1.06, CHAIR_POS[2]]} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
          <div className={devState !== 'idle' ? 'bubble3d busy' : 'bubble3d'}>{status}</div>
        </Html>
      )}

      <ContactShadows position={[0, 0.004, 0]} opacity={0.4} scale={9} blur={2.5} far={3} />
    </Canvas>
  )
}
