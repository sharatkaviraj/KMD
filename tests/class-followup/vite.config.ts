import path from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  root: __dirname,
  plugins: [{
    name: 'class-followup-synthetic-actions', enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return;
      const resolved = path.resolve(path.dirname(importer), source);
      const actions = ['../../src/vx/screens/teach/actions', '../../src/vx/screens/notes/actions', '../../src/vx/shell/view-as-actions'];
      if (actions.some(file => resolved === path.resolve(__dirname, file) || resolved === path.resolve(__dirname, `${file}.ts`))) return path.resolve(__dirname, 'actions.ts');
    },
  }],
  resolve: { alias: {
    '@/vx/screens/teach/actions': path.resolve(__dirname, 'actions.ts'),
    '@/vx/screens/notes/actions': path.resolve(__dirname, 'actions.ts'),
    '@/app/(app)/preferences/actions': path.resolve(__dirname, 'actions.ts'),
    '@/vx/shell/view-as-actions': path.resolve(__dirname, 'actions.ts'),
    '@': path.resolve(__dirname, '../../src'),
    'next/navigation': path.resolve(__dirname, '../mobile-ui/navigation.ts'),
    'next/link': path.resolve(__dirname, '../mobile-ui/link.tsx'),
    'next/image': path.resolve(__dirname, '../mobile-ui/image.tsx'),
  } },
  build: { outDir: '../../../evidence/class-followup-static', emptyOutDir: false, rollupOptions: { input: path.resolve(__dirname, 'class-followup.html') } },
  server: { host: '127.0.0.1', port: 3211, strictPort: true },
});
