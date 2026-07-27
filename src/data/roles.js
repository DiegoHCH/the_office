// Catálogo de roles, avatares y su meta visual/ruteo (refactor #94).

// ── Catálogo de roles (visual + keywords). Nombres/activos vienen de la config ⚙️ ──
export const ROLE_META = {
  dev: {
    label: 'Dev',
    emoji: '⌨️',
    color: '#2dd4bf',
    hair: '#1f2937',
    url: '/models/pj/Casual_Male.gltf',
    kw: /arregla|implementa|refactoriza|codigo|\bbug\b/,
  },
  research: {
    label: 'Research',
    emoji: '🔍',
    color: '#6366f1',
    hair: '#f97316',
    url: '/models/pj/Casual_Female.gltf',
    kw: /investig|busca|analiza|compara|artifact|documenta/,
  },
  design: {
    label: 'UI/UX',
    emoji: '🎨',
    color: '#f472b6',
    hair: '#eab308',
    url: '/models/pj/Casual2_Male.gltf',
    kw: /disen|\bui\b|\bux\b|figma|pantalla|mockup|interfaz|estilo|layout|tipografia/,
  },
  qa: {
    label: 'QA',
    emoji: '🧪',
    color: '#f5a524',
    hair: '#3a8f5f',
    url: '/models/pj/Casual3_Male.gltf',
    kw: /\btest\b|\btests\b|prueba|regresion|\bqa\b|coverage|e2e|unitari/,
  },
  pr: {
    label: 'Revisor PR',
    emoji: '🔎',
    color: '#8b5cf6',
    hair: '#16181d', // pelo negro
    url: '/models/pj/Suit_Female.gltf',
    kw: /\bpr\b|\bprs\b|pull request|review|\bdiff\b|merge|mergea|pre-pr|g66-pr|review-pr|merge-hu/,
  },
  docs: {
    label: 'Docs',
    emoji: '📝',
    color: '#34d399',
    hair: '#8a5a33',
    url: '/models/pj/Doctor_Male_Young.gltf',
    kw: /\bdocs?\b|documentacion|readme|guia|manual|\badr\b/,
  },
  publish: {
    label: 'Publicador',
    emoji: '🚀',
    color: '#0ea5e9',
    hair: '#38bdf8', // pelo azul
    url: '/models/pj/BlueSoldier_Male.gltf',
    kw: /publica|publicar|pages|github pages|despliega|deploy|hostea|sube.*(artifact|web|pagina)/,
  },
}

export const MAX_ACTIVE = 6

// Roles predefinidos que NO se pueden eliminar (sync con main.js). Los demás
// built-ins (UI/UX, QA, Docs) y todos los custom sí se pueden borrar.
export const PROTECTED_ROLES = new Set(['dev', 'research', 'pr', 'publish'])
export const canDelete = (r) => r.custom || !PROTECTED_ROLES.has(r.id)

// Regex de ruteo a partir de palabras clave separadas por coma/espacio.
export const safeRegex = (s) => {
  const parts = String(s || '')
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return parts.length ? new RegExp(parts.join('|'), 'i') : null
}

// Meta visual/ruteo de un rol: los predefinidos usan ROLE_META; los personalizados
// llevan su meta inline (emoji/color/avatar/keywords) guardada en el propio rol.
export const metaOf = (r) =>
  ROLE_META[r.id] || {
    label: r.name || 'Rol',
    emoji: r.emoji || '🛠️',
    color: r.color || '#38bdf8',
    hair: r.hair || '#1f2937',
    url: `/models/pj/${r.avatar || 'Casual_Male.gltf'}`,
    kw: r.kw ? safeRegex(r.kw) : null,
  }

// Todos los personajes del pack (se excluyen accesorios y mascotas).
export const AVATARS = [
  'Casual_Male.gltf', 'Casual_Female.gltf', 'Casual2_Male.gltf', 'Casual2_Female.gltf',
  'Casual3_Male.gltf', 'Casual3_Female.gltf', 'Casual_Bald.gltf',
  'Suit_Male.gltf', 'Suit_Female.gltf', 'Worker_Male.gltf', 'Worker_Female.gltf',
  'Chef_Male.gltf', 'Chef_Female.gltf',
  'Doctor_Male_Young.gltf', 'Doctor_Female_Young.gltf', 'Doctor_Male_Old.gltf', 'Doctor_Female_Old.gltf',
  'OldClassy_Male.gltf', 'OldClassy_Female.gltf',
  'Cowboy_Male.gltf', 'Cowboy_Female.gltf', 'Kimono_Male.gltf', 'Kimono_Female.gltf',
  'Ninja_Male.gltf', 'Ninja_Female.gltf', 'Ninja_Sand.gltf', 'Ninja_Sand_Female.gltf',
  'Pirate_Male.gltf', 'Pirate_Female.gltf', 'Viking_Male.gltf', 'Viking_Female.gltf',
  'Knight_Male.gltf', 'Knight_Golden_Male.gltf', 'Knight_Golden_Female.gltf',
  'Soldier_Male.gltf', 'Soldier_Female.gltf', 'BlueSoldier_Male.gltf', 'BlueSoldier_Female.gltf',
  'Elf.gltf', 'Witch.gltf', 'Wizard.gltf', 'Goblin_Male.gltf', 'Goblin_Female.gltf',
  'Zombie_Male.gltf', 'Zombie_Female.gltf', 'BaseCharacter.gltf',
]
// "reporte-de-uso.html" → "Reporte de uso"
export const prettyArtifact = (f = '') => {
  const s = f.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : f
}
export const avatarLabel = (f) =>
  f.replace('.gltf', '').replace(/_/g, ' ').replace('Female', '♀').replace('Male', '♂')
