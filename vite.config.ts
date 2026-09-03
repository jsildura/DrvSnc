import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Target 127.0.0.1, not localhost: wrangler dev binds workerd to IPv4 only
      // (--socket-addr=entry=127.0.0.1:8787), while Node resolves "localhost" to
      // ::1 first. Going through "localhost" leaves every /api call depending on
      // an IPv6 -> IPv4 fallback that adds latency and intermittently 502s.
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
