// Miniaturas 3D de los avatares: un renderer offscreen compartido genera una
// imagen por modelo (con caché en memoria — cada modelo se renderiza una vez).
import { WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const cache = new Map()
let ctx = null

// Estos NO llevan piel humana (goblins verdes, zombies, el robot).
export const NONHUMAN_AVATARS = new Set([
  'Goblin_Male.gltf',
  'Goblin_Female.gltf',
  'Zombie_Male.gltf',
  'Zombie_Female.gltf',
  'BaseCharacter.gltf',
])
export const SKIN_TONE = '#e8b890'

function ensureCtx() {
  if (ctx) return ctx
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(150, 190)
  renderer.setPixelRatio(1.5)
  const scene = new Scene()
  const cam = new PerspectiveCamera(32, 150 / 190, 0.1, 50)
  cam.position.set(0.7, 2.4, 5.6)
  cam.lookAt(0, 1.55, 0)
  scene.add(new AmbientLight(0xffffff, 1.15))
  const dir = new DirectionalLight(0xffffff, 1.6)
  dir.position.set(3, 6, 4)
  scene.add(dir)
  ctx = { renderer, scene, cam, loader: new GLTFLoader() }
  return ctx
}

export function getAvatarThumb(file) {
  if (cache.has(file)) return cache.get(file)
  const p = new Promise((resolve) => {
    const { renderer, scene, cam, loader } = ensureCtx()
    loader.load(
      `/models/pj/${file}`,
      (gltf) => {
        // piel natural para los humanos + cejas del color del pelo del modelo
        if (!NONHUMAN_AVATARS.has(file)) {
          let hairColor = null
          gltf.scene.traverse((o) => {
            if (!o.isMesh) return
            const mats = Array.isArray(o.material) ? o.material : [o.material]
            mats.forEach((m) => {
              if (m?.name === 'Hair' && !hairColor) hairColor = m.color.clone()
            })
          })
          gltf.scene.traverse((o) => {
            if (!o.isMesh) return
            const mats = Array.isArray(o.material) ? o.material : [o.material]
            mats.forEach((m) => {
              if (m?.name === 'Skin') m.color.set(SKIN_TONE)
              // 'Face' = cejas; los ojos comparten material con el pelo
              if (m?.name === 'Face') {
                if (hairColor) m.color.copy(hairColor)
                else m.color.set('#3a2a20') // calvos: cejas castañas
              }
            })
          })
        }
        // add → render → snapshot → remove: los callbacks corren en serie,
        // así que el renderer compartido no se pisa entre modelos
        scene.add(gltf.scene)
        renderer.render(scene, cam)
        const url = renderer.domElement.toDataURL('image/png')
        scene.remove(gltf.scene)
        resolve(url)
      },
      undefined,
      () => resolve(null)
    )
  })
  cache.set(file, p)
  return p
}
