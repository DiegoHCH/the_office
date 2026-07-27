import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import { Box3 } from 'three'

// Mascota de la oficina 🦊: pasea entre puntos libres del centro de la sala,
// se detiene a husmear/comer y, si hay standup, se acerca a mirar la reunión.
// El modelo se normaliza por bounding box (los packs traen escalas distintas).
export default function Pet({ url = '/models/pets/Fox.glb', spots = [], standup = false, height = 0.55 }) {
  const group = useRef()
  const { scene, animations } = useGLTF(url)
  const { actions } = useAnimations(animations, group)
  const stateRef = useRef({ target: null, pauseUntil: 0, mode: 'idle' })
  const curActionRef = useRef(null)

  // altura objetivo ~0.55 unidades (un zorro junto a personajes de ~1.9)
  const scale = useMemo(() => {
    const box = new Box3().setFromObject(scene)
    const h = Math.max(box.max.y - box.min.y, 0.001)
    return height / h
  }, [scene, height])

  const play = (name, fade = 0.25) => {
    const next = actions[name] || actions[`AnimalArmature|${name}`]
    if (!next || curActionRef.current === next) return
    next.reset().fadeIn(fade).play()
    curActionRef.current?.fadeOut(fade)
    curActionRef.current = next
  }

  useEffect(() => {
    scene.traverse((o) => {
      if (o.isMesh) o.castShadow = true
    })
  }, [scene])

  useEffect(() => {
    play('Idle')
    // arranca en un punto aleatorio del paseo
    const s = spots[Math.floor(Math.random() * spots.length)] || [0.8, 0.8]
    group.current?.position.set(s[0], 0, s[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions])

  useFrame((state, dt) => {
    const g = group.current
    if (!g) return
    const st = stateRef.current
    const now = state.clock.elapsedTime
    // en standup: acercarse a mirar la reunión desde el borde
    const standupSpot = [1.15, 0.85]
    if (st.mode === 'walking' && st.target) {
      const dx = st.target[0] - g.position.x
      const dz = st.target[1] - g.position.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.06) {
        st.mode = 'idle'
        st.pauseUntil = now + 3 + Math.random() * 5
        play(standup ? 'Idle' : Math.random() < 0.4 ? 'Eating' : Math.random() < 0.5 ? 'Idle_2' : 'Idle')
      } else {
        const speed = 0.5
        g.position.x += (dx / dist) * speed * dt
        g.position.z += (dz / dist) * speed * dt
        g.rotation.y = Math.atan2(dx, dz)
      }
    } else if (now > st.pauseUntil) {
      const next = standup ? standupSpot : spots[Math.floor(Math.random() * spots.length)] || [0.8, 0.8]
      // si ya está ahí (p. ej. mirando el standup), sigue en idle
      if (Math.hypot(next[0] - g.position.x, next[1] - g.position.z) < 0.1) {
        st.pauseUntil = now + 4
        return
      }
      st.target = next
      st.mode = 'walking'
      play('Walk')
    }
  })

  return <primitive ref={group} object={scene} scale={scale} />
}

// sin preload: la mascota elegida se carga bajo demanda (hay 6 modelos)
