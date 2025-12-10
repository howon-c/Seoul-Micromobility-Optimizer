import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/omelet': {
        target: 'https://routing.oaasis.cc',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/omelet/, '/api')
      },
      '/api/inavi': {
        target: 'https://dev-maps.inavi.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/inavi/, '')
      }
    }
  }
})

