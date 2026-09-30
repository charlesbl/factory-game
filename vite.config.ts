import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const developmentUrlPlugin: Plugin = {
  name: 'factory-development-url',
  configureServer(server) {
    server.httpServer?.once('listening', () => {
      server.config.logger.info(
        '\n  ➜  LAN/VPN HTTPS: https://factory-dev.crashkiller.ovh/',
      );
    });
  },
};

export default defineConfig({
  plugins: [react(), developmentUrlPlugin],
  build: { target: 'es2024' },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: ['factory-dev.crashkiller.ovh'],
    ws: {
      protocol: 'wss',
      host: 'factory-dev.crashkiller.ovh',
      clientPort: 443,
    },
  },
});
