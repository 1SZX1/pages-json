import type { BuiltInPlatform } from '@uni-helper/uni-env';
import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { CommentToken } from 'comment-json';
import type { ResolvedConfig } from './config';
import fs from 'node:fs';
import path from 'node:path';
import { platform as currentPlatform } from '@uni-helper/uni-env';
import { parse as cjParse, stringify as cjStringify } from 'comment-json';
import fg from 'fast-glob';
import { writeDeclaration } from './declaration';
import { getPageType, getTabbarIndex, PageFile } from './pageFile';
import { DynamicPagesJson } from './pagesJson';
import { debug } from './utils/debug';
import { checkFileSync, writeFileWithLock } from './utils/file';
import { deepAssign } from './utils/object';

interface StaticJsonFileInfo {
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
   * 静态 pages.json 的文件路径
   */
  public readonly staticJsonFilePath: string;
  private staticJsonFileInfo?: StaticJsonFileInfo;
  /**
   * 全局动态 pages.json 可用的文件后缀
   */
  public dynamicPagesJson: DynamicPagesJson;

  private lastPagesJson = '';

  constructor(config: ResolvedConfig) {
    this.cfg = config;

    this.staticJsonFilePath = path.join(this.cfg.src, 'pages.json');
    this.dynamicPagesJson = new DynamicPagesJson(this);
  }

  /**
   * 扫描文件
   */
  public scanFiles(): void {

    const files = new Map<string, PageFile>();
    const pages = new Map<string, PageFile>();

    // pages
    listFiles(this.cfg.pageDir, {
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

      listFiles(dir, {
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

    const needUpdate = async (filepath?: string): Promise<boolean> => {

      if (!filepath) { // 未指定文件，则更新所有文件
        await this.scanFiles();
        return true;
      }

      const abspath = path.isAbsolute(filepath)
        ? filepath
        : path.join(this.cfg.root, filepath);

      // 检测是否合格的动态 pages 文件
      if (!DynamicPagesJson.isValid(abspath, this.cfg.root, this.cfg.src)) {
        if (abspath !== this.dynamicPagesJson.path) {
          this.dynamicPagesJson.path = abspath;
        }
        await this.dynamicPagesJson.read();

        if (!this.dynamicPagesJson.hasChanged()) {
          debug.info(`文件 ${filepath} 的 pages json 无改动，跳过更新。`);
          return false;
        } else {
          return true;
        }
      }

      // 检测是否合格的 page 文件
      if (PageFile.isValid(abspath)) {
        const pageFile = this.files.get(abspath);
        if (pageFile) { // 文件存在
          await pageFile.read();
          if (!pageFile.hasChanged()) {
            debug.info(`文件 ${filepath} 的 page meta 无改动，跳过更新。`);
            return false;
          }
          return true;
        } else { // 文件不存在，扫描全局文件
          await this.scanFiles();
          return true;
        }
      }

      // 既不是 Dynamic Pages Json 又不是 page 文件
      debug.info(`文件 ${filepath} 不是 pages.json 相关文件，跳过更新。`);
      return false;
    };

    if (!(await needUpdate(filepath))) {
      return false;
    }

    this.checkStaticJsonFileSync();
    const { platforms } = await this.detectStaticJsonFile(true);

    const json = await this.generatePagesJson(platforms);

    if (this.files.size === 0) {
      await this.scanFiles(); // 避免每次都扫描全局
    }

    await this.generatePages(json, platforms);
    await this.generateSubPackages(json, platforms);
    await this.generateTabbar(json, platforms);

    const result = await this.writePagesJson(json);

    if (result && this.cfg.dts) {
      await writeDeclaration(json, this.cfg.dts as string);
    }

    return result;
  }

  /**
   * vite 的虚拟路径
   *
   */
  public async virtualModule() {

    const pagesJson = await this.generatePagesJson();

    await this.generatePages(pagesJson);
    await this.generateSubPackages(pagesJson);
    await this.generateTabbar(pagesJson);

    return `export default ${JSON.stringify(pagesJson, null, 2)}\n`;
  }

  public isValidFile(filepath: string): boolean {
    return PageFile.isValid(filepath) && DynamicPagesJson.isValid(filepath, this.cfg.root, this.cfg.src);
  }

  public checkStaticJsonFileSync(): boolean {
    return checkFileSync({
      path: this.staticJsonFilePath,
      newContent: JSON.stringify({ pages: [{ path: '' }] }, null, 4),
      modeFlag: fs.constants.R_OK | fs.constants.W_OK,
    });
  }

  /**
   * 检测静态 pages.json 文件
   */
  private async detectStaticJsonFile(forceUpdate = false): Promise<StaticJsonFileInfo> {
    if (!forceUpdate && this.staticJsonFileInfo) {
      return this.staticJsonFileInfo;
    }

    const detect = async () => {
      const res = {
        platforms: new Map<BuiltInPlatform, number>(),
        indent: ' '.repeat(4),
        eof: '\n',
        data: {} as PagesJSON.PagesJson,
      };

      const content = await fs.promises.readFile(this.staticJsonFilePath, { encoding: 'utf-8' }).catch(() => '');
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

    this.staticJsonFileInfo = await detect();

    return this.staticJsonFileInfo;
  }

  private async generatePagesJson(platforms: Map<BuiltInPlatform, number> = new Map()): Promise<PagesJSON.PagesJson> {
    let { pages, subPackages, tabBar, ...v1rest } = (await this.dynamicPagesJson.getJson() || {});
    for (const [platform] of platforms) {
      const { pages: v2pages, subPackages: v2subPackages, tabBar: v2tabBar, ...v2rest } = (await this.dynamicPagesJson.getJson({ platform }) || {});
      mergePlatformObject(currentPlatform, v1rest, platform, v2rest);

      // 合并 pages
      if (v2pages && v2pages.length > 0) {
        pages = pages || [];
        mergePlatformArray(currentPlatform, pages, platform, v2pages, v => v.path);
      }

      // 合并 subPackages
      for (const v2sub of (v2subPackages || [])) {
        subPackages = subPackages || [];

        const subIdx = subPackages.findIndex(p => p.root === v2sub.root);
        if (subIdx > -1) { // 存在则合并
          const { pages, ...rest } = v2sub;
          if (pages && pages.length > 0) {
            subPackages[subIdx].pages = subPackages[subIdx].pages || [];
            mergePlatformArray(currentPlatform, subPackages[subIdx].pages, platform, pages, v => v.path);
          }
          Object.assign(subPackages[subIdx], rest);
        } else { // 不存在则添加
          subPackages.push(v2sub);
        }

      }

      // 合并 tabBar
      if (v2tabBar) {
        tabBar = tabBar || {};
        const { list, ...rest } = v2tabBar;
        if (list && list.length > 0) {
          tabBar.list = tabBar.list || [];
          mergePlatformArray(currentPlatform, tabBar.list, platform, list, v => v.pagePath);
        }
        Object.assign(tabBar, rest);
      }
    }

    return {
      ...v1rest,
      pages,
      subPackages,
      tabBar,
    };
  }

  private async generatePages(pagesJson: PagesJSON.PagesJson, platforms: Map<BuiltInPlatform, number> = new Map()): Promise<void> {

    if (this.pages.size === 0) {
      return;
    }

    pagesJson.pages = pagesJson.pages || [];

    for (const [_, pf] of this.pages) {
      const page = await pf.getPage();
      for (const [platform] of platforms) {
        const platformPage = await pf.getPage({ platform });
        mergePlatformObject(currentPlatform, page, platform, platformPage);
      }

      const idx = pagesJson.pages.findIndex(p => p.path === page.path);
      if (idx !== -1) {
        deepAssign(pagesJson.pages[idx], page);
      } else {
        pagesJson.pages.push(page);
      }
    }

    // 排序
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

  private async generateSubPackages(pagesJson: PagesJSON.PagesJson, platforms: Map<BuiltInPlatform, number> = new Map()): Promise<void> {

    if (this.subPackages.size === 0) {
      return;
    }

    // subPackages 大于 0 才进行，避免错误创建空的 subPackages
    pagesJson.subPackages = pagesJson.subPackages || [];
    for (const [root, subPackage] of this.subPackages) {
      for (const [_, pf] of subPackage) {
        const page = await pf.getPage();
        for (const [platform] of platforms) {
          const platformPage = await pf.getPage({ platform });
          mergePlatformObject(currentPlatform, page, platform, platformPage);
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
            mergePlatformObject(pf1, v1, pf2, v2);
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

    // 排序：tabbar 配置项按照顺序排列
    if (pagesJson.tabBar && pagesJson.tabBar.list) {
      pagesJson.tabBar.list.sort((a, b) => getTabbarIndex(a) - getTabbarIndex(b));
    }

  }

  private async writePagesJson(pagesJson: PagesJSON.PagesJson): Promise<boolean> {
    const { indent, eof, platforms } = this.staticJsonFileInfo!;
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
    const final = formatJson(commentTS + raw);

    await writeFileWithLock(this.staticJsonFilePath, final);

    this.lastPagesJson = rawComment;

    return true;
  }

}

function listFiles(dir: string, options: fg.Options = {}) {
  const { cwd, ignore = [], ...others } = options;
  // fast-glob also use '/' for windows
  const source = PageFile.exts.map(ext => `${fg.convertPathToPattern(dir)}/**/*${ext}`);
  const files = fg.sync(source, {
    cwd: cwd ? fg.convertPathToPattern(cwd) : undefined,
    ignore,
    onlyFiles: true,
    unique: true,
    absolute: true,
    ...others,
  });

  return files;
};

/**
 * 合并两个不同平台的数组
 *
 * @param pf1 平台名称 1
 * @param v1  值 1
 * @param pf2 平台名称 2
 * @param v2  值 2
 * @param getKey 获取元素的 key
 * @returns 是否有变化。
 */
function mergePlatformArray<T extends object>(pf1: BuiltInPlatform, v1: T[], pf2: BuiltInPlatform, v2: T[], getKey: (v: T) => string): boolean {
  let merged = false;
  for (const v2item of v2) {
    const v2key = getKey(v2item);
    const v1idx = v1.findIndex(v => getKey(v) === v2key);
    if (v1idx > -1) {
      mergePlatformObject(pf1, v1[v1idx], pf2, v2item);
    } else {
      v1.push(v2item);
    }

    merged = true;
  }

  return merged;
}

/**
 * 合并两个不同平台的对象
 *
 * @param pf1 平台名称 1
 * @param v1  值 1
 * @param pf2 平台名称 2
 * @param v2  值 2
 * @returns 是否有变化。（相等返回 false，不相等进行合并，返回 true）
 */
function mergePlatformObject<T extends object>(pf1: BuiltInPlatform, v1: T, pf2: BuiltInPlatform, v2: T): boolean {

  const v1keys = new Set(Object.keys(v1));

  let merged = false;

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

    if (v1Child === v2Child) {
      continue;
    }

    if (Array.isArray(v2Child)) {
      const c1 = JSON.stringify(v1Child);
      const c2 = JSON.stringify(v2Child);
      if (c1 === c2) {
        continue;
      }
    } else if (typeof v2Child === 'object' && v2Child !== null) {

      if (mergePlatformObject(pf1, v1Child!, pf2, v2Child)) { // 递归合并
        merged = true; // 合并成功
        continue; // 下一个循环
      }
    }

    delete v1[key];
    (v1 as any)[p1pk] = v1Child;
    wrapIfdef(v1, p1pk, pf1);
    (v1 as any)[p2pk] = v2Child;
    wrapIfdef(v1, p2pk, pf2);

    merged = true; // 标识已合并
  }

  for (const key of v1keys) { // 处理 v2 不存在的 key
    if (key.includes('#ifdef')) { // 如果已经是格式化后的 key，跳过
      continue;
    }

    const v1Child = (v1 as any)[key];
    if (v1Child === undefined) { // 如果值为 undefined，跳过
      continue;
    }

    const p1pk = `${key}#ifdef_${pf1}`;
    delete (v1 as any)[key];
    (v1 as any)[p1pk] = v1Child;
    wrapIfdef(v1, p1pk, pf1);

    merged = true; // 标识已合并
  }

  return merged;
}

/**
 * 格式化 json 字符串
 *   - 清理条件编译的 key 后缀
 *   - 修复 #ifdef 行注释位置
 *   - 修复 #endif 行注释位置
 */
function formatJson(rawJson: string): string {
  // 清理 key 后缀
  rawJson = rawJson.replace(/"([^"]+)#ifdef_.*?"/g, '"$1"');

  // 修复 #ifdef 行注释位置。（comment-json 将此行注释放在上一个行的末尾，而不是同等缩进的新行）
  // eslint-disable-next-line regexp/no-super-linear-backtracking
  rawJson = rawJson.replace(/\n(\s*.+)\s*(\/\/ #ifdef .*)\n(\s*)/g, '\n$1\n$3$2\n$3');

  // 修复 #endif 行注释位置。（comment-json 将此行注释行末尾，而不是同等缩进的新行）
  // eslint-disable-next-line regexp/no-super-linear-backtracking
  rawJson = rawJson.replace(/\n((\s*).*?)\s*\/\/ #endif/g, '\n$1\n$2// #endif');

  // 清除多余的换行
  rawJson = rawJson.replace(/\n\s*\n/g, '\n');

  return rawJson;
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

/**
 * 检测缩进
 */
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
