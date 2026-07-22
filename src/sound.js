// Sonidos sutiles sintetizados con WebAudio — sin archivos de audio.
let ctx = null
let enabled = true

const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)())

export const setSoundEnabled = (v) => {
  enabled = v
}

function tone(freq, dur, type = 'sine', gain = 0.045, when = 0) {
  if (!enabled) return
  try {
    const c = ac()
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, c.currentTime + when)
    g.gain.linearRampToValueAtTime(gain, c.currentTime + when + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur)
    o.connect(g)
    g.connect(c.destination)
    o.start(c.currentTime + when)
    o.stop(c.currentTime + when + dur + 0.05)
  } catch {
    /* audio no disponible: silencio */
  }
}

export const popSound = () => tone(520, 0.09, 'triangle') // mensaje enviado
export const dingSound = () => {
  tone(660, 0.12, 'sine')
  tone(990, 0.18, 'sine', 0.04, 0.09) // tarea terminada
}
export const buzzSound = () => tone(160, 0.25, 'sawtooth', 0.03) // error
