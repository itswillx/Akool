import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
          if (id.includes('@excalidraw')) return 'excalidraw'
          if (id.includes('@blocknote') || id.includes('@mantine') || id.includes('prosemirror')) return 'editor'
          if (id.includes('@xyflow')) return 'xyflow'
          if (id.includes('jspdf')) return 'pdf'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('react-router')) return 'router'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
        },
      },
    },
  },
  assetsInclude: ['**/*.woff2', '**/*.woff'],
})
