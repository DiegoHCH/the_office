import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrthographicCamera, RoundedBox, ContactShadows } from '@react-three/drei'
import { DoubleSide, MathUtils } from 'three'

// ── Intro cinemática (#112) ──────────────────────────────────────────────────
// Se ve el edificio de La Oficina desde fuera, la cámara hace dolly hacia la
// entrada, las puertas se abren y un destello blanco funde a la oficina real.
// Referencia: docs/referencias/edificio-intro.png

const ORANGE = '#e2703a'
const ORANGE_D = '#c05a2a'
const GLASS = '#7fb2d9'
const CREAM = '#e8e2d4'
const GRASS = '#6aa84f'
const PATH = '#cfc6b4'

// Caja con bordes redondeados (el mismo helper que usa la sala, local aquí
// para que la intro no dependa de Office.jsx)
function RB({ args, r = 0.02, children, ...props }) {
  const radius = Math.max(Math.min(r, Math.min(...args) / 2 - 0.001), 0.004)
  return (
    <RoundedBox args={args} radius={radius} smoothness={3} {...props}>
      {children}
    </RoundedBox>
  )
}

function Tree({ position, scale = 1, tone = 0 }) {
  const greens = ['#4a8f3c', '#5aa346', '#3f7d34']
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 0.45, 8]} />
        <meshStandardMaterial color="#7a5636" roughness={0.9} />
      </mesh>
      {[
        [0, 0.62, 0, 0.3],
        [0.16, 0.5, 0.08, 0.22],
        [-0.15, 0.52, -0.06, 0.2],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color={greens[(i + tone) % 3]} roughness={0.85} flatShading />
        </mesh>
      ))}
    </group>
  )
}

// Fachada acristalada: rejilla de ventanas azules sobre el cuerpo del edificio
function GlassWall({ width, height, position, rotation = [0, 0, 0], cols = 5, rows = 3 }) {
  const panes = []
  const gw = width / cols
  const gh = height / rows
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      panes.push([-width / 2 + gw * (c + 0.5), -height / 2 + gh * (r + 0.5)])
    }
  }
  return (
    <group position={position} rotation={rotation}>
      {panes.map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0.03]}>
          <planeGeometry args={[gw * 0.82, gh * 0.78]} />
          <meshStandardMaterial
            color={GLASS}
            emissive="#9fd2f2"
            emissiveIntensity={0.35 + (i % 4) * 0.12}
            roughness={0.25}
            metalness={0.35}
          />
        </mesh>
      ))}
    </group>
  )
}

function Building({ doorOpen }) {
  // las hojas de la puerta rotan hacia adentro según el progreso 0→1
  const left = useRef()
  const right = useRef()
  useFrame(() => {
    const a = doorOpen.current * (Math.PI / 2.2)
    if (left.current) left.current.rotation.y = MathUtils.lerp(left.current.rotation.y, -a, 0.15)
    if (right.current) right.current.rotation.y = MathUtils.lerp(right.current.rotation.y, a, 0.15)
  })
  return (
    <group>
      {/* plataforma con césped */}
      <RB args={[6.4, 0.3, 5.4]} r={0.14} position={[0, -0.15, 0]} receiveShadow>
        <meshStandardMaterial color="#8a6a4a" roughness={0.95} />
      </RB>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[6.2, 5.2]} />
        <meshStandardMaterial color={GRASS} roughness={1} />
      </mesh>
      {/* camino hasta la entrada */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 1.9]} receiveShadow>
        <planeGeometry args={[1.5, 1.6]} />
        <meshStandardMaterial color={PATH} roughness={1} />
      </mesh>

      {/* cuerpo principal (2 pisos) */}
      <RB args={[3.6, 2.5, 2.8]} r={0.05} position={[0.5, 1.25, -0.4]} castShadow receiveShadow>
        <meshStandardMaterial color={CREAM} roughness={0.9} />
      </RB>
      <GlassWall width={3.2} height={2.1} position={[0.5, 1.3, 1.01]} cols={6} rows={3} />
      <GlassWall width={2.4} height={2.1} position={[2.31, 1.3, -0.4]} rotation={[0, Math.PI / 2, 0]} cols={5} rows={3} />
      {/* cornisa naranja */}
      <RB args={[3.75, 0.22, 2.95]} r={0.05} position={[0.5, 2.6, -0.4]} castShadow>
        <meshStandardMaterial color={ORANGE} roughness={0.7} />
      </RB>
      {/* letrero */}
      <RB args={[1.1, 0.2, 0.06]} r={0.04} position={[1.2, 2.62, 1.06]}>
        <meshStandardMaterial color="#f6f1e6" emissive="#fff6e0" emissiveIntensity={0.5} />
      </RB>

      {/* ala izquierda más baja */}
      <RB args={[2.0, 1.7, 2.4]} r={0.05} position={[-1.9, 0.85, -0.2]} castShadow receiveShadow>
        <meshStandardMaterial color={CREAM} roughness={0.9} />
      </RB>
      <GlassWall width={1.6} height={1.2} position={[-1.9, 0.95, 1.01]} cols={4} rows={2} />
      <RB args={[2.15, 0.18, 2.55]} r={0.04} position={[-1.9, 1.78, -0.2]} castShadow>
        <meshStandardMaterial color={ORANGE} roughness={0.7} />
      </RB>

      {/* ENTRADA: pórtico naranja + puertas que se abren */}
      <RB args={[1.5, 1.5, 0.3]} r={0.05} position={[-0.55, 0.75, 1.15]} castShadow>
        <meshStandardMaterial color={ORANGE_D} roughness={0.75} />
      </RB>
      <group position={[-0.55, 0.62, 1.32]}>
        {[
          ['left', -0.32, left],
          ['right', 0.32, right],
        ].map(([k, x, ref]) => (
          <group key={k} ref={ref} position={[x, 0, 0]}>
            <mesh position={[x < 0 ? 0.16 : -0.16, 0, 0]} castShadow>
              <boxGeometry args={[0.32, 1.24, 0.05]} />
              <meshStandardMaterial color="#2c3a44" roughness={0.35} metalness={0.2} />
            </mesh>
            <mesh position={[x < 0 ? 0.16 : -0.16, 0.05, 0.03]}>
              <planeGeometry args={[0.24, 1.0]} />
              <meshStandardMaterial color={GLASS} emissive="#bfe3fa" emissiveIntensity={0.6} side={DoubleSide} />
            </mesh>
          </group>
        ))}
      </group>
      {/* escalones */}
      <RB args={[1.6, 0.08, 0.3]} r={0.02} position={[-0.55, 0.04, 1.5]} receiveShadow>
        <meshStandardMaterial color={PATH} roughness={1} />
      </RB>

      {/* arbolitos */}
      <Tree position={[-2.6, 0, 1.7]} scale={1.15} />
      <Tree position={[-2.1, 0, 2.1]} scale={0.85} tone={1} />
      <Tree position={[-1.4, 0, 2.2]} scale={0.7} tone={2} />
      <Tree position={[2.5, 0, 1.6]} scale={1.05} tone={1} />
      <Tree position={[2.7, 0, 0.6]} scale={0.8} tone={2} />
    </group>
  )
}

// Cámara: dolly desde la vista isométrica del edificio hasta la puerta.
function IntroCamera({ progress }) {
  const cam = useRef()
  useFrame(() => {
    const c = cam.current
    if (!c) return
    const p = progress.current
    const ease = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2 // easeInOutQuad
    c.position.set(MathUtils.lerp(7.5, 0.4, ease), MathUtils.lerp(6, 1.1, ease), MathUtils.lerp(8.5, 4.2, ease))
    c.zoom = MathUtils.lerp(78, 300, ease)
    c.lookAt(-0.55, MathUtils.lerp(1.0, 0.7, ease), 1.2)
    c.updateProjectionMatrix()
  })
  return <OrthographicCamera ref={cam} makeDefault position={[7.5, 6, 8.5]} zoom={78} near={0.1} far={100} />
}

/**
 * Intro completa. Llama a onDone() cuando termina (o si el usuario salta).
 * Fases: 0-2.2s acercarse · 2.2-3.0s abrir puertas · 3.0-3.8s destello → fin.
 */
export default function Intro({ onDone }) {
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
    const tick = () => {
      const t = (performance.now() - startedAt.current) / 1000
      progress.current = Math.min(t / 2.6, 1)
      doorOpen.current = t > 2.0 ? Math.min((t - 2.0) / 0.8, 1) : 0
      if (t > 2.9) setFlash(Math.min((t - 2.9) / 0.55, 1))
      if (t > 3.6) return finish()
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
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={['#b9ccd3']} />
        <IntroCamera progress={progress} />
        <ambientLight intensity={0.95} />
        <hemisphereLight args={['#dbe8ec', '#4a3b2f', 0.7]} />
        <directionalLight
          position={[5, 8, 6]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
        />
        <Building doorOpen={doorOpen} />
        <ContactShadows position={[0, 0.02, 0]} opacity={0.35} scale={12} blur={2.6} far={4} />
      </Canvas>
      <div className="intro-flash" style={{ opacity: flash }} />
      <button type="button" className="intro-skip" onClick={finish}>
        Saltar intro
      </button>
    </div>
  )
}
