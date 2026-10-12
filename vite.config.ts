import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // cloudflare 플러그인은 자기 개발 서버를 만들어서 vitest(mode=test)와 충돌한다 → 테스트에서는 뺀다
  plugins: [react(), mode !== 'test' && cloudflare()],
  // maplibre-gl v6은 워커를 import.meta.url 기준 상대 경로로 찾는다. 사전 번들링하면 경로가 깨져서 뺀다
  optimizeDeps: { exclude: ['maplibre-gl'] },
}))
