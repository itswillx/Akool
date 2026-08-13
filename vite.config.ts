import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // escuta em 0.0.0.0 — acessível pelo celular na mesma rede
    port: 5173,
  },
  test: {
    environment: 'node',
  },
  optimizeDeps: {
    include: ['@excalidraw/excalidraw'],
  },
  build: {
    commonjsOptions: {
      include: [/excalidraw/, /node_modules/],
    },
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Sem regra para @excalidraw de propósito: forçá-lo num manual chunk fazia o
          // rolldown fundir ali dentro dependências compartilhadas (tslib, usado também
          // por @supabase/*), e com isso o bundle de 4.7 MB virava import ESTÁTICO do
          // chunk do supabase — ou seja, baixado no boot do app. Deixando o code splitting
          // automático agir, o Excalidraw fica só nos chunks assíncronos que o importam
          // (DiagramCanvas, DrawingCanvas, usePdfExport).
          if (id.includes('@blocknote') || id.includes('@mantine') || id.includes('prosemirror')) return 'editor'
          if (id.includes('@xyflow')) return 'xyflow'
          if (id.includes('jspdf')) return 'pdf'
          if (id.includes('pdfjs-dist')) return 'pdfjs'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('react-router')) return 'router'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
        },
      },
    },
  },
  assetsInclude: ['**/*.woff2', '**/*.woff'],
})
