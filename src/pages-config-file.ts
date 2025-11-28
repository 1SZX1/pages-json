import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { Condition } from './condition';
import type { ResolvedConfig } from './config';
import type { DeepPartial, MaybePromise } from './types';
import fs from 'node:fs';
import path from 'node:path';
import { Cond } from './condition';
import * as condition from './condition';
import { deepCopy } from './utils/object';
import { parseCode } from './utils/parser';
import { currentPlatform, type UniPlatform } from './utils/uni-env';

export interface DefineConfigFuncArgs {
  define: (p: DeepPartial<PagesJSON.PagesJson>) => Cond<DeepPartial<PagesJSON.PagesJson>>;
  platform: UniPlatform;
}

export type DefineConfigArg = DeepPartial<PagesJSON.PagesJson> | ((a: DefineConfigFuncArgs) => MaybePromise<DeepPartial<PagesJSON.PagesJson>>);

export function defineConfig(userConfig: DefineConfigArg): DefineConfigArg {
  return userConfig;
}

function define(userConfig: DefineConfigArg): Cond<DeepPartial<PagesJSON.PagesJson>> {
  return new Cond(userConfig);
}

export class PagesConfigFile {

  private cfg: ResolvedConfig;

  /**
   * 文件路径
   */
  public path = '';

  /**
   * 文件内容
   */
  private code = '';

  /**
   * 上次文件内容
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

  /**
   * 条件编译内容
   */
  private condition: Condition<DeepPartial<PagesJSON.PagesJson>> | undefined;

  static readonly basename = 'pages.json';
  static readonly exts = ['.ts', '.mts', '.cts', '.js', '.cjs', '.mjs'];

  public constructor(config: ResolvedConfig) {
    this.cfg = config;

    this.detectFilePath();
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
      return;
    }

    this.code = await fs.promises.readFile(this.path, { encoding: 'utf-8' }).catch(() => '');

    this.changed = this.code !== this.lastCode;
    this.lastCode = this.code;

    if (this.changed) {
      this.jsons.clear();
    }
  }

  /**
   * 获取解析后的 json
   */
  public async getJson(platform = currentPlatform(), forceRead = false): Promise<PagesJSON.PagesJson | undefined> {
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
        const json = this.condition.get(platform);
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
        this.condition = condition.unwrap(res);
        obj = this.condition.get(platform) as PagesJSON.PagesJson;
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
   * 获取运行平台
   */
  public async getPlatforms(): Promise<UniPlatform[]> {
    await this.getJson(); // 保证读取了文件
    if (this.condition) {
      return this.condition.getPlatforms();
    }
    return [];
  }

  /**
   * 检查是否合格的文件路径
   */
  public isValid(filepath: string): boolean {
    const abspath = path.isAbsolute(filepath)
      ? filepath
      : path.resolve(this.cfg.root, filepath);

    return this.cfg.pagesJsonFilePaths.includes(abspath);
  }

  /**
   * 清除缓存
   */
  public fresh() {
    this.code = '';
    this.changed = true;
    this.condition = undefined;
    this.jsons.clear();
  }

  /**
   * 检测文件位置
   *
   */
  private detectFilePath() {
    const detect = () => {
      for (const filepath of this.cfg.pagesJsonFilePaths) {
        try {
          const stat = fs.statSync(filepath);
          if (stat && stat.isFile()) {
            return filepath;
          }
        } catch {
          continue;
        }
      }
    };

    this.path = detect() || '';
  }

}
