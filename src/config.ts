import type { BuiltInPlatform } from '@uni-helper/uni-env';
import path from 'node:path';
import process from 'node:process';
import { enableDebug } from './utils/debug';

export interface UserConfig {

  /**
   * 项目根目录
   * @default vite 的 `root` 属性
   */
  root?: string;

  /**
   * 源码目录，pages.json 放置的目录
   * @default "src"
   */
  src?: string;

  /**
   * pages 基于项目根目录的相对路径或绝对路径
   * @default 'src/pages'
   */
  pageDir?: string;

  /**
   * subPackages 基于项目根目录的相对路径或绝对路径
   * @default []
   */
  subPackageDirs?: string[];

  /**
   * 排除条件，应用于 pages 和 subPackages 的文件
   * @default ['node_modules', '.git', '** /__*__/ **']
   */
  excludes?: string[];

  /**
   * 为页面路径生成 TypeScript 声明
   * 接受基于项目根目录的相对路径或绝对路径
   * false 则取消生成
   * @default "src/pages.d.ts"
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
  const {
    root = process.env.UNI_CLI_CONTEXT || process.cwd(),
    src = process.env.UNI_INPUT_DIR || 'src',
    dts = true,
    pageDir = path.join('src', 'pages'),
    subPackageDirs = [],
    excludes = ['node_modules', '.git', '**/__*__/**'],
    debug = false,
    parsePagePath = ({ pagePath }) => pagePath,
    filterPages = () => true,
  } = useConfig;

  enableDebug(debug);

  const absSRC = path.isAbsolute(src) ? src : path.resolve(root, src);
  const absPageDir = path.isAbsolute(pageDir) ? pageDir : path.resolve(root, pageDir);
  const absSubPackageDirs = subPackageDirs.map((dir) => {
    return path.isAbsolute(dir) ? dir : path.resolve(root, dir);
  });

  return {
    root,
    src: absSRC,
    pageDir: absPageDir,
    subPackageDirs: absSubPackageDirs,
    excludes,
    dts: dts === true ? path.join(root, 'src', 'pages.d.ts') : dts,
    debug,
    parsePagePath,
    filterPages,
  };
}
