import uni from '@dcloudio/vite-plugin-uni';
import pagesJson from '@uni-ku/pages-json/vite';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    pagesJson({
      pageDir: 'pages',
      subPackageDirs: ['pages-sub'],
      debug: true,

      // ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓ 支持 vite-plugin-uni-platform 示例 ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓
      parsePagePath: ({ pagePath }) => pagePath.replace(/\..*$/, ''),
      filterPages: ({ filePath, platform }) => {
        const matched = filePath.match(/([^.]+)\.([^.]+)\.([^.]+)$/);
        return !matched || matched[2] === platform;
      },
      // ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑ 支持 vite-plugin-uni-platform 示例 ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑
    }),
    uni(),
  ],
});
