import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// On a production build (GitHub Pages project site) assets are served from
// /Bob-the-builder/. In dev we serve from the root so `npm run dev` stays clean.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Bob-the-builder/' : '/',
  plugins: [react()],
}))
