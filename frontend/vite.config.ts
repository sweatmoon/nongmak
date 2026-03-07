import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.sandbox.novita.ai',
      '.e2b.dev',
    ],
    cors: true,
    proxy: {
      // /api/* → http://localhost:8000/* (프록시로 CORS 우회)
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        // 바이너리 응답(ZIP) 스트리밍도 처리
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // Content-Disposition 헤더 그대로 전달
            if (proxyRes.headers['content-disposition']) {
              proxyRes.headers['content-disposition'] =
                proxyRes.headers['content-disposition']
            }
          })
        },
      },
    },
  },
})
