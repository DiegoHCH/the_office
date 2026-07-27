// Catálogos curados (skills, MCP) y presentación de tools (refactor #94).
// Los textos visibles salen del diccionario (#103) vía getters, así siguen al
// idioma elegido sin duplicar los catálogos.
import { t } from '../lib/i18n.js'

// Plantillas de arranque: se siembran UNA vez por perfil (si nunca guardó
// ninguna) para mostrar el patrón — incluidas las {{variables}}. Borrables.
export const seedSnippets = () => [
  { name: 'revisar-pr', text: t('snip.seed.reviewPr') },
  { name: 'explica-error', text: t('snip.seed.explainError') },
  { name: 'resume-cambios', text: t('snip.seed.summarize') },
  { name: 'plan-feature', text: t('snip.seed.planFeature') },
]

// Catálogo curado de skills de Claude Code (repo oficial anthropics/skills).
// Se instalan en el CLAUDE_CONFIG_DIR del perfil: los agentes headless las
// cargan solos y las usan cuando la tarea lo amerita.
export const SKILL_CATALOG = [
  { id: 'frontend-design', repo: 'anthropics/skills', name: 'Frontend Design', get desc() { return t('skill.frontend-design') }, roles: ['design'] },
  { id: 'canvas-design', repo: 'anthropics/skills', name: 'Canvas Design', get desc() { return t('skill.canvas-design') }, roles: ['design'] },
  { id: 'web-artifacts-builder', repo: 'anthropics/skills', name: 'Web Artifacts Builder', get desc() { return t('skill.web-artifacts-builder') }, roles: ['design', 'dev'] },
  { id: 'theme-factory', repo: 'anthropics/skills', name: 'Theme Factory', get desc() { return t('skill.theme-factory') }, roles: ['design'] },
  { id: 'webapp-testing', repo: 'anthropics/skills', name: 'Webapp Testing', get desc() { return t('skill.webapp-testing') }, roles: ['qa'] },
  { id: 'docx', repo: 'anthropics/skills', get name() { return t('skill.docx.name') }, get desc() { return t('skill.docx') }, roles: ['docs'] },
  { id: 'pdf', repo: 'anthropics/skills', name: 'PDF', get desc() { return t('skill.pdf') }, roles: ['docs'] },
  { id: 'pptx', repo: 'anthropics/skills', get name() { return t('skill.pptx.name') }, get desc() { return t('skill.pptx') }, roles: ['docs'] },
  { id: 'xlsx', repo: 'anthropics/skills', get name() { return t('skill.xlsx.name') }, get desc() { return t('skill.xlsx') }, roles: ['docs'] },
  { id: 'mcp-builder', repo: 'anthropics/skills', name: 'MCP Builder', get desc() { return t('skill.mcp-builder') }, roles: ['dev'] },
  { id: 'skill-creator', repo: 'anthropics/skills', name: 'Skill Creator', get desc() { return t('skill.skill-creator') }, roles: ['dev'] },
]
export const ROLE_TAGS = { design: '🎨 UI/UX', qa: '🧪 QA', docs: '📚 Docs', dev: '💻 Dev', research: '🔎 Research' }

// Catálogo curado de servidores MCP (por perfil, scope user).
export const MCP_CATALOG = [
  { id: 'playwright', name: 'Playwright', get desc() { return t('srv.playwright') }, roles: ['qa', 'design'], cmd: ['npx', '@playwright/mcp@latest'] },
  { id: 'chrome-devtools', name: 'Chrome DevTools', get desc() { return t('srv.chrome-devtools') }, roles: ['dev', 'qa'], cmd: ['npx', 'chrome-devtools-mcp@latest'] },
  { id: 'context7', name: 'Context7', get desc() { return t('srv.context7') }, roles: ['dev'], cmd: ['npx', '-y', '@upstash/context7-mcp'] },
  { id: 'figma', name: 'Figma', get desc() { return t('srv.figma') }, roles: ['design'], url: 'https://mcp.figma.com/mcp' },
  { id: 'nano-banana', name: 'Nano Banana 🍌', get desc() { return t('srv.nano-banana') }, roles: ['design'], cmd: ['npx', '-y', '@mindstone/mcp-server-nano-banana'], needsEnv: 'GEMINI_API_KEY' },
  // recomendaciones manuales: solo aparecen en el listado con su guía — el
  // usuario los configura por su cuenta (instaladores propios, registries…)
  { id: 'engram', name: 'Engram 🧠', get desc() { return t('srv.engram') }, roles: ['dev', 'research', 'qa'], manual: true, link: 'https://engram.tools' },
  { id: 'shadcn', name: 'shadcn Registry', get desc() { return t('srv.shadcn') }, roles: ['design', 'dev'], manual: true, link: 'https://ui.shadcn.com/docs/registry/mcp' },
]

// Cómo se muestra cada herramienta de Claude en pantalla.
const TOOL_ICONS = {
  Read: '📖', Glob: '🔍', Grep: '🔍', WebSearch: '🌐', WebFetch: '🌐',
  Bash: '💻', Edit: '✍️', Write: '✍️', Task: '🤖', TodoWrite: '📝',
}
export const toolInfo = (name) =>
  TOOL_ICONS[name] ? [TOOL_ICONS[name], t(`tool.${name}`)] : ['🔧', t('tool.other', { name })]

// Mascotas disponibles (#89): modelos animados de Quaternius (CC0) con las
// mismas animaciones — Walk, Idle, Eating — así todas se comportan igual.
export const PETS = [
  { id: 'Fox', get label() { return t('pet.Fox') }, height: 0.55 },
  { id: 'Shiba', get label() { return t('pet.Shiba') }, height: 0.5 },
  { id: 'Husky', get label() { return t('pet.Husky') }, height: 0.58 },
  { id: 'Wolf', get label() { return t('pet.Wolf') }, height: 0.62 },
  { id: 'Deer', get label() { return t('pet.Deer') }, height: 0.85 },
  { id: 'Alpaca', get label() { return t('pet.Alpaca') }, height: 0.9 },
]
