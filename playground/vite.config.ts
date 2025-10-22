import uni from '@dcloudio/vite-plugin-uni';
import { viteUniPagesJson } from '@uni-ku/pages-json';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    viteUniPagesJson({
      pages: 'src/pages',
      subPackages: ['src/pages-sub'],
      debug: true,
    }),
    uni(),
  ],
});
