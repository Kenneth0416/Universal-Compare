import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const apiServerPort = env.API_SERVER_PORT || process.env.API_SERVER_PORT || '3001';
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.XAI_API_KEY': JSON.stringify(env.XAI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: `http://localhost:${apiServerPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
