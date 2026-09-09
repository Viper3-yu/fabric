import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const carbonCdnFontFace =
  /@font-face\s*\{[^{}]*https:\/\/1\.www\.s81c\.com\/common\/carbon\/plex\/fonts\/[^{}]*\}/g;

function stripCarbonCdnFonts() {
  return {
    name: 'strip-carbon-cdn-fonts',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.replace(/\\/g, '/').includes('/@carbon/styles/css/styles.css')) {
        return null;
      }

      const bundled = code.replace(carbonCdnFontFace, '');
      return bundled === code ? null : bundled;
    },
  };
}

export default defineConfig({
  plugins: [stripCarbonCdnFonts(), react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'carbon-vendor': ['@carbon/react', '@carbon/icons-react'],
          'motion-vendor': ['gsap', 'gsap/ScrollTrigger', '@gsap/react'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/lianyun-org2-api': {
        target: 'http://127.0.0.1:8082',
        rewrite: (path) => path.replace(/^\/lianyun-org2-api/, '/api'),
      },
      '/lianyun-api': {
        target: 'http://127.0.0.1:8080',
        rewrite: (path) => path.replace(/^\/lianyun-api/, '/api'),
      },
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
