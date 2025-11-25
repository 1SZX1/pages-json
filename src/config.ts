import type { BuiltInPlatform } from '@uni-helper/uni-env';
import type { PageFileOption } from './pageFile';
import type { MaybePromise } from './types';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { enableDebug } from './utils/debug';

export interface ConfigHook {
  /**
   * 获取页面路径
   * @param filePath - 文件路径
   * @param pagePath - 页面路径
   * @returns page path 页面路径
   */
  parsePageOption?: (opt: PageFileOption) => MaybePromise<PageFileOption>;
  /**
   * 过滤、修改 pages 的页面文件信息
   */
  filterPages?: (platform: BuiltInPlatform, opts: PageFileOption[]) => MaybePromise<PageFileOption[]>;
}

export interface UserConfig {
  /**
   * 项目根目录
   * @default process.env.UNI_CLI_CONTEXT || process.cwd()
   */
  root?: string;

  /**
   * 源码目录
   * pages.json 放置的目录
   * @default process.env.UNI_INPUT_DIR || path.resolve(root, 'src') || root
   */
  src?: string;

  /**
   * pages 绝对路径或基于源码目录的相对路径
   * @default 'pages'
   */
  pageDir?: string;

  /**
   * subPackages 绝对路径或基于源码目录的相对路径
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
   * 绝对路径或基于源码目录的相对路径
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
   * 钩子
   */
  hooks?: ConfigHook[];
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
    hooks = [],
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
    hooks,
  };
}
