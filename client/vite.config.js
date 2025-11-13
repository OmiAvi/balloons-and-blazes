import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",   // ADD THIS
    proxy: {
      "/api": "http://10.136.158.26:4000", // UPDATE THIS to your LAN IP
    },
  },
});

