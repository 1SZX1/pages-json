import type { BuiltInPlatform } from '@uni-helper/uni-env';
import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { Context } from './context';
import fs from 'node:fs';
import path from 'node:path';
import { platform as currentPlatform } from '@uni-helper/uni-env';
import { parseCode } from './utils/parser';

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
  private jsons: Map<BuiltInPlatform, PagesJSON.PagesJson> = new Map();

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
  public async getJson({ platform = currentPlatform, forceRead = false }: { platform?: BuiltInPlatform; forceRead?: boolean } = {}): Promise<PagesJSON.PagesJson | undefined> {
    if (forceRead || !this.code) {
      await this.read();
    }

    if (!this.path || !this.code) {
      return;
    }

    const json = this.jsons.get(platform);
    if (json) {
      return json;
    }

    const env: Record<string, any> = {
      UNI_PLATFORM: platform.toLowerCase(),
    };

    const parsed = await parseCode({
      code: this.code,
      filename: this.path,
      env,
    });

    const res = typeof parsed === 'function'
      ? await Promise.resolve(parsed({ t: (json: PagesJSON.PagesJson) => json, platform }))
      : await Promise.resolve(parsed);

    this.jsons.set(platform, res);

    this.changed = false; // 已经更新过 page meta, 可以将 changed 标记置为 false

    return res;
  }

  /**
   * 检查动态 pages.json 文件的位置
   *
   * @returns 绝对路径 | undefined
   */
  public detectFilePath(): string | undefined {
    for (const filepath of DynamicPagesJson.possibleFilePaths(this.ctx.cfg.root, this.ctx.cfg.src)) {
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

  public static readonly basename = 'pages.json';
  public static readonly exts = ['.ts', '.mts', '.cts', '.js', '.cjs', '.mjs'];
  public static possibleFilePaths(rootDir: string, ...baseDirs: string[]): string[] {
    const dirs = [rootDir];

    for (const baseDir of baseDirs) {
      const sub = path.resolve(rootDir, baseDir);
      if (sub !== rootDir) {
        dirs.push(sub);
      }
    }

    const paths: string[] = [];

    for (const dir of dirs) {
      for (const ext of DynamicPagesJson.exts) {
        paths.push(path.join(dir, DynamicPagesJson.basename + ext));
      }
    }

    return paths;
  }

  public static isValid(filepath: string, rootDir: string, ...baseDirs: string[]): boolean {
    return DynamicPagesJson.possibleFilePaths(rootDir, ...baseDirs).includes(filepath);
  }

}
