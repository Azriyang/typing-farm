import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5180,
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      // 编辑器/工具链的原子写入会在目录里留下临时文件，Windows 上 watcher 会 EBUSY 崩溃
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/node_modules/**', '**/dist/**']
    }
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0
  }
});
