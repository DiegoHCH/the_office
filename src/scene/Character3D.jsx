import { useEffect, useMemo, useRef } from 'react'
import { LoopOnce, LoopRepeat, Vector3, Quaternion, MathUtils } from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'

// normaliza el yaw objetivo al rango más cercano al actual (evita giros de 350°)
const nearAngle = (from, to) => {
  let t = to
  while (t - from > Math.PI) t -= Math.PI * 2
  while (t - from < -Math.PI) t += Math.PI * 2
  return t
}

/**
 * Personaje glTF con animaciones (Quaternius) y estados:
 * - Sentado: clip inicial (SitDown clampeado), gira suave hacia `yaw`,
 *   `sway` de tecleo y cadera anclada a `sitAt`.
 * - `tour`: {to:[x,z], face?:[x,z], pose?, pauseMs?, onDone} — se para, camina
 *   hasta `to`; allí celebra (pose 'Victory', default) o se queda un rato de
 *   pie (pose 'Idle' + pauseMs, para paseos); luego vuelve a su silla.
 * - colors: { [nombreMaterial]: '#hex' } recolorea (Skin/Hair/Face/Shirt...).
 * - children: se renderizan dentro del grupo (nametag/globos siguen al personaje).
 */
export default function Character3D({
  url = '/models/character.glb',
  clip = 'SitDown',
  once = true,
  sitAt = null,
  colors = null,
  sway = false,
  yaw = 0,
  tour = null,
  walkSpeed = 1.1,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  seat = null,
  children,
}) {
  const group = useRef()
  const hipsBone = useRef(null)
  // seated | chairOut | standup | walkTo | pose | pause | walkBack | sitdown | chairBack
  const phase = useRef('seated')
  const pauseLeft = useRef(0)
  const tourRef = useRef(null)
  const standPos = useRef(null)
  const home = useRef(position)
  // silla (grupo fijo, aparte del personaje que camina) + hacia dónde caminará:
  // al pararse, primero gira la silla a `walkYaw` y luego se levanta; al volver,
  // se sienta y recién ahí la silla gira de vuelta a la pantalla.
  const chairGroup = useRef()
  const walkYaw = useRef(0)
  // waypoints intermedios (`tour.via` = array de [x,z]): se recorren en orden a la
  // ida y en orden inverso a la vuelta, para esquivar escritorios. Índice de avance.
  const viaIdx = useRef(0)
  const backIdx = useRef(0)
  const { scene: source, animations } = useGLTF(url)
  // clon con esqueleto propio: permite usar el MISMO modelo en varios personajes
  const scene = useMemo(() => skeletonClone(source), [source])
  const { actions, names, mixer } = useAnimations(animations, group)

  useEffect(() => {
    scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
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
    const bones = []
    scene.traverse((o) => o.isBone && bones.push(o))
    hipsBone.current =
      bones.find((b) => /hip|pelvis/i.test(b.name)) ||
      bones.find((b) => /torso|spine|root/i.test(b.name)) ||
      bones[0] ||
      null
  }, [scene, colors])

  // reproduce un clip apagando los demás
  const play = (name, loop = false) => {
    const a = actions[name]
    if (!a) return null
    Object.values(actions).forEach((x) => {
      if (x !== a) x.fadeOut(0.18)
    })
    a.reset()
    if (loop) a.setLoop(LoopRepeat, Infinity)
    else {
      a.setLoop(LoopOnce, 1)
      a.clampWhenFinished = true
    }
    a.fadeIn(0.15).play()
    return a
  }

  // clip inicial (pose sentada)
  useEffect(() => {
    if (phase.current !== 'seated') return
    const name = clip && actions[clip] ? clip : names[0]
    const action = name ? actions[name] : null
    if (!action) return
    if (once) {
      action.setLoop(LoopOnce, 1)
      action.clampWhenFinished = true
    }
    action.reset().fadeIn(0.3).play()
    return () => action.fadeOut(0.2)
  }, [actions, names, clip, once])

  // arranque / cancelación del tour
  useEffect(() => {
    if (tour && phase.current === 'seated') {
      tourRef.current = tour
      viaIdx.current = 0
      backIdx.current = 0
      // punto "de pie": un pasito desde la silla hacia el centro de la sala
      const [hx, , hz] = home.current
      const len = Math.hypot(hx, hz) || 1
      standPos.current = [hx - (hx / len) * 0.45, hz - (hz / len) * 0.45]
      // hacia dónde caminará (primer punto del recorrido): la silla gira allí
      // ANTES de que el personaje se pare (la transición se dispara en useFrame).
      const first = tour.via?.[0] || tour.to
      walkYaw.current = first ? Math.atan2(first[0] - hx, first[1] - hz) : yaw
      phase.current = 'chairOut'
    } else if (!tour && tourRef.current && !['seated', 'sitdown', 'chairBack'].includes(phase.current)) {
      // tour cancelado: volver a casa de una
      group.current?.position.set(home.current[0], home.current[1], home.current[2])
      phase.current = 'sitdown'
      if (!play('SitDown')) phase.current = 'seated'
    }
  }, [tour])

  // transiciones cuando termina cada clip
  useEffect(() => {
    const onFinished = (e) => {
      const name = e.action.getClip()?.name
      if (phase.current === 'standup' && name === 'StandUp') {
        phase.current = 'walkTo'
        play('Walk', true)
      } else if (phase.current === 'pose' && name === (tourRef.current?.pose ?? 'Victory')) {
        phase.current = 'walkBack'
        play('Walk', true)
      } else if (phase.current === 'sitdown' && name === 'SitDown') {
        // ya sentado (mirando hacia donde venía); ahora la silla gira a la
        // pantalla (transición a 'seated' + onDone se cierran en useFrame).
        phase.current = 'chairBack'
      }
    }
    mixer.addEventListener('finished', onFinished)
    return () => mixer.removeEventListener('finished', onFinished)
  }, [mixer, actions])

  const tmpV = useRef(new Vector3())
  const tmpQ = useRef(new Quaternion())
  useFrame(({ clock }, dt) => {
    const g = group.current
    if (!g) return
    const ph = phase.current
    const k = Math.min(1, dt * 4)

    // Silla (grupo fijo en el puesto): gira hacia `walkYaw` mientras el personaje
    // está fuera, y hacia `yaw` (pantalla) cuando está sentado/volviendo. Aquí se
    // secuencia: chairOut termina cuando la silla mira la caminata → se para;
    // chairBack termina cuando la silla vuelve a la pantalla → cierra el tour.
    const cg = chairGroup.current
    if (cg) {
      const seatedLike = ph === 'seated' || ph === 'chairBack'
      const ct = seatedLike ? yaw : walkYaw.current
      cg.rotation.y = MathUtils.damp(cg.rotation.y, nearAngle(cg.rotation.y, ct), 3.5, dt)
      if (ph === 'chairOut' && Math.abs(nearAngle(cg.rotation.y, walkYaw.current) - cg.rotation.y) < 0.05) {
        phase.current = 'standup'
        if (!play('StandUp')) {
          phase.current = 'walkTo'
          play('Walk', true)
        }
      } else if (ph === 'chairBack' && Math.abs(nearAngle(cg.rotation.y, yaw) - cg.rotation.y) < 0.05) {
        phase.current = 'seated'
        const cb = tourRef.current?.onDone
        tourRef.current = null
        cb?.()
      }
    }

    // sentado, o girando con la silla (antes de pararse / después de sentarse):
    // el personaje sigue anclado a la silla y gira en el sitio.
    if (ph === 'seated' || ph === 'chairOut' || ph === 'chairBack') {
      const target = ph === 'chairOut' ? walkYaw.current : yaw
      g.rotation.y += (nearAngle(g.rotation.y, target) - g.rotation.y) * k
      const swayTarget = ph === 'seated' && sway ? Math.sin(clock.elapsedTime * 5) * 0.022 : 0
      g.rotation.x += (swayTarget - g.rotation.x) * 0.1
      if (!sitAt || !hipsBone.current) return
      hipsBone.current.getWorldPosition(tmpV.current)
      const delta = tmpV.current.set(sitAt[0] - tmpV.current.x, sitAt[1] - tmpV.current.y, sitAt[2] - tmpV.current.z)
      const parent = g.parent
      if (parent) {
        parent.getWorldQuaternion(tmpQ.current).invert()
        delta.applyQuaternion(tmpQ.current)
      }
      g.position.add(delta)
      return
    }

    g.rotation.x += (0 - g.rotation.x) * 0.1

    if (ph === 'sitdown') {
      // al llegar a su puesto, el personaje se voltea hacia la silla para sentarse
      g.rotation.y += (nearAngle(g.rotation.y, walkYaw.current) - g.rotation.y) * k
    }

    if (ph === 'standup') {
      // deslizarse del asiento al punto de pie mientras se incorpora
      g.position.x += (standPos.current[0] - g.position.x) * k
      g.position.z += (standPos.current[1] - g.position.z) * k
      g.position.y += (0 - g.position.y) * k
    } else if (ph === 'walkTo' || ph === 'walkBack') {
      // si el tour define `via` (lista de waypoints), se recorren en orden a la ida
      // y en orden inverso a la vuelta, esquivando escritorios; luego destino/casa.
      const via = tourRef.current?.via
      let t
      if (ph === 'walkTo') t = via && viaIdx.current < via.length ? via[viaIdx.current] : tourRef.current?.to
      else t = via && backIdx.current < via.length ? via[via.length - 1 - backIdx.current] : [home.current[0], home.current[2]]
      if (!t) return
      const dx = t[0] - g.position.x
      const dz = t[1] - g.position.z
      const d = Math.hypot(dx, dz)
      if (d < 0.06) {
        if (ph === 'walkTo' && via && viaIdx.current < via.length) {
          // llegó a un waypoint: avanzar al siguiente (sigue caminando)
          viaIdx.current += 1
        } else if (ph === 'walkBack' && via && backIdx.current < via.length) {
          // waypoint de la vuelta alcanzado: seguir al siguiente / a casa
          backIdx.current += 1
        } else if (ph === 'walkTo') {
          const pose = tourRef.current?.pose ?? 'Victory'
          if (pose === 'Idle' || tourRef.current?.pauseMs) {
            // pausa contemplativa (paseo): de pie un rato y de vuelta
            phase.current = 'pause'
            pauseLeft.current = (tourRef.current?.pauseMs ?? 3000) / 1000
            play('Idle', true)
          } else {
            phase.current = 'pose'
            if (!play(pose)) {
              phase.current = 'walkBack'
              play('Walk', true)
            }
          }
        } else {
          g.position.x = t[0]
          g.position.z = t[1]
          phase.current = 'sitdown'
          if (!play('SitDown')) {
            phase.current = 'seated'
            const cb = tourRef.current?.onDone
            tourRef.current = null
            cb?.()
          }
        }
      } else {
        const step = Math.min(d, walkSpeed * dt)
        g.position.x += (dx / d) * step
        g.position.z += (dz / d) * step
        const wyaw = Math.atan2(dx, dz)
        g.rotation.y += (nearAngle(g.rotation.y, wyaw) - g.rotation.y) * Math.min(1, dt * 8)
      }
    } else if (ph === 'pose' || ph === 'pause') {
      const f = tourRef.current?.face
      if (f) {
        const wyaw = Math.atan2(f[0] - g.position.x, f[1] - g.position.z)
        g.rotation.y += (nearAngle(g.rotation.y, wyaw) - g.rotation.y) * k
      }
      if (ph === 'pause') {
        pauseLeft.current -= dt
        if (pauseLeft.current <= 0) {
          phase.current = 'walkBack'
          play('Walk', true)
        }
      }
    }
  })

  return (
    <>
      {/* silla: grupo fijo en el puesto (no sigue al personaje que camina);
          su rotación la maneja useFrame para secuenciar parado/sentado */}
      {seat != null && (
        <group ref={chairGroup} position={position} rotation={[0, rotation[1] ?? 0, 0]}>
          {seat}
        </group>
      )}
      <group ref={group} position={position} rotation={rotation} scale={scale}>
        <primitive object={scene} />
        {children}
      </group>
    </>
  )
}
