import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' para que los archivos compilados carguen vía file:// dentro de Electron.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
})
