// Linter del proyecto (#117). Objetivo: atrapar lo que se cuela al editar a
// mano archivos de miles de líneas — variables sin usar, shadowing (el bug del
// `t` de i18n que tapaba a la función de traducción) y deps de hooks.
// Prettier queda configurado y disponible (`npm run format`) pero NO se pasa
// sobre el código existente ni lo exige el CI: reformatear todo movía 2.700
// líneas y reescribía el JSX denso de la escena 3D, donde las líneas largas
// (hasta 790 caracteres de primitivas) son deliberadas. eslint-config-prettier
// apaga igualmente las reglas de estilo para que ambos no se peleen.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default [
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'public/**'] },

  // Renderer: React en el navegador
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // el shadowing es el que nos mordió: una variable local llamada como una
      // importación (t, locale…) la tapa sin que nada avise
      'no-shadow': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // deps de hooks: aviso, no error — hay efectos que a propósito corren una
      // sola vez y ya están comentados en el código
      'react-hooks/exhaustive-deps': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }], // try/catch de localStorage
      // Reglas del React Compiler (react-hooks v7). No aplican a esta base:
      // react-three-fiber trabaja mutando el grafo de escena dentro de useFrame
      // (mesh.position.x += …) y usando relojes impuros, que es exactamente lo
      // que prohíben. Marcaban 43 errores en código que funciona a propósito así.
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },

  // Proceso principal y preload: Node + Electron
  {
    files: ['electron/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-shadow': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Tests: vitest inyecta sus globals
  {
    files: ['**/*.test.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  prettier,
]
