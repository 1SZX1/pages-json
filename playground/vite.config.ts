import uni from '@dcloudio/vite-plugin-uni';
import uniPagesJson from '@uni-ku/pages-json/vite';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    uniPagesJson({
      pageDir: 'src/pages',
      subPackageDirs: ['src/pages-sub'],
      debug: true,
    }),
    uni(),
  ],
});
