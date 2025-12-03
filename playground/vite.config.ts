import uni from '@dcloudio/vite-plugin-uni';
import { hookUniPlatform } from '@uni-ku/pages-json/hooks';
import pagesJson from '@uni-ku/pages-json/vite';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    pagesJson({
      pageDir: 'pages',
      subPackageDirs: ['pages-sub'],
      debug: 'debug',
      hooks: [hookUniPlatform],
      platform: ['mp-weixin', 'mp-360', 'h5'],
    }),
    uni(),
  ],
});
