import process from 'node:process';
import { defineConfig } from 'tsup';

const isDev = process.env.NODE_ENV === 'development';

export default defineConfig([
  {
    entry: [
      'src/vite/index.ts',
      'src/index.ts',
    ],
    format: ['cjs', 'esm'],
    dts: {
      resolve: true,
    },
    clean: true,
    sourcemap: isDev,
    external: ['vite', '@uni-ku/pages-json/types'],
  },
]);
