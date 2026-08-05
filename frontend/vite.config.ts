import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build straight into the Frappe app's public folder.
//
// Asset names are FIXED (index.js / index.css) rather than hashed: the host
// page cache-busts with ?v=<mtime>, so a deploy is "scp two files" and there is
// no risk of shipping an index.html that points at a hash we forgot to copy.
export default defineConfig({
  plugins: [react()],
  base: '/assets/pipe_laying_inhouse/plm/',
  build: {
    outDir: '../pipe_laying_inhouse/public/plm',
    emptyOutDir: true,
    target: 'es2019',
    assetsInlineLimit: 8192,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: 'index-[name].js',
        assetFileNames: (info) => {
          const name = info.names?.[0] ?? '';
          if (name.endsWith('.css')) return 'index.css';
          return 'assets/[name][extname]';
        },
        manualChunks: undefined,
      },
    },
  },
});
