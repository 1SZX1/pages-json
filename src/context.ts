import type { BuiltInPlatform } from '@uni-helper/uni-env';
import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { CommentToken } from 'comment-json';
import type { ResolvedConfig } from './config';
import type { DeepPartial } from './types';
import fs from 'node:fs';
import path from 'node:path';
import { platform as currentPlatform } from '@uni-helper/uni-env';
import { parse as cjParse, stringify as cjStringify } from 'comment-json';
import fg from 'fast-glob';
import { writeDeclaration } from './declaration';
import { getPageType, getTabbarIndex, PageFile } from './pageFile';
import { debug } from './utils/debug';
import { checkFileSync, writeFileWithLock } from './utils/file';
import { deepAssign } from './utils/object';
import { parseCode } from './utils/parser';

interface JsonFileInfo {
  platforms: Map<BuiltInPlatform, number>;
  indent: string;
  eof: string;
  data: PagesJSON.PagesJson; // 由于有条件编译，会有重复 key，数据失真
}

export class Context {

  /** Map<filepath, PageFile> */
  public files = new Map<string, PageFile>();

  /** Map<filepath, Page> */
  public pages = new Map<string, PageFile>();
  /** Map<root, Map<filepath, Page>> */
  public subPackages = new Map<string, Map<string, PageFile>>();

  public readonly cfg: ResolvedConfig;

  /**
   * 页面文件的扩展名
   */
  public readonly pageFileExts = ['.vue', '.nvue', '.uvue'];
  /**
   * 静态 pages.json 的文件路径
   */
  public readonly pagesJsonPath: string;
  /**
   * 全局动态 pages.json 可用的文件后缀
   */
  public readonly globalPagesJsonExts = ['.ts', '.mts', '.cts', '.js', '.cjs', '.mjs'];
  /**
   * 全局动态 pages.json 可用的绝对文件路径
   */
  public readonly globalPagesJsonFilePaths: string[];

  private lastPagesJson = '';
  private jsonFileInfo?: JsonFileInfo;

  constructor(config: ResolvedConfig) {
    this.cfg = config;

    this.pagesJsonPath = path.join(this.cfg.src, 'pages.json');
    this.globalPagesJsonFilePaths = this.getGlobalPagesJsonFilePaths('pages.json');
  }

  /**
   * 扫描文件
   */
  public scanFiles(): void {

    const files = new Map<string, PageFile>();
    const pages = new Map<string, PageFile>();

    // pages
    this.listFiles(this.cfg.pageDir, {
      cwd: this.cfg.root,
      ignore: this.cfg.excludes,
    }).forEach((f) => {
      debug.debug(`pages: ${f}`);

      const page = this.pages.get(f) || new PageFile(this, f);
      pages.set(f, page);
      files.set(f, page);
    });

    // subPackages
    const subPackages = new Map<string, Map<string, PageFile>>();
    for (const dir of this.cfg.subPackageDirs) {
      const subPages = new Map<string, PageFile>();

      const root = path.basename(dir);

      this.listFiles(dir, {
        cwd: this.cfg.root,
        ignore: this.cfg.excludes,
      }).forEach((f) => {
        debug.debug(`subPackages: ${f}`);

        const page = this.subPackages.get(root)?.get(f) || new PageFile(this, f);
        subPages.set(f, page);
        files.set(f, page);
      });

      subPackages.set(root, subPages);
    }

    this.pages = pages;
    this.subPackages = subPackages;
    this.files = files;
  }

  /**
   * 更新pages.json
   *
   * @param filepath 指定更新的文件，空则更新所有文件
   */
  public async updatePagesJSON(filepath?: string): Promise<boolean> {
    if (filepath) {
      const file = this.getPageFile(filepath);
      if (file) {
        await file.read();
        if (!file.hasChanged()) {
          debug.info(`文件 ${filepath} 的 page meta 无改动，跳过更新。`);
          return false;
        }
      }
    }

    this.checkPagesJsonFileSync();
    await this.detectPagesJsonFile(true);

    const pagesJson = (await this.getGlobalPagesJson() || {});

    await this.scanFiles();

    const { platforms } = this.jsonFileInfo!;

    await this.generatePages(pagesJson, platforms);
    await this.generateSubPackages(pagesJson, platforms);
    await this.generateTabbar(pagesJson, platforms);

    this.sortPagesJson(pagesJson);

    if (this.cfg.dts) {
      await writeDeclaration(pagesJson, this.cfg.dts as string);
    }

    return this.writePagesJson(pagesJson);
  }

  /**
   * vite 的虚拟路径
   *
   */
  public async virtualModule() {

    const pagesJson = (await this.getGlobalPagesJson() || {});

    await this.generatePages(pagesJson);
    await this.generateSubPackages(pagesJson);
    await this.generateTabbar(pagesJson);

    this.sortPagesJson(pagesJson);

    return `export default ${JSON.stringify(pagesJson, null, 2)}\n`;
  }

  /**
   * 检查是否合格的页面文件
   */
  public isValidPageFile(filepath: string): boolean {
    return this.pageFileExts.some(ext => filepath.endsWith(ext));
  }

  public isValidGlobalPagesJsonFile(filepath: string): boolean {
    return this.globalPagesJsonFilePaths.includes(filepath);
  }

  public checkPagesJsonFileSync(): boolean {
    return checkFileSync({
      path: this.pagesJsonPath,
      newContent: JSON.stringify({ pages: [{ path: '' }] }, null, 4),
      modeFlag: fs.constants.R_OK | fs.constants.W_OK,
    });
  }

  /**
   * 检测静态 pages.json 文件
   */
  private async detectPagesJsonFile(forceUpdate = false): Promise<JsonFileInfo> {
    if (!forceUpdate && this.jsonFileInfo) {
      return this.jsonFileInfo;
    }

    const detect = async () => {
      const res = {
        platforms: new Map<BuiltInPlatform, number>(),
        indent: ' '.repeat(4),
        eof: '\n',
        data: {} as PagesJSON.PagesJson,
      };

      const content = await fs.promises.readFile(this.pagesJsonPath, { encoding: 'utf-8' }).catch(() => '');
      if (!content) {
        return res;
      }

      try {
        res.data = cjParse(content) as PagesJSON.PagesJson;
        const comments = res.data[Symbol.for('before-all') as any] as CommentToken[];
        for (const comment of comments || []) {
          if (comment.value.startsWith(' GENERATED BY @uni-ku/pages-json, PLATFORM:')) {
            const pfs = comment.value.split(':')[1].split('||');
            for (const pf of pfs) {
              const [p, t] = pf.trim().split('@');
              if (!p) {
                continue;
              }
              const now = Date.now();
              const ts = t ? Number(t) : Date.now();
              if (ts < now - 10_000) {
                continue; // 舍弃超过 3 秒的 platform
              }

              res.platforms.set(p as BuiltInPlatform, ts);
            }
          }
        }

        res.indent = ' '.repeat(detectIndent(content));

        const lastChar = content[content.length - 1];
        if (lastChar === '\n') {
          res.eof = '\n';
        } else {
          res.eof = '';
        }

        return res;

      } catch {
        return res;
      }
    };

    this.jsonFileInfo = await detect();

    return this.jsonFileInfo;
  }

  private sortPagesJson(pagesJson: PagesJSON.PagesJson) {
    // 排序：pages 中 home 页面在开头
    if (pagesJson.pages) {
      pagesJson.pages.sort((a, b) => {
        if (getPageType(a) === 'home') {
          if (getPageType(b) === 'home') {
            return 0;
          } else {
            return -1;
          }
        } else if (getPageType(b) === 'home') {
          return 1;
        } else {
          return 0;
        }
      });
    }

    // 排序：tabbar 配置项按照顺序排列
    if (pagesJson.tabBar && pagesJson.tabBar.list) {
      pagesJson.tabBar.list.sort((a, b) => getTabbarIndex(a) - getTabbarIndex(b));
    }
  }

  private async generatePages(pagesJson: PagesJSON.PagesJson, platforms: Map<BuiltInPlatform, number> = new Map()): Promise<void> {

    pagesJson.pages = pagesJson.pages || [];

    for (const [_, pf] of this.pages) {
      const page = await pf.getPage();
      for (const [platform] of platforms) {
        const platformPage = await pf.getPage({ platform });
        mergePlatformItems(currentPlatform, page, platform, platformPage);
      }

      const idx = pagesJson.pages.findIndex(p => p.path === page.path);
      if (idx !== -1) {
        deepAssign(pagesJson.pages[idx], page);
      } else {
        pagesJson.pages.push(page);
      }

    }

  }

  private async generateSubPackages(pagesJson: PagesJSON.PagesJson, platforms: Map<BuiltInPlatform, number> = new Map()): Promise<void> {

    if (this.subPackages.size > 0) {
      // subPackages 大于 0 才进行，避免错误创建空的 subPackages
      pagesJson.subPackages = pagesJson.subPackages || [];
      for (const [root, subPackage] of this.subPackages) {
        for (const [_, pf] of subPackage) {
          const page = await pf.getPage();
          for (const [platform] of platforms) {
            const platformPage = await pf.getPage({ platform });
            mergePlatformItems(currentPlatform, page, platform, platformPage);
          }

          const idx = pagesJson.subPackages.findIndex(p => p.root === root);
          if (idx !== -1) {
            pagesJson.subPackages[idx].pages = pagesJson.subPackages[idx].pages || [];
            const pidx = pagesJson.subPackages[idx].pages.findIndex(p => p.path === page.path);
            if (pidx !== -1) {
              deepAssign(pagesJson.subPackages[idx].pages[pidx], page);
            } else {
              pagesJson.subPackages[idx].pages.push(page);
            }

          } else {
            pagesJson.subPackages.push({
              root,
              pages: [page],
            });
          }
        }
      }
    }
  }

  private async generateTabbar(pagesJson: PagesJSON.PagesJson, platforms: Map<BuiltInPlatform, number> = new Map()): Promise<void> {

    for (const [_, pf] of this.pages) {
      const items = new Map<BuiltInPlatform, PagesJSON.TabBarItem>();
      const tabbarItem = await pf.getTabbarItem();
      if (tabbarItem) {
        items.set(currentPlatform, tabbarItem);
      }
      for (const [platform] of platforms) {
        const platformItem = await pf.getTabbarItem({ platform });
        if (platformItem) {
          items.set(platform, platformItem);
        }

        if (items.size > 0) {

          pagesJson.tabBar = pagesJson.tabBar || {};
          pagesJson.tabBar.list = pagesJson.tabBar.list || [];

          const [[pf1, v1], ...rest] = items.entries();
          for (const [pf2, v2] of rest) {
            mergePlatformItems(pf1, v1, pf2, v2);
          }

          const idx = pagesJson.tabBar.list.findIndex(item => item.pagePath === v1.pagePath);
          if (idx !== -1) {
            deepAssign(pagesJson.tabBar.list[idx], v1);
          } else {
            pagesJson.tabBar.list.push(v1);
          }
        }
      }
    }

  }

  private async writePagesJson(pagesJson: PagesJSON.PagesJson): Promise<boolean> {
    const { indent, eof, platforms } = this.jsonFileInfo!;
    const merged = new Map<BuiltInPlatform, number>(platforms.entries()).set(currentPlatform, Date.now());
    const sorted = Array.from(merged.entries()).sort(([p1], [p2]) => p1.localeCompare(p2));
    const comment = `// GENERATED BY @uni-ku/pages-json, PLATFORM: ${sorted.map(([p]) => `${p}`).join(' || ')} \n`;

    const raw = cjStringify(pagesJson, null, indent) + eof;

    const rawComment = comment + raw;

    if (this.lastPagesJson === rawComment) {
      debug.info('pages.json 无改动，跳过更新。');
      return false;
    }

    const commentTS = `// GENERATED BY @uni-ku/pages-json, PLATFORM: ${sorted.map(([p, t]) => `${p}@${t}`).join(' || ')} \n`;
    const final = clearKeySuffix(commentTS + raw);

    await writeFileWithLock(this.pagesJsonPath, final);

    this.lastPagesJson = rawComment;

    return true;
  }

  private getGlobalPagesJsonFilePaths(basename: string): string[] {
    const src = path.resolve(this.cfg.root, this.cfg.src);

    const paths: string[] = [];

    for (const dir of [this.cfg.root, src]) {
      for (const ext of this.globalPagesJsonExts) {
        paths.push(path.join(dir, `${basename}${ext}`));
      }
    }
    return paths;
  }

  /**
   * 从项目根目录 “root" 和基本目录 “baseDir” 获取全局动态 pages.json 的绝对路径
   */
  private getGlobalPagesJsonPath(): string | undefined {

    for (const filepath of this.globalPagesJsonFilePaths) {
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

  private async getGlobalPagesJson(): Promise<PagesJSON.PagesJson | undefined> {

    const file = this.getGlobalPagesJsonPath();
    if (!file) {
      return;
    }

    const content = await fs.promises.readFile(file, { encoding: 'utf-8' }).catch(() => '');
    if (!content) {
      return;
    }

    const parsed = await parseCode({ code: content, filename: file });
    if (!parsed) {
      return;
    }

    const globalPagesJson = typeof parsed === 'function'
      ? await parsed({ t: (p: DeepPartial<PagesJSON.PagesJson>) => p })
      : parsed;

    return globalPagesJson;
  }

  private getPageFile(filepath: string): PageFile | undefined {

    const abspath = path.isAbsolute(filepath)
      ? filepath
      : path.join(this.cfg.root, filepath);

    return this.files.get(abspath);
  }

  private listFiles(dir: string, options: fg.Options = {}) {
    const { cwd, ignore = [], ...others } = options;
    // fast-glob also use '/' for windows
    const source = this.pageFileExts.map(ext => `${fg.convertPathToPattern(dir)}/**/*${ext}`);
    const files = fg.sync(source, {
      cwd: cwd ? fg.convertPathToPattern(cwd) : undefined,
      ignore,
      ...others,
      onlyFiles: true,
      dot: true,
      unique: true,
      absolute: true,
    });

    return files;
  }

}

function mergePlatformItems<T extends object>(pf1: BuiltInPlatform, v1: T, pf2: BuiltInPlatform, v2: T): void {

  const v1keys = new Set(Object.keys(v1));

  for (const key in v2) {
    const v1Child = v1[key] ?? undefined;
    const v2Child = v2[key];

    v1keys.delete(key); // 删除已对比的 key

    const p1pk = `${key}#ifdef_${pf1}`;
    const p2pk = `${key}#ifdef_${pf2}`;

    if (v1Child === undefined) { // 如果 v1Child 为 undefined，则直接赋值给 v1
      (v1 as any)[p2pk] = v2Child;
      wrapIfdef(v1, p2pk, pf2);
    }

    if (typeof v2Child === 'object' && v2Child !== null) {
      mergePlatformItems(pf1, v1Child!, pf2, v2Child);
      continue;
    }

    if (v1Child === v2Child) {
      continue;
    }

    delete v1[key];
    (v1 as any)[p1pk] = v1Child;
    wrapIfdef(v1, p1pk, pf1);
    (v1 as any)[p2pk] = v2Child;
    wrapIfdef(v1, p2pk, pf2);
  }

  for (const key of v1keys) {
    if (key.includes('#ifdef')) {
      continue;
    }

    const v1Child = (v1 as any)[key];
    if (v1Child === undefined) {
      continue;
    }

    const p1pk = `${key}#ifdef_${pf1}`;
    delete (v1 as any)[key];
    (v1 as any)[p1pk] = v1Child;
    wrapIfdef(v1, p1pk, pf1);
  }
}

function clearKeySuffix(raw: string): string {
  return raw.replace(/"([^"]+)#ifdef_.*?"/g, '"$1"');
}

function wrapIfdef(obj: any, key: string, platform: string): void {

  obj[Symbol.for(`before:${key}`)] = obj[Symbol.for(`before:${key}`)] || [] as CommentToken[];
  (obj[Symbol.for(`before:${key}`)] as CommentToken[]).push({
    type: 'LineComment',
    value: ` #ifdef ${platform}`,
    inline: true,
    loc: {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    },
  });

  obj[Symbol.for(`after:${key}`)] = obj[Symbol.for(`after:${key}`)] || [] as CommentToken[];
  (obj[Symbol.for(`after:${key}`)] as CommentToken[]).push({
    type: 'LineComment',
    value: ` #endif`,
    inline: true,
    loc: {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    },
  });
}

// 替换现有的 detectIndent 函数
function detectIndent(code: string): number {
  const lines = code.split(/\r?\n/);
  const indentSizes: number[] = [];

  // 收集所有非空行的缩进大小
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    const match = line.match(/^(\s*)/);
    const spaces = match ? match[1].length : 0;

    if (spaces > 0) {
      indentSizes.push(spaces);
    }
  }

  if (indentSizes.length === 0) {
    return 2; // 默认返回2个空格
  }

  // 去重并排序
  const uniqueIndents = [...new Set(indentSizes)].sort((a, b) => a - b);

  // 如果只有一个缩进值，直接返回
  if (uniqueIndents.length === 1) {
    return uniqueIndents[0];
  }

  // 计算所有缩进值的最大公约数作为基础缩进
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  let baseIndent = uniqueIndents[0];

  for (let i = 1; i < uniqueIndents.length; i++) {
    baseIndent = gcd(baseIndent, uniqueIndents[i]);
    // 如果最大公约数为1，说明可能不是规则缩进
    if (baseIndent === 1) {
      break;
    }
  }

  // 验证基础缩进是否合理（通常是2-8之间的常见值）
  if (baseIndent >= 2 && baseIndent <= 8) {
    return baseIndent;
  }

  // 如果计算出的基础缩进不合理，回退到使用最小缩进值
  return uniqueIndents[0];
}
