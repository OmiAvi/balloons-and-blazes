import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      'devserver-main--balloons-and-blazes.netlify.app',
      'balloons-and-blazes.netlify.app'
    ]
  }
});
