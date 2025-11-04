import type { definePage as DefinePage } from '@uni-ku/pages-json';

// 全局声明 definePage 函数，使得用户无需导入即可使用
declare global {
  const definePage: typeof DefinePage;
}
