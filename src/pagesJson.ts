import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { Context } from './context';
import type { DeepPartial, MaybePromise } from './types';
import fs from 'node:fs';
import { Condition } from './condition';
import * as condition from './condition';
import { deepCopy } from './utils/object';
import { parseCode } from './utils/parser';
import { currentPlatform, type UniPlatform } from './utils/uni-env';

export interface DefineConfigFuncArgs {
  define: (p: DeepPartial<PagesJSON.PagesJson>) => Condition<DeepPartial<PagesJSON.PagesJson>>;
  platform: UniPlatform;
}

export type DefineConfigArg = DeepPartial<PagesJSON.PagesJson> | ((a: DefineConfigFuncArgs) => MaybePromise<DeepPartial<PagesJSON.PagesJson>>);

export function defineConfig(userConfig: DefineConfigArg): DefineConfigArg {
  return userConfig;
}

function define(userConfig: DefineConfigArg): Condition<DeepPartial<PagesJSON.PagesJson>> {
  return new Condition(userConfig);
}

export class DynamicPagesJson {

  private ctx: Context;

  /**
   * 动态 pages.json 文件路径
   */
  public path = '';
  /**
   * 动态 pages.json 文件内容
   */
  private code = '';
  /**
   * 上次动态 pages.json 文件内容
   */
  private lastCode = '';
  /**
   * 文件是否有改动
   * @default true
   */
  private changed = true;
  /**
   * json 内容
   */
  private jsons = new Map<UniPlatform, PagesJSON.PagesJson>();

  private condition: Condition<DeepPartial<PagesJSON.PagesJson>> | undefined;

  static readonly basename = 'pages.json';
  static readonly exts = ['.ts', '.mts', '.cts', '.js', '.cjs', '.mjs'];

  public constructor(ctx: Context) {
    this.ctx = ctx;
  }

  /**
   * @returns 是否有更改
   */
  public hasChanged(): boolean {
    return this.changed;
  }

  /**
   * 读取动态 pages.json 文件
   */
  public async read(): Promise<void> {
    if (!this.path) {
      const filepath = this.detectFilePath();
      if (!filepath) {
        return;
      }
      this.path = filepath;
    }

    this.code = await fs.promises.readFile(this.path, { encoding: 'utf-8' }).catch(() => '');

    this.changed = this.code !== this.lastCode;
    this.lastCode = this.code;

    if (this.changed) {
      this.jsons.clear();
    }
  }

  /**
   * 获取动态 pages.json 解析后的 json
   */
  public async getJson({ platform = currentPlatform(), forceRead = false }: { platform?: UniPlatform; forceRead?: boolean } = {}): Promise<PagesJSON.PagesJson | undefined> {
    if (forceRead || !this.code) {
      await this.read();
    }

    if (!this.path || !this.code) {
      return;
    }

    // 使用闭包，如果闭包内有错误，会直接往上抛错误，不会执行后面的代码
    const res = await (async () => {
      const json = deepCopy(this.jsons.get(platform));
      if (json) {
        return json;
      }

      if (this.condition !== undefined) {
        const json = condition.get(this.condition, platform);
        if (json) {
          this.jsons.set(platform, json as PagesJSON.PagesJson);
          return deepCopy(json) as PagesJSON.PagesJson;
        }
      }

      const env: Record<string, any> = {
        UNI_PLATFORM: platform,
      };

      const parsed = await parseCode({
        code: this.code,
        filename: this.path,
        env,
      });

      const res = typeof parsed === 'function'
        ? await Promise.resolve(parsed({ define, platform } as DefineConfigFuncArgs))
        : await Promise.resolve(parsed);

      let obj: PagesJSON.PagesJson;
      if (condition.is(res)) {
        this.condition = res;

        obj = condition.get(res, platform);
      } else {
        this.condition = undefined;
        obj = res;
      }

      this.jsons.set(platform, obj);
      return obj;
    })();

    // 上面执行无错误才会到这里

    this.changed = false; // 已经更新过 page meta, 可以将 changed 标记置为 false

    return res;
  }

  /**
   * 检查动态 pages.json 文件的位置
   *
   * @returns 绝对路径 | undefined
   */
  public detectFilePath(): string | undefined {
    for (const filepath of this.ctx.possibleDynamicJsonFilePaths()) {
      try {
        const stat = fs.statSync(filepath);
        if (stat && stat.isFile()) {
          return filepath;
        }
      } catch {
        continue;
      }
    }
  }

  public async getPlatforms(): Promise<UniPlatform[]> {
    await this.getJson();
    if (this.condition) {
      return condition.getPlatforms(this.condition);
    }
    return [];
  }
}
