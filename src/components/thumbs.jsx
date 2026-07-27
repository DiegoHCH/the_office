// Miniaturas: avatar 3D del roster y adjuntos de imagen (refactor #94).
import { useEffect, useState } from 'react'
import { getAvatarThumb } from '../scene/avatarThumbs.js'

// Miniatura 3D de un avatar (se genera una vez y queda en caché).
export function AvatarThumb({ file }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let on = true
    getAvatarThumb(file).then((u) => on && setSrc(u))
    return () => {
      on = false
    }
  }, [file])
  return src ? <img src={src} alt="" draggable={false} /> : <div className="thumb-loading">⏳</div>
}

// Miniatura de una imagen adjunta (data URL vía IPC); click → lightbox.
export function AttThumb({ att, onZoom }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let on = true
    window.oficina?.imageData?.(att.path).then((r) => {
      if (on && r?.ok) setSrc(r.data)
    })
    return () => {
      on = false
    }
  }, [att.path])
  if (!src) return <span>🖼 {att.name}</span>
  return <img className="att-thumb" src={src} alt={att.name} title={`${att.name} — click para ampliar`} onClick={() => onZoom(src)} />
}
