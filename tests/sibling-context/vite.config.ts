import path from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  root: __dirname, publicDir: false,
  plugins: [{ name: 'sibling-synthetic-view-as', enforce: 'pre', resolveId(source, importer) {
    if (source === './view-as-actions' && importer?.replace(/\\/g, '/').endsWith('/src/vx/shell/sidebar.tsx')) return path.resolve(__dirname, 'actions.ts');
  } }],
  resolve: { alias: {
    '@/vx/screens/admin/student-document-actions': path.resolve(__dirname, '../mobile-ui/student-actions.ts'),
    '@/app/(app)/school-office/actions': path.resolve(__dirname, '../shared/school-office-action-adapters.ts'),
    '@/app/(app)/teach/tasks/actions': path.resolve(__dirname, '../shared/sampark-action-adapters.ts'),
    '@/app/(app)/collection/photos/profile-actions': path.resolve(__dirname, '../shared/sampark-action-adapters.ts'),
    '@/vx/screens/notes/actions': path.resolve(__dirname, 'actions.ts'),
    '@/vx/screens/family-contact/actions': path.resolve(__dirname, 'actions.ts'),
    '@/app/(app)/preferences/actions': path.resolve(__dirname, 'actions.ts'),
    '@': path.resolve(__dirname, '../../src'),
    'next/navigation': path.resolve(__dirname, '../operations-admin/navigation.ts'),
    'next/link': path.resolve(__dirname, '../operations-admin/link.tsx'),
    'next/image': path.resolve(__dirname, '../mobile-ui/image.tsx'),
  } },
  build: { outDir: '../../../evidence/sibling-context-static', emptyOutDir: false },
  server: { host: '127.0.0.1', port: 3221, strictPort: true },
});
