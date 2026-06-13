import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  return {
    plugins: [react()],
    define: isBuild ? {
      // Prevent baking localhost:3001 into production assets
      'import.meta.env.VITE_API_URL': 'undefined'
    } : {},
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false
        }
      }
    }
  }
})
