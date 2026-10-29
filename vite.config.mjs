import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The IDE's files were written for Create React App, which allows JSX in .js
export default defineConfig({
  plugins: [react({ include: /\.(js|jsx)$/ })],
  esbuild: { loader: 'jsx', include: /src\/.*\.js$/, exclude: [] },
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  server: { port: 5180, strictPort: true },
});
