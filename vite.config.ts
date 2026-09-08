// import react, { reactCompilerPreset } from '@vitejs/plugin-react'
// import babel from '@rolldown/plugin-babel'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // plugins: [
  //   react(),
  //   babel({ presets: [reactCompilerPreset()] }),
  // ],
  plugins: [
    react({ compiler: true }),
  ],
  server: {
    watch: {
      ignored: ['**/.direnv/**'],
    },
  },
})
