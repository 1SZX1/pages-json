import process from 'node:process';
import { enableDebug } from './utils/debug';

export interface UserConfig {

  /**
   * 项目根目录
   * @default vite 的 `root` 属性
   */
  root?: string;

  /**
   * pages.json 的相对目录
   * @default "src"
   */
  src?: string;

  /**
   * 为页面路径生成 TypeScript 声明
   * 接受相对项目根目录的路径
   * false 则取消生成
   * @default "pages.d.ts"
   */
  dts?: string | boolean;

  /**
   * pages的相对路径
   * @default 'src/pages'
   */
  pageDir?: string;

  /**
   * subPackages的相对路径
   * @default []
   */
  subPackageDirs?: string[];

  /**
   * 排除条件，应用于 pages 和 subPackages 的文件
   * @default ['node_modules', '.git', '** /__*__/ **']
   */
  excludes?: string[];

  /**
   * 显示调试
   * @default false
   */
  debug?: boolean | 'info' | 'error' | 'debug' | 'warn';
}

export interface ResolvedConfig extends Required<UserConfig> {}

export function resolveConfig(useConfig: UserConfig): ResolvedConfig {
  const {
    root = process.cwd(),
    src = 'src',
    dts = true,
    pageDir = 'src/pages',
    subPackageDirs = [],
    excludes = ['node_modules', '.git', '**/__*__/**'],
    debug = false,
  } = useConfig;

  enableDebug(debug);

  return {
    root,
    dts: dts === true ? 'pages.d.ts' : dts,
    pageDir,
    subPackageDirs,
    src,
    excludes,
    debug,
  };
}
