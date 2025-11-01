import type { BuiltInPlatform } from '@uni-helper/uni-env';
import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { SFCDescriptor } from '@vue/compiler-sfc';
import type { Context } from './context';
import type { DeepPartial } from './types';
import fs from 'node:fs/promises';
import path, { extname } from 'node:path';
import * as t from '@babel/types';
import { platform as currentPlatform } from '@uni-helper/uni-env';
import { parse as VueParser } from '@vue/compiler-sfc';
import { babelParse, isCallOf } from 'ast-kit';
import { normalizePath } from 'vite';
import { generate as babelGenerate } from './utils/babel';
import { debug } from './utils/debug';
import { parseCode } from './utils/parser';

export interface PathSet {
  rel: string;
  abs: string;
}

export interface UserTabBarItem extends DeepPartial<PagesJSON.TabBarItem> {
  /**
   * 配置tabbar路径
   * @deprecated 无效，将会根据文件路径自动生成
   */
  pagePath?: string;

  /**
   * 排序，数值越小越靠前
   */
  index?: number;
};

export interface UserPageMeta extends DeepPartial<PagesJSON.Page> {

  /**
   * 标识 page 类型
   */
  type?: 'page' | 'home';

  /**
   * 配置页面路径
   * @deprecated 无效，将会根据文件路径自动生成
   */
  path?: string;

  /**
   * 配置 tabbar 属性
   */
  tabbar?: UserTabBarItem;
}

export const PAGE_TYPE_KEY = Symbol.for('page_type');
export const TABBAR_INDEX_KEY = Symbol.for('tabbar_index');

export interface Position {
  start: number;
  end: number;
}

export interface MacroInfo {
  imports: t.ImportDeclaration[];
  ast: t.CallExpression;
  loc: Position; // 代码位置，包括 definePage() 函数。
  code: string; // definePage 的参数的代码
  preparedCode: string; // 预处理后的代码，可直接用于解析。
}

export class PageFile {
  readonly ctx: Context;
  readonly file: PathSet;
  readonly uri: string;

  private changed = true;

  /** 上次的 definePage 参数的代码 */
  private lastCode: string = '';

  /** platform => page meta */
  private metas: Map<BuiltInPlatform, UserPageMeta> = new Map();

  private content: string = '';
  private sfc?: SFCDescriptor;
  private macro?: MacroInfo;

  /**
   * 页面文件的扩展名
   */
  public static readonly exts = ['.vue', '.nvue', '.uvue'];

  constructor(ctx: Context, filepath: string) {
    this.ctx = ctx;
    this.file = path.isAbsolute(filepath)
      ? {
          abs: filepath,
          rel: path.relative(ctx.cfg.root, filepath),
        }
      : {
          abs: path.join(ctx.cfg.root, filepath),
          rel: filepath,
        };
    this.uri = normalizePath(this.file.rel.replace(extname(this.file.rel), ''));
  }

  public async getPage({ platform = currentPlatform, forceRead = false }: { platform?: BuiltInPlatform; forceRead?: boolean } = {}): Promise<PagesJSON.Page> {

    if (forceRead || !this.content) {
      await this.read();
    }
    if (!this.metas.has(platform)) {
      await this.parsePageMeta({ platform });
    }

    const { tabbar: _, path, type, ...others } = this.metas.get(platform) || {};

    return {
      path: path || this.uri,
      ...others,
      [PAGE_TYPE_KEY]: type || 'page',
    } as PagesJSON.Page;
  }

  public async getTabbarItem({ platform = currentPlatform, forceRead = false }: { platform?: BuiltInPlatform; forceRead?: boolean } = {}): Promise<PagesJSON.TabBarItem | undefined> {
    if (forceRead || !this.content) {
      await this.read();
    }
    if (!this.metas.has(platform)) {
      await this.parsePageMeta({ platform });
    }

    const { tabbar } = this.metas.get(platform) || {};
    if (tabbar === undefined) {
      return;
    }

    const { index, pagePath, ...others } = tabbar;

    return {
      pagePath: pagePath || this.uri,
      ...others,
      [TABBAR_INDEX_KEY]: index,
    };
  }

  public hasChanged() {
    return this.changed;
  }

  /**
   * 读取文件，并解析数据
   */
  public async read(): Promise<void> {
    // content
    this.content = await fs.readFile(this.file.abs, { encoding: 'utf-8' }).catch(() => '');

    // sfc
    this.sfc = (
      VueParser(this.content, {
        pad: 'space',
        filename: this.file.abs,
      }).descriptor
      // for @vue/compiler-sfc ^2.7
      || (VueParser as any)({
        source: this.content,
        filename: this.file.abs,
      })
    );

    const sfcScript = this.sfc.scriptSetup || this.sfc.script;
    if (!sfcScript) {
      return;
    }

    const ast = babelParse(sfcScript.content, sfcScript.lang || 'js', {
      plugins: [['importAttributes', { deprecatedAssertSyntax: true }]],
    });

    // imports
    const imports: t.ImportDeclaration[] = [];
    for (const stmt of ast.body) {
      if (t.isImportDeclaration(stmt)) {
        imports.push(stmt);
      }
    }

    // macro
    let macro: t.CallExpression | undefined;

    for (const stmt of ast.body) {
      let node: t.Node = stmt;
      if (stmt.type === 'ExpressionStatement') {
        node = stmt.expression;
      }

      if (isCallOf(node, 'definePage')) {
        macro = node;
        break;
      }
    }

    if (!macro) {
      return;
    }

    // 提取 macro function 内的第一个参数
    const [arg1] = macro.arguments;

    // 检查 macro 的参数是否正确
    if (arg1 && !t.isFunctionExpression(arg1) && !t.isArrowFunctionExpression(arg1) && !t.isObjectExpression(arg1)) {
      debug.warn(`definePage() 参数仅支持函数或对象：${this.file.rel}`);
      return;
    }

    // 缓存 macro code，避免每次生成代码
    const code = babelGenerate(arg1).code;
    const preparedCode = ([
      ...imports.map(imp => babelGenerate(imp).code),
      `export default ${code}`,
    ]).join('\n');

    this.macro = {
      imports,
      ast: macro,
      loc: {
        start: macro.start! + sfcScript.loc.start.offset,
        end: macro.end! + sfcScript.loc.start.offset,
      },
      code,
      preparedCode,
    };

    this.changed = this.lastCode !== code;
    if (this.changed) {
      // 如果有更改，则清空 metas
      this.metas.clear();
    }

    this.lastCode = code;
  }

  public async parsePageMeta({ platform = currentPlatform }: { platform?: BuiltInPlatform } = {}): Promise<UserPageMeta | undefined> {

    if (!this.macro) {
      this.metas.delete(platform);
      return undefined;
    }

    const env: Record<string, any> = {
      UNI_PLATFORM: platform,
    };

    const parsed = await parseCode({
      code: this.macro.preparedCode,
      filename: this.file.abs,
      env,
    });

    const meta = typeof parsed === 'function'
      ? await Promise.resolve(parsed({ t: (meta: UserPageMeta) => meta, platform }))
      : await Promise.resolve(parsed);

    this.metas.set(platform, meta);

    this.changed = false; // 已经更新过 page meta, 可以将 changed 标记置为 false

    return meta;
  }

  public async getMacroInfo(forceRead = false): Promise<MacroInfo | undefined> {
    if (forceRead || !this.content) {
      await this.read();
    }

    return this.macro;
  }

}

export function getPageType(page: PagesJSON.Page): 'page' | 'home' {
  return page[PAGE_TYPE_KEY as any] || 'page';
}

export function getTabbarIndex(tabbarItem: PagesJSON.TabBarItem): number {
  return tabbarItem[TABBAR_INDEX_KEY as any] || 0;
}
