import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { PerspectiveCamera, RoundedBox, ContactShadows } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { DoubleSide, MathUtils, TextureLoader, RepeatWrapping, ACESFilmicToneMapping } from 'three'
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


// Torre moderna: núcleo oscuro con muro cortina de vidrio y remate.
function GlassTower({ position, w, d, h, rot = 0, lit = 0.5 }) {
  const floors = Math.max(2, Math.round(h / 0.52))
  return (
    <group position={position} rotation={[0, rot, 0]}>
      {/* núcleo */}
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#39434c" roughness={0.55} metalness={0.35} />
      </mesh>
      {/* muro cortina: bandas de vidrio por piso en las 4 caras */}
      {Array.from({ length: floors }, (_, f) => {
        const y = 0.34 + f * 0.52
        if (y > h - 0.22) return null
        const warm = Math.random() < lit
        const glass = (
          <meshStandardMaterial
            color={warm ? '#ffd6a0' : '#8fc4e8'}
            emissive={warm ? '#ffa94d' : '#4a90c4'}
            emissiveIntensity={warm ? 1.2 : 0.55}
            roughness={0.12}
            metalness={0.55}
          />
        )
        return (
          <group key={f} position={[0, y, 0]}>
            <mesh position={[0, 0, d / 2 + 0.012]}>
              <planeGeometry args={[w * 0.88, 0.34]} />
              {glass}
            </mesh>
            <mesh position={[0, 0, -d / 2 - 0.012]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[w * 0.88, 0.34]} />
              {glass}
            </mesh>
            <mesh position={[w / 2 + 0.012, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[d * 0.88, 0.34]} />
              {glass}
            </mesh>
            <mesh position={[-w / 2 - 0.012, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
              <planeGeometry args={[d * 0.88, 0.34]} />
              {glass}
            </mesh>
          </group>
        )
      })}
      {/* remate y antena */}
      <mesh position={[0, h + 0.07, 0]} castShadow>
        <boxGeometry args={[w + 0.14, 0.14, d + 0.14]} />
        <meshStandardMaterial color="#2b333a" roughness={0.5} metalness={0.5} />
      </mesh>
      {h > 3.5 && (
        <mesh position={[0, h + 0.5, 0]}>
          <cylinderGeometry args={[0.015, 0.02, 0.8, 6]} />
          <meshStandardMaterial color="#5b6770" metalness={0.7} roughness={0.3} />
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]} receiveShadow>
        <planeGeometry args={[52, 52]} />
        <meshStandardMaterial color="#3f4a52" roughness={1} />
      </mesh>
      {/* avenidas en cruz, con línea central */}
      {[
        [52, 3.8, 0, 0],
        [3.8, 52, 0, 0],
      ].map(([w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.31, 0]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color="#565f66" roughness={1} />
        </mesh>
      ))}
      {blocks.map((b, i) => (
        <GlassTower key={i} position={[b[0], -0.3, b[1]]} w={b[2]} d={b[3]} h={b[4]} lit={b[5]} />
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
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) front.push([-0.95 + c * 0.72, 0.95 + r * 0.85])
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

      {/* ENTRADA: pórtico de madera + puertas de vidrio con luz cálida detrás */}
      <RB args={[1.45, 1.55, 0.28]} r={0.05} position={[-0.55, 0.78, 1.16]} castShadow>
        <meshStandardMaterial color={WOOD_TRIM} roughness={0.7} />
      </RB>
      {/* zaguán: hueco oscuro hacia adentro para que al cruzar la puerta la
          cámara entre en negro (antes era un plano claro pegado a la fachada) */}
      <mesh position={[-0.55, 0.68, 0.35]}>
        <boxGeometry args={[1.05, 1.3, 1.7]} />
        <meshStandardMaterial color="#0b0f12" roughness={1} side={DoubleSide} />
      </mesh>
      {/* una lengua de luz cálida en el piso del zaguán (se ve al abrir) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.55, 0.045, 0.95]}>
        <planeGeometry args={[0.9, 0.9]} />
        <meshStandardMaterial color="#3a2a1c" emissive="#c98a4a" emissiveIntensity={0.5} />
      </mesh>
      <group position={[-0.55, 0.64, 1.33]}>
        {[
          ['left', -0.3, left],
          ['right', 0.3, right],
        ].map(([k, x, ref]) => (
          <group key={k} ref={ref} position={[x, 0, 0]}>
            <mesh position={[x < 0 ? 0.15 : -0.15, 0, 0]} castShadow>
              <boxGeometry args={[0.3, 1.2, 0.05]} />
              <meshStandardMaterial color={WOOD_DARK} roughness={0.5} />
            </mesh>
            <mesh position={[x < 0 ? 0.15 : -0.15, 0.06, 0.032]}>
              <planeGeometry args={[0.21, 0.95]} />
              <meshStandardMaterial color="#ffe9cc" emissive="#ffcf95" emissiveIntensity={0.9} side={DoubleSide} />
            </mesh>
          </group>
        ))}
      </group>
      {/* letrero iluminado sobre la puerta */}
      <RB args={[0.95, 0.17, 0.06]} r={0.03} position={[-0.55, 1.68, 1.3]}>
        <meshStandardMaterial color="#f6f1e6" emissive="#ffdfae" emissiveIntensity={1.2} />
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
    [0.78, [-0.35, 1.55, 3.9], [-0.55, 0.85, 1.2]],
    [1.0, [-0.55, 0.78, 0.85], [-0.55, 0.72, -1.2]], // dentro del zaguán
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
