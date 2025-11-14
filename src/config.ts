import type { BuiltInPlatform } from '@uni-helper/uni-env';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { enableDebug } from './utils/debug';

export interface UserConfig {
  /**
   * 项目根目录
   * @default process.env.UNI_CLI_CONTEXT || process.cwd()
   */
  root?: string;

  /**
   * 源码目录，pages.json 放置的目录
   * @default process.env.UNI_INPUT_DIR || path.resolve(root, 'src') || root
   */
  src?: string;

  /**
   * pages 绝对路径或基于 UNI_INPUT_DIR 的相对路径
   * @default 'pages'
   */
  pageDir?: string;

  /**
   * subPackages 绝对路径或基于 UNI_INPUT_DIR 的相对路径
   * @default []
   */
  subPackageDirs?: string[];

  /**
   * 排除条件，应用于 pages 和 subPackages 的文件
   * @default ['node_modules', '.git', '** /__*__/ **']
   */
  exclude?: string[];

  /**
   * 为页面路径生成 TypeScript 声明
   * 绝对路径或基于 UNI_INPUT_DIR 的相对路径
   * false 则取消生成
   * @default "pages.d.ts"
   */
  dts?: string | boolean;

  /**
   * 显示调试
   * @default false
   */
  debug?: boolean | 'info' | 'error' | 'debug' | 'warn';
  /**
   * 对页面路径的再处理
   * @returns page path 页面路径
   */
  parsePagePath?: (opt: { filePath: string; pagePath: string }) => string;

  /**
   * 过滤、修改 pages 的页面文件信息
   */
  filterPages?: (opt: { filePath: string; platform: BuiltInPlatform }) => boolean;
}

export interface ResolvedConfig extends Required<UserConfig> {}

export function resolveConfig(useConfig: UserConfig): ResolvedConfig {
  let {
    root = process.env.UNI_CLI_CONTEXT || process.cwd(),
    src = process.env.UNI_INPUT_DIR,
    dts = true,
    pageDir = path.join('src', 'pages'),
    subPackageDirs = [],
    exclude = ['node_modules', '.git', '**/__*__/**'],
    debug = false,
    parsePagePath = ({ pagePath }) => pagePath,
    filterPages = () => true,
  } = useConfig;

  if (!src) {
    const maybe = path.resolve(root, 'src');
    src = fs.existsSync(maybe) ? maybe : root;
  }

  enableDebug(debug);

  const absPageDir = path.isAbsolute(pageDir) ? pageDir : path.resolve(src, pageDir);
  const absSubPackageDirs = subPackageDirs.map((dir) => {
    return path.isAbsolute(dir) ? dir : path.resolve(src, dir);
  });

  return {
    root,
    src,
    pageDir: absPageDir,
    subPackageDirs: absSubPackageDirs,
    exclude,
    dts: dts === true ? path.join(src, 'pages.d.ts') : dts,
    debug,
    parsePagePath,
    filterPages,
  };
}
