import process from 'node:process';
import { defineConfig } from 'tsup';

const isDev = process.env.NODE_ENV === 'development';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      vite: 'src/vite.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: isDev,
    external: ['vite', '@uni-ku/pages-json/types'],
  },
  {
    entry: [
      'types/**/*.ts',
    ],
    outDir: 'dist/types',
    format: ['esm'],
    dts: {
      resolve: true,
      only: true,
    },
    clean: true,
  },
  // {
  //   entry: [
  //     'client',
  //   ],
  //   outDir: 'dist',
  //   format: 'esm',
  //   dts: {
  //     resolve: true,
  //     only: true,
  //   },
  //   // clean: true,
  // },
]);
