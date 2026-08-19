import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Кабинет живёт подпутём: наружу открыт один порт 80 (как диспетчерская и админка)
  base: '/operator/',
  plugins: [react()],
  server: { port: 5176 },
  preview: { port: 5176 },
});
