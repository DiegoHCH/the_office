import { useEffect, useRef } from 'react'
import { LoopOnce, Vector3 } from 'three'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'

/**
 * Personaje glTF con animaciones (Quaternius = GLB/GLTF con clips embebidos).
 *
 * Props clave:
 * - clip: nombre de la animación a reproducir (si no, la primera disponible).
 * - once: reproduce una sola vez y se queda en la pose final (LoopOnce + clamp).
 * - sitAt: [x,y,z] — ancla la CADERA del personaje a ese punto del mundo en cada
 *   frame. Elimina el problema del root-motion al sentarlo en una silla: la
 *   cadera queda exactamente sobre el asiento sin adivinar offsets.
 * - colors: { [nombreMaterial]: '#hex' } — recolorea materiales por nombre
 *   (p.ej. { Skin: '#e8b890' } para el tono de piel; Quaternius usa #242424).
 */
export default function Character3D({
  url = '/models/character.glb',
  clip,
  once = false,
  sitAt = null,
  colors = null,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}) {
  const group = useRef()
  const hipsBone = useRef(null)
  const { scene, animations } = useGLTF(url)
  const { actions, names } = useAnimations(animations, group)

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[Character3D] animaciones disponibles:', names)
    scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
        // recoloreo por nombre de material (clonando para no tocar el caché)
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m, i) => {
          const hex = colors?.[m?.name]
          if (!hex) return
          const cloned = m.clone()
          cloned.color.set(hex)
          if (Array.isArray(o.material)) o.material[i] = cloned
          else o.material = cloned
        })
      }
    })
    // localizar el hueso de la cadera (o el primero como fallback)
    const bones = []
    scene.traverse((o) => o.isBone && bones.push(o))
    // eslint-disable-next-line no-console
    console.log('[Character3D] huesos:', bones.map((b) => b.name))
    hipsBone.current =
      bones.find((b) => /hip|pelvis/i.test(b.name)) ||
      bones.find((b) => /torso|spine|root/i.test(b.name)) ||
      bones[0] ||
      null
  }, [scene, names, colors])

  useEffect(() => {
    const name = clip && actions[clip] ? clip : names[0]
    const action = name ? actions[name] : null
    if (!action) return
    if (once) {
      action.setLoop(LoopOnce, 1)
      action.clampWhenFinished = true // se queda en la pose final
    }
    action.reset().fadeIn(0.3).play()
    return () => action.fadeOut(0.2)
  }, [actions, names, clip, once])

  // Anclar la cadera al punto del asiento (corrige el root-motion de SitDown).
  const tmp = useRef(new Vector3())
  useFrame(() => {
    if (!sitAt || !hipsBone.current || !group.current) return
    hipsBone.current.getWorldPosition(tmp.current)
    group.current.position.x += sitAt[0] - tmp.current.x
    group.current.position.y += sitAt[1] - tmp.current.y
    group.current.position.z += sitAt[2] - tmp.current.z
  })

  return (
    <group ref={group} position={position} rotation={rotation} scale={scale}>
      <primitive object={scene} />
    </group>
  )
}
