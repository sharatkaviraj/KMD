import path from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({ root: path.resolve(__dirname, '../academic-ui'), publicDir: false, resolve: { alias: { '@/app/(app)/timetable/vx-actions': path.resolve(__dirname, 'actions.ts'), '@': path.resolve(__dirname, '../../src'), 'next/navigation': path.resolve(__dirname, '../academic-ui/navigation.ts'), 'next/link': path.resolve(__dirname, '../academic-ui/link.tsx') } }, server: { host: '127.0.0.1', port: 3204, strictPort: true } });
