import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = env.API_PORT || '4200'

  return {
    plugins: [react()],
    root: 'client',
    server: {
      port: parseInt(env.PORT || '4201'),
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    build: {
      outDir: '../dist/client',
    },
  }
})
