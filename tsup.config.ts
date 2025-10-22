import process from 'node:process';
import { defineConfig } from 'tsup';

const isDev = process.env.NODE_ENV === 'development';

export default defineConfig([
  // 避免与主构建中的dts生成重复
  {
    entry: ['src/types/**/*.ts'],
    outDir: 'dist/types',
    format: ['esm'],
    dts: {
      only: true,
      resolve: true,
    },
    clean: true, // 不清理目录，避免删除主构建生成的文件
  },
  // 主要的构建配置 - 编译主入口文件
  {
    entry: {
      index: 'src/index.ts',
      vite: 'src/vite/index.ts',
    },
    outDir: 'dist',
    format: ['esm'],
    dts: true,
    clean: true,
    // minify: !isDev,
    minify: false,
    sourcemap: isDev,
    external: ['vite', './types'],
  },
]);
