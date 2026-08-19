import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Панель живёт подпутём: наружу открыт один порт 80,
  // отдельные порты режет NSG
  base: '/dispatch/',
  plugins: [react()],
  server: { port: 5174 },
});
