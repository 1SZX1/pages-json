// 全局声明 definePage 函数，使得用户无需导入即可使用
declare global {
  const definePage: typeof import('./dist').definePage;
}

export {}; // 确保文件被当作模块处理
