// Catálogos curados (skills, MCP) y presentación de tools (refactor #94).

// Catálogo curado de skills de Claude Code (repo oficial anthropics/skills).
// Se instalan en el CLAUDE_CONFIG_DIR del perfil: los agentes headless las
// cargan solos y las usan cuando la tarea lo amerita.
export const SKILL_CATALOG = [
  { id: 'frontend-design', repo: 'anthropics/skills', name: 'Frontend Design', desc: 'Interfaces web con criterio de diseño — evita el look genérico al crear UIs nuevas', roles: ['design'] },
  { id: 'canvas-design', repo: 'anthropics/skills', name: 'Canvas Design', desc: 'Piezas visuales (posters, banners, mockups) con composición y tipografía cuidadas', roles: ['design'] },
  { id: 'web-artifacts-builder', repo: 'anthropics/skills', name: 'Web Artifacts Builder', desc: 'Apps web de un solo archivo más ricas e interactivas', roles: ['design', 'dev'] },
  { id: 'theme-factory', repo: 'anthropics/skills', name: 'Theme Factory', desc: 'Temas visuales consistentes (paleta, tipografía) para aplicar a lo que se crea', roles: ['design'] },
  { id: 'webapp-testing', repo: 'anthropics/skills', name: 'Webapp Testing', desc: 'Prueba interfaces reales en un navegador (Playwright)', roles: ['qa'] },
  { id: 'docx', repo: 'anthropics/skills', name: 'Documentos Word', desc: 'Crear y editar .docx con formato profesional', roles: ['docs'] },
  { id: 'pdf', repo: 'anthropics/skills', name: 'PDF', desc: 'Generar y manipular PDFs (formularios, unir, extraer)', roles: ['docs'] },
  { id: 'pptx', repo: 'anthropics/skills', name: 'Presentaciones', desc: 'Crear .pptx con layouts y estilos consistentes', roles: ['docs'] },
  { id: 'xlsx', repo: 'anthropics/skills', name: 'Hojas de cálculo', desc: 'Crear y analizar .xlsx con fórmulas y gráficos', roles: ['docs'] },
  { id: 'mcp-builder', repo: 'anthropics/skills', name: 'MCP Builder', desc: 'Construir servidores MCP bien estructurados', roles: ['dev'] },
  { id: 'skill-creator', repo: 'anthropics/skills', name: 'Skill Creator', desc: 'Crear tus propias skills a medida', roles: ['dev'] },
]
export const ROLE_TAGS = { design: '🎨 UI/UX', qa: '🧪 QA', docs: '📚 Docs', dev: '💻 Dev', research: '🔎 Research' }

// Catálogo curado de servidores MCP (por perfil, scope user).
export const MCP_CATALOG = [
  { id: 'playwright', name: 'Playwright', desc: 'El agente maneja un navegador real: navegar, clicks, screenshots — QA de interfaces vivas', roles: ['qa', 'design'], cmd: ['npx', '@playwright/mcp@latest'] },
  { id: 'chrome-devtools', name: 'Chrome DevTools', desc: 'Consola, red y rendimiento de Chrome — depurar el front como un humano', roles: ['dev', 'qa'], cmd: ['npx', 'chrome-devtools-mcp@latest'] },
  { id: 'context7', name: 'Context7', desc: 'Documentación al día de librerías y frameworks, directo al contexto del agente', roles: ['dev'], cmd: ['npx', '-y', '@upstash/context7-mcp'] },
  { id: 'figma', name: 'Figma', desc: 'Lee tus diseños de Figma — ⚠️ en plan gratis solo 6 usos/mes; para uso real pide seat Dev/Full de pago (y autenticarse una vez con /mcp)', roles: ['design'], url: 'https://mcp.figma.com/mcp' },
  { id: 'nano-banana', name: 'Nano Banana 🍌', desc: 'Genera y edita imágenes con Gemini — 500 imágenes/día GRATIS con tu API key de Google AI Studio (se pide al conectar, sin tarjeta)', roles: ['design'], cmd: ['npx', '-y', '@mindstone/mcp-server-nano-banana'], needsEnv: 'GEMINI_API_KEY' },
  // recomendaciones manuales: solo aparecen en el listado con su guía — el
  // usuario los configura por su cuenta (instaladores propios, registries…)
  { id: 'engram', name: 'Engram 🧠', desc: 'Memoria de largo plazo compartida del squad: lo aprendido queda buscable entre sesiones y proyectos (MIT; local gratis, hosted con tier gratis). Se instala con su propio setup', roles: ['dev', 'research', 'qa'], manual: true, link: 'https://engram.tools' },
  { id: 'shadcn', name: 'shadcn Registry', desc: 'El agente busca e instala componentes UI de registries (shadcn/ui, Cult UI free…) directo en proyectos React/Tailwind — gratis; los registries premium quedan fuera', roles: ['design', 'dev'], manual: true, link: 'https://ui.shadcn.com/docs/registry/mcp' },
]

// Cómo se muestra cada herramienta de Claude en pantalla.
export const TOOL_INFO = {
  Read: ['📖', 'Leyendo archivos'],
  Glob: ['🔍', 'Buscando archivos'],
  Grep: ['🔍', 'Buscando en el código'],
  WebSearch: ['🌐', 'Buscando en la web'],
  WebFetch: ['🌐', 'Consultando la web'],
  Bash: ['💻', 'Ejecutando comandos'],
  Edit: ['✍️', 'Editando código'],
  Write: ['✍️', 'Escribiendo archivos'],
  Task: ['🤖', 'Delegando a un agente'],
  TodoWrite: ['📝', 'Organizando sus tareas'],
}
export const toolInfo = (name) => TOOL_INFO[name] || ['🔧', `Usando ${name}`]
