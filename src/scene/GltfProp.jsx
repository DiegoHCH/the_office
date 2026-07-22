import { useMemo, useLayoutEffect } from 'react'
import { useGLTF } from '@react-three/drei'

/**
 * Carga un modelo glTF/GLB y lo coloca en la escena.
 * Aplica sombras a todas las mallas y clona la escena (para poder reutilizar el mismo modelo varias veces).
 *
 * Uso:
 *   <GltfProp url="/models/desk.glb" position={[0,0,0]} rotation={[0,Math.PI/2,0]} scale={1.5} />
 */
export default function GltfProp({ url, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 }) {
  const { scene } = useGLTF(url)
  const clone = useMemo(() => scene.clone(true), [scene])

  useLayoutEffect(() => {
    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
  }, [clone])

  return <primitive object={clone} position={position} rotation={rotation} scale={scale} />
}
