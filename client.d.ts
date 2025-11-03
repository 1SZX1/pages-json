/// <reference types="./global" />

// 声明虚拟模块
declare module 'virtual:pages-json' {
  import type { PagesJson } from '@uni-ku/pages-json/types';

  const pagesJson: PagesJson;
  export default pagesJson;
}
