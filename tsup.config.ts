import process from 'node:process';
import { defineConfig } from 'tsup';

const isDev = process.env.NODE_ENV === 'development';

export default defineConfig((opt) => {
  return [
    {
      entry: {
        index: 'src/index.ts',
        vite: 'src/vite.ts',
        hooks: 'src/hooks.ts',
      },
      format: ['cjs', 'esm'],
      dts: true,
      clean: true,
      sourcemap: opt.sourcemap || isDev,
      external: ['vite', '@uni-ku/pages-json/types'],
    },
  ];
});
