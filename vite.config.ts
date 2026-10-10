import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', testTimeout: 120000, include: ['src/**/*.test.ts'] },   // backend/ has its own tests
});
