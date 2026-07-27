import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' para que los archivos compilados carguen vía file:// dentro de Electron.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // El bundle rondaba 1.5MB en un solo archivo (#105). Separar las librerías
    // pesadas en chunks propios deja que el navegador las cachee aparte y que
    // el HTML pinte antes; la escena 3D además carga en diferido.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'],
          markdown: ['react-markdown', 'remark-gfm'],
          hljs: ['highlight.js/lib/core'],
        },
      },
    },
  },
})
