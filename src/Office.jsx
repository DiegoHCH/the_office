import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, OrthographicCamera, ContactShadows } from '@react-three/drei'

// Paleta inspirada en la referencia (diorama acogedor).
const WOOD = '#c69a6d'
const WALL_BACK = '#6a808d'
const WALL_LEFT = '#586d78'
const TEAL = '#2dd4bf'
const WHITE = '#e8edf0'

function Room() {
  return (
    <group>
      {/* piso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[7, 7]} />
        <meshStandardMaterial color={WOOD} />
      </mesh>
      {/* pared trasera */}
      <mesh position={[0, 2, -3.5]} receiveShadow>
        <boxGeometry args={[7, 4, 0.15]} />
        <meshStandardMaterial color={WALL_BACK} />
      </mesh>
      {/* pared izquierda */}
      <mesh position={[-3.5, 2, 0]} receiveShadow>
        <boxGeometry args={[0.15, 4, 7]} />
        <meshStandardMaterial color={WALL_LEFT} />
      </mesh>
      {/* ventana (hueco claro en la pared trasera) */}
      <mesh position={[-1.4, 2.4, -3.4]}>
        <planeGeometry args={[1.6, 1.6]} />
        <meshStandardMaterial color="#dff0f4" emissive="#dff0f4" emissiveIntensity={0.35} />
      </mesh>
      {/* alfombra */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.3, 0.011, 0.7]} receiveShadow>
        <planeGeometry args={[2.8, 2.4]} />
        <meshStandardMaterial color="#31586b" />
      </mesh>
    </group>
  )
}

function Desk() {
  const legs = [
    [-2.35, -2.1],
    [0.35, -2.1],
    [1.45, 0.6],
    [0.35, 0.6],
  ]
  return (
    <group>
      {/* superficie en L */}
      <mesh position={[-1, 1, -1.6]} castShadow receiveShadow>
        <boxGeometry args={[3, 0.12, 1.2]} />
        <meshStandardMaterial color="#8a5a33" />
      </mesh>
      <mesh position={[0.9, 1, -0.4]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.12, 2.4]} />
        <meshStandardMaterial color="#8a5a33" />
      </mesh>
      {/* patas */}
      {legs.map((p, i) => (
        <mesh key={i} position={[p[0], 0.5, p[1]]} castShadow>
          <boxGeometry args={[0.1, 1, 0.1]} />
          <meshStandardMaterial color="#5a6b73" />
        </mesh>
      ))}
      {/* monitor */}
      <group position={[-1, 1.06, -1.85]}>
        <mesh position={[0, 0.6, 0]} castShadow>
          <boxGeometry args={[1.4, 0.9, 0.08]} />
          <meshStandardMaterial color="#11171b" />
        </mesh>
        <mesh position={[0, 0.6, 0.05]}>
          <boxGeometry args={[1.25, 0.75, 0.02]} />
          <meshStandardMaterial color={TEAL} emissive={TEAL} emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[0, 0.12, 0]} castShadow>
          <boxGeometry args={[0.15, 0.35, 0.15]} />
          <meshStandardMaterial color="#11171b" />
        </mesh>
      </group>
    </group>
  )
}

function Chair() {
  return (
    <group position={[0.35, 0, 0.5]}>
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[0.72, 0.12, 0.72]} />
        <meshStandardMaterial color={WHITE} />
      </mesh>
      <mesh position={[0, 1.1, -0.32]} castShadow>
        <boxGeometry args={[0.72, 0.95, 0.12]} />
        <meshStandardMaterial color={WHITE} />
      </mesh>
      <mesh position={[0, 0.32, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.6, 10]} />
        <meshStandardMaterial color="#9aa5ab" />
      </mesh>
      <mesh position={[0, 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.36, 0.36, 0.06, 14]} />
        <meshStandardMaterial color="#9aa5ab" />
      </mesh>
    </group>
  )
}

function Plant({ position }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.2, 0.6, 12]} />
        <meshStandardMaterial color="#e8e2d8" />
      </mesh>
      <mesh position={[0, 0.9, 0]} castShadow>
        <icosahedronGeometry args={[0.5, 0]} />
        <meshStandardMaterial color="#2f8f5b" flatShading />
      </mesh>
      <mesh position={[0.25, 1.15, 0.1]} castShadow>
        <icosahedronGeometry args={[0.34, 0]} />
        <meshStandardMaterial color="#37a066" flatShading />
      </mesh>
    </group>
  )
}

// Personaje placeholder con un leve "respiro" (idle). En F1 se reemplaza por un glTF (Mixamo).
function Character() {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = Math.sin(clock.elapsedTime * 2) * 0.03
  })
  return (
    <group position={[0.35, 0, 0.62]}>
      <group ref={ref}>
        <mesh position={[0, 1.15, 0]} castShadow>
          <capsuleGeometry args={[0.28, 0.5, 4, 12]} />
          <meshStandardMaterial color={TEAL} />
        </mesh>
        <mesh position={[0, 1.78, 0]} castShadow>
          <sphereGeometry args={[0.26, 20, 20]} />
          <meshStandardMaterial color="#e9c39a" />
        </mesh>
      </group>
    </group>
  )
}

export default function Office() {
  return (
    <Canvas shadows dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={['#b9ccd3']} />

      {/* Cámara ortográfica en ángulo isométrico */}
      <OrthographicCamera makeDefault position={[9, 8, 9]} zoom={70} near={0.1} far={100} />
      <OrbitControls target={[0, 1, 0]} enablePan={false} minZoom={40} maxZoom={150} />

      {/* Luz: suave + direccional con sombras para el look de diorama */}
      <ambientLight intensity={0.95} />
      <hemisphereLight args={['#dbe8ec', '#4a3b2f', 0.7]} />
      <directionalLight
        position={[6, 11, 6]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
      />

      <Room />
      <Desk />
      <Chair />
      <Character />
      <Plant position={[-2.7, 0, 2.1]} />
      <Plant position={[2.6, 0, -2.2]} />

      <ContactShadows position={[0, 0.02, 0]} opacity={0.4} scale={12} blur={2.4} far={4} />
    </Canvas>
  )
}
