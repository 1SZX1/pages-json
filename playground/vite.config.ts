import uni from '@dcloudio/vite-plugin-uni';
import uniPagesJson from '@uni-ku/pages-json/vite';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    uniPagesJson({
      pages: 'src/pages',
      subPackages: ['src/pages-sub'],
      debug: true,
    }),
    uni(),
  ],
});
