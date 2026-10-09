import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // maplibre-gl v6은 워커를 import.meta.url 기준 상대 경로로 찾는다. 사전 번들링하면 경로가 깨져서 뺀다
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
