// Documentos que genera el squad: dónde viven, abrirlos, revelarlos, exportar
// y borrar. Sale de main.js porque es un grupo con una responsabilidad clara y
// una regla propia que conviene tener a la vista en un solo sitio: nada se abre,
// se exporta ni se borra fuera de la carpeta del perfil que lo pide.
//
// Los ayudantes se reciben en vez de importarse: `getArtifactsDir` lo usa
// también la persona de los agentes, así que su sitio sigue siendo main.js.
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { ipcMain, dialog, shell, BrowserWindow } = require('electron')
const { rutaContenida } = require('../lib/core.js')

function registra({ getArtifactsDir, artifactsDirFile, ventana }) {
  const win = () => ventana()
  ipcMain.handle('artifacts:getDir', (_e, profile) => getArtifactsDir(profile))

  // Un documento solo se abre, revela, exporta o borra si está DENTRO de la
  // carpeta del perfil que lo pide. Antes bastaba con que la ruta existiera, así
  // que la separación dependía de que el renderer pidiera la lista correcta.
  function dentroDeArtifacts(file, profile) {
    try {
      return rutaContenida(getArtifactsDir(profile), file) && fs.existsSync(file)
    } catch {
      return false
    }
  }
  // La carpeta elegida vale solo para el perfil actual: si se guardara global,
  // los documentos volverían a mezclarse.
  ipcMain.handle('artifacts:pickDir', async (_e, profile) => {
    const res = await dialog.showOpenDialog(win(), { properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || !res.filePaths[0]) return { ok: false }
    // sin esto, un disco lleno o sin permisos rechazaba la promesa y el renderer
    // no lo capturaba: elegías carpeta, no pasaba nada y nadie decía por qué
    try {
      fs.writeFileSync(artifactsDirFile(profile || 'work'), res.filePaths[0])
    } catch (err) {
      return { ok: false, error: String(err.message || err).slice(0, 250) }
    }
    return { ok: true, dir: res.filePaths[0] }
  })
  ipcMain.handle('artifacts:list', (_e, profile) => {
    const dir = getArtifactsDir(profile)
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.html'))
        .map((f) => {
          const st = fs.statSync(path.join(dir, f))
          return { name: f, path: path.join(dir, f), at: st.mtimeMs }
        })
        .sort((a, b) => b.at - a.at)
    } catch {
      return []
    }
  })
  ipcMain.handle('artifacts:open', (_e, file, profile) => {
    if (!dentroDeArtifacts(file, profile)) return { ok: false }
    const w = new BrowserWindow({ width: 1000, height: 780, backgroundColor: '#ffffff', title: path.basename(file) })
    w.loadFile(file)
    // El visor local se queda en el archivo; links externos dentro del artifact van al navegador.
    w.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
    w.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('file://')) {
        e.preventDefault()
        shell.openExternal(url)
      }
    })
    return { ok: true }
  })
  // Revela el artifact en Finder (seleccionado).
  ipcMain.handle('artifacts:reveal', (_e, file, profile) => {
    if (!dentroDeArtifacts(file, profile)) return { ok: false }
    require('electron').shell.showItemInFolder(file)
    return { ok: true }
  })
  // Exporta el artifact + su carpeta assets/ en un .zip para compartir.
  ipcMain.handle('artifacts:zip', async (_e, file, profile) => {
    if (!dentroDeArtifacts(file, profile)) return { ok: false }
    const base = path.basename(file, path.extname(file))
    const res = await dialog.showSaveDialog(win(), { defaultPath: `${base}.zip` })
    if (res.canceled || !res.filePath) return { ok: false }
    const dir = path.dirname(file)
    // incluye el .html y, si existe, la carpeta assets/ (imágenes descargadas)
    const items = [path.basename(file)]
    if (fs.existsSync(path.join(dir, 'assets'))) items.push('assets')
    return new Promise((resolve) => {
      execFile('zip', ['-r', '-q', res.filePath, ...items], { cwd: dir }, (err) => {
        resolve(err ? { ok: false, error: err.message } : { ok: true, path: res.filePath })
      })
    })
  })

  // Borra un documento (a la papelera, no destrucción directa: se puede recuperar
  // desde Finder si fue un error). Pide confirmación antes.
  ipcMain.handle('artifacts:delete', async (_e, file, profile) => {
    if (!dentroDeArtifacts(file, profile)) return { ok: false }
    const res = await dialog.showMessageBox(win(), {
      type: 'warning',
      buttons: ['Cancelar', 'Mover a la papelera'],
      defaultId: 0,
      cancelId: 0,
      message: `¿Borrar «${path.basename(file)}»?`,
      detail: 'Se mueve a la papelera del sistema, así que se puede recuperar desde Finder.',
    })
    if (res.response !== 1) return { ok: false, canceled: true }
    try {
      await shell.trashItem(file)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

module.exports = { registra }
