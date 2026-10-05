import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev (npm run dev), /api is proxied to the API on localhost:3000.
// In the container, nginx does the same proxying.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
