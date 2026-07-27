import { useMemo, useLayoutEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import { Box3 } from 'three'

/**
 * Carga un modelo glTF/GLB y lo coloca en la escena.
 * Aplica sombras a todas las mallas y clona la escena (para poder reutilizar el mismo modelo varias veces).
 *
 * `fitHeight`: normaliza la escala para que el modelo mida esa altura en unidades
 * de mundo Y lo asienta sobre position[1] (los packs traen escalas/orígenes distintos).
 *
 * Uso:
 *   <GltfProp url="/models/desk.glb" position={[0,0,0]} rotation={[0,Math.PI/2,0]} scale={1.5} />
 *   <GltfProp url="/models/props/Monstera.glb" position={[0,0,0]} fitHeight={0.55} />
 */
export default function GltfProp({ url, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, fitHeight = null }) {
  const { scene } = useGLTF(url)
  const clone = useMemo(() => scene.clone(true), [scene])

  const { s, yOff } = useMemo(() => {
    if (!fitHeight) return { s: scale, yOff: 0 }
    const box = new Box3().setFromObject(clone)
    const h = Math.max(box.max.y - box.min.y, 0.001)
    const s2 = fitHeight / h
    return { s: s2, yOff: -box.min.y * s2 }
  }, [clone, fitHeight, scale])

  useLayoutEffect(() => {
    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
  }, [clone])

  return <primitive object={clone} position={[position[0], position[1] + yOff, position[2]]} rotation={rotation} scale={s} />
}
