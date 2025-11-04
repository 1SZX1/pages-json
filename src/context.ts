import type { BuiltInPlatform } from '@uni-helper/uni-env';
import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { CommentToken } from 'comment-json';
import fs from 'node:fs';
import path from 'node:path';
import { platform as currentPlatform } from '@uni-helper/uni-env';
import { parse as cjParse, stringify as cjStringify } from 'comment-json';
import fg from 'fast-glob';
import { resolveConfig, type ResolvedConfig, type UserConfig } from './config';
import { writeDeclaration } from './declaration';
import { getPageType, getTabbarIndex, PageFile } from './pageFile';
import { DynamicPagesJson } from './pagesJson';
import { debug } from './utils/debug';
import { checkFile, checkFileSync, writeFileWithLock } from './utils/file';
import { deepAssign } from './utils/object';

interface StaticJsonFileInfo {
  platforms: Set<BuiltInPlatform>;
  indent: string;
  eof: string;
  data: PagesJSON.PagesJson; // 由于有条件编译，会有重复 key，数据失真
}

export class Context {

  /** Map<filepath, PageFile> */
  public files = new Map<string, PageFile>();

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

  constructor(config: UserConfig) {
    this.cfg = resolveConfig(config);

    this.staticJsonFilePath = path.join(this.cfg.src, 'pages.json');
    this.dynamicPagesJson = new DynamicPagesJson(this);
  }

  /**
   * 扫描文件
   */
  public scanFiles(): void {

    const files = new Map<string, PageFile>();

    const parsePagePath = (baseDir: string, filepath: string): string => {
      const rel = path.relative(baseDir, filepath);
      return rel.replace(path.extname(rel), '').replace('\\', '/');
    };

    // subPackages, 先处理 subPackages 避免重复出现在 pages 里
    for (const dir of this.cfg.subPackageDirs) {

      const root = path.basename(dir);

      for (const file of listFiles(dir, { cwd: this.cfg.root, ignore: this.cfg.excludes })) {
        if (files.has(file)) {
          continue; // 跳过重复文件
        }

        debug.debug(`subPackages: ${file}`);

        let pagePath = parsePagePath(path.resolve(this.cfg.root, dir), file);
        pagePath = this.cfg.parsePagePath({ filePath: file, pagePath });

        const page = this.files.get(file) || new PageFile(file, pagePath, root);
        files.set(file, page);
      }
    }

    // pages
    for (const file of listFiles(this.cfg.pageDir, { cwd: this.cfg.root, ignore: this.cfg.excludes })) {
      if (files.has(file)) {
        continue; // 跳过重复文件
      }

      debug.debug(`pages: ${file}`);

      let pagePath = parsePagePath(this.cfg.src, file);
      pagePath = this.cfg.parsePagePath({ filePath: file, pagePath });

      const page = this.files.get(file) || new PageFile(file, pagePath);
      files.set(file, page);
    }

    this.files = files;
  }

  public pages({ platform = currentPlatform }: { platform?: BuiltInPlatform } = {}): PageFile[] {
    const files: PageFile[] = [];
    for (const [, file] of this.files) {
      if (!file.root) { // root 为空，则为 pages
        files.push(file);
      }
    }

    return files.filter(file => this.cfg.filterPages({ filePath: file.file, platform }));
  }

  public subPackages({ platform = currentPlatform }: { platform?: BuiltInPlatform } = {}): PageFile[] {
    const files: PageFile[] = [];
    for (const [, file] of this.files) {
      if (file.root) { // root 不为空，则为 subPackages
        files.push(file);
      }
    }

    return files.filter(file => this.cfg.filterPages({ filePath: file.file, platform }));
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

      // 检测是否合格的动态 pages.json 文件
      if (this.isValidDynamicJsonFile(abspath)) {
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
      if (this.isValidPageFile(abspath)) {
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

    if (this.files.size === 0) {
      await this.scanFiles(); // 避免每次都扫描全局
    }

    await this.checkStaticJsonFile();
    const { platforms, indent, eof } = await this.detectStaticJsonFile(true);

    const json = await this.generatePagesJson(platforms);
    await this.generatePages(json, platforms);
    await this.generateSubPackages(json, platforms);
    await this.generateTabbar(json, platforms);
    const raw = await this.stringifyPagesJson(json, { platforms, indent, eof });
    const result = await this.writePagesJson(raw);

    if (result && this.cfg.dts) {
      // dts 必须是无条件编译的，否则重复 key 会导致生成错误
      const json = await this.generatePagesJson();
      await this.generatePages(json);
      await this.generateSubPackages(json);
      await this.generateTabbar(json);
      await writeDeclaration(json, this.cfg.dts as string);
    }

    return result;
  }

  public isValidFile(filepath: string): boolean {
    return this.isValidPageFile(filepath) || this.isValidDynamicJsonFile(filepath);
  }

  public isValidPageFile(filepath: string): boolean {
    if (!PageFile.exts.some(ext => filepath.endsWith(ext))) {
      return false;
    }

    const abspath = path.isAbsolute(filepath)
      ? filepath
      : path.resolve(this.cfg.root, filepath);

    const dirs = [this.cfg.pageDir, ...this.cfg.subPackageDirs].map((dir) => {
      return path.isAbsolute(dir)
        ? dir
        : path.resolve(this.cfg.root, dir);
    });

    return dirs.some(dir => abspath.startsWith(dir));
  }

  public isValidDynamicJsonFile(filepath: string): boolean {

    const abspath = path.isAbsolute(filepath)
      ? filepath
      : path.resolve(this.cfg.root, filepath);

    return this.possibleDynamicJsonFilePaths().includes(abspath);
  }

  public possibleDynamicJsonFilePaths(): string[] {

    const root = path.resolve(this.cfg.root);

    const dirs = [
      root,
      path.resolve(root, this.cfg.src),
    ];

    const paths: string[] = [];

    for (const dir of dirs) {
      for (const ext of DynamicPagesJson.exts) {
        paths.push(path.join(dir, DynamicPagesJson.basename + ext));
      }
    }

    return paths;
  }

  public checkStaticJsonFile(): Promise<boolean> {
    return checkFile({
      path: this.staticJsonFilePath,
      newContent: JSON.stringify({ pages: [{ path: '' }] }, null, 4),
      modeFlag: fs.constants.R_OK | fs.constants.W_OK,
    });
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
  public async detectStaticJsonFile(forceUpdate = false): Promise<StaticJsonFileInfo> {
    if (!forceUpdate && this.staticJsonFileInfo) {
      return this.staticJsonFileInfo;
    }

    const detect = async () => {
      const res = {
        platforms: new Set<BuiltInPlatform>([currentPlatform]),
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
            for (let pf of pfs) {
              pf = pf.trim();
              if (!pf) {
                continue;
              }
              res.platforms.add(pf as BuiltInPlatform);
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

  /**
   * 根据指定的平台生成 PagesJson 对象
   * @param platforms
   */
  public async generatePagesJson(platforms: Set<BuiltInPlatform> = new Set()): Promise<PagesJSON.PagesJson> {

    const [firstPlatform = currentPlatform, ...restPlatforms] = [...platforms].sort();

    const json = (await this.dynamicPagesJson.getJson({ platform: firstPlatform }) || {});
    let { pages, subPackages, tabBar, ...rest } = json;
    for (const platform of restPlatforms) {
      const { pages: v2pages, subPackages: v2subPackages, tabBar: v2tabBar, ...v2rest } = (await this.dynamicPagesJson.getJson({ platform }) || {});
      mergePlatformObject(firstPlatform, rest, platform, v2rest);

      // 合并 pages
      if (v2pages && v2pages.length > 0) {
        pages = pages || [];
        mergePlatformArray(firstPlatform, pages, platform, v2pages, v => v.path);
      }

      // 合并 subPackages
      for (const v2sub of (v2subPackages || [])) {
        subPackages = subPackages || [];

        const subIdx = subPackages.findIndex(p => p.root === v2sub.root);
        if (subIdx > -1) { // 存在则合并
          const { pages, ...rest } = v2sub;
          if (pages && pages.length > 0) {
            subPackages[subIdx].pages = subPackages[subIdx].pages || [];
            mergePlatformArray(firstPlatform, subPackages[subIdx].pages, platform, pages, v => v.path);
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
          mergePlatformArray(firstPlatform, tabBar.list, platform, list, v => v.pagePath);
        }
        Object.assign(tabBar, rest);
      }
    }

    return {
      ...json,
      ...rest,
      pages,
      subPackages,
      tabBar,
    };
  }

  /**
   * 根据指定的平台生成 Pages，并合并到 pagesJson
   */
  public async generatePages(pagesJson: PagesJSON.PagesJson, platforms: Set<BuiltInPlatform> = new Set()): Promise<void> {

    // 根据平台生成页面
    const genPages = async (platform: BuiltInPlatform) => {
      const pageFiles = this.pages({ platform });

      const pages: PagesJSON.Page[] = [];
      for (const pf of pageFiles) {
        const page = await pf.getPage({ platform });
        pages.push(page);
      }
      return pages;
    };

    pagesJson.pages = pagesJson.pages || [];

    const [firstPlatform = currentPlatform, ...restPlatforms] = [...platforms].sort();

    const first = await genPages(firstPlatform);
    for (const platform of restPlatforms) {
      const pages = await genPages(platform);
      mergePlatformArray(firstPlatform, first, platform, pages, v => v.path);
    }

    for (const page of first) {
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

  /**
   * 根据指定的平台生成 SubPackages，并合并到 pagesJson
   */
  public async generateSubPackages(pagesJson: PagesJSON.PagesJson, platforms: Set<BuiltInPlatform> = new Set()): Promise<void> {

    // 根据平台生成页面
    const genSubPackages = async (platform: BuiltInPlatform) => {
      const pageFiles = this.subPackages({ platform });

      const subPackages: Record<string, PagesJSON.SubPackage> = {};
      for (const pf of pageFiles) {
        if (!pf.root) {
          continue;
        }
        subPackages[pf.root] = subPackages[pf.root] || { root: pf.root, pages: [] };

        const page = await pf.getPage({ platform });
        subPackages[pf.root].pages.push(page);
      }
      return subPackages;
    };

    const [firstPlatform = currentPlatform, ...restPlatforms] = [...platforms].sort();

    /** 生成多个平台的 subPackages */
    const first = await genSubPackages(firstPlatform); // 生成第一个平台的 subPackages
    for (const platform of restPlatforms) {
      const subPackages = await genSubPackages(platform);

      /** 合并不同平台的 subPackages */
      for (const [root, sub] of Object.entries(subPackages)) {

        const firstSub = first[root];
        if (!firstSub) {
          first[root] = sub;
          continue;
        }

        mergePlatformArray(firstPlatform, firstSub.pages, platform, sub.pages, v => v.path);
      }
    }

    if (Object.keys(first).length === 0) {
      return; // 如果 subPackages 为空，则不处理和 pagesJson.subPackages 合并，避免生成空的 subPackages
    }

    pagesJson.subPackages = pagesJson.subPackages || [];

    for (const [root, sub] of Object.entries(first)) {
      for (const page of (sub.pages || [])) {
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

  /**
   * 根据指定的平台生成 TabBar，并合并到 pagesJson
   */
  public async generateTabbar(pagesJson: PagesJSON.PagesJson, platforms: Set<BuiltInPlatform> = new Set()): Promise<void> {

    // 根据平台生成页面
    const genTabbarItem = async (platform: BuiltInPlatform) => {
      const pageFiles = this.pages({ platform });

      const items: PagesJSON.TabBarItem[] = [];
      for (const pf of pageFiles) {
        const item = await pf.getTabbarItem({ platform });
        if (item) {
          items.push(item);
        }
      }
      return items;
    };

    const [firstPlatform = currentPlatform, ...restPlatforms] = [...platforms].sort();

    const first = await genTabbarItem(firstPlatform);
    for (const platform of restPlatforms) {
      const items = await genTabbarItem(platform);
      mergePlatformArray(firstPlatform, first, platform, items, v => v.pagePath);
    }

    if (Object.keys(first).length > 0) {
      pagesJson.tabBar = pagesJson.tabBar || {};
      pagesJson.tabBar.list = pagesJson.tabBar.list || [];

      for (const tb of first) {
        const idx = pagesJson.tabBar.list.findIndex(item => item.pagePath === tb.pagePath);
        if (idx !== -1) {
          deepAssign(pagesJson.tabBar.list[idx], tb);
        } else {
          pagesJson.tabBar.list.push(tb);
        }
      }
    }

    // 排序：tabbar 配置项按照顺序排列
    if (pagesJson.tabBar && pagesJson.tabBar.list) {
      pagesJson.tabBar.list.sort((a, b) => getTabbarIndex(a) - getTabbarIndex(b));
    }
  }

  /**
   * 格式化 json 字符串
   *   - 添加所用的 平台＋时间戳 的注释
   *   - 清理条件编译的 key 后缀
   *   - 修复 #ifdef 行注释位置
   *   - 修复 #endif 行注释位置
   */
  public async stringifyPagesJson(pagesJson: PagesJSON.PagesJson, { indent, eof, platforms }: {
    platforms: Set<BuiltInPlatform>;
    indent: string;
    eof: string;
  }): Promise<string> {
    const sorted = [...platforms].sort();

    let rawJson = cjStringify(pagesJson, null, indent) + eof;

    const comment = `// GENERATED BY @uni-ku/pages-json, PLATFORM: ${sorted.join(' || ')} \n`;
    rawJson = comment + rawJson;

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

  public async writePagesJson(rawJson: string): Promise<boolean> {
    if (this.lastPagesJson === rawJson) {
      debug.info('pages.json 无改动，跳过更新。');
      return false;
    }

    await writeFileWithLock(this.staticJsonFilePath, rawJson);

    this.lastPagesJson = rawJson;

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
 */
function mergePlatformArray<T extends object>(pf1: BuiltInPlatform, v1: T[], pf2: BuiltInPlatform, v2: T[], getKey: (v: T) => string) {
  for (const v2item of v2) {
    const v2key = getKey(v2item);
    const v1idx = v1.findIndex(v => getKey(v) === v2key);
    if (v1idx > -1) {
      mergePlatformObject(pf1, v1[v1idx], pf2, v2item);
    } else {
      v1.push(v2item);
    }
  }
}

/**
 * 合并两个不同平台的对象
 *
 * @param pf1 平台名称 1
 * @param v1  值 1
 * @param pf2 平台名称 2
 * @param v2  值 2
 */
function mergePlatformObject<T extends object>(pf1: BuiltInPlatform, v1: T, pf2: BuiltInPlatform, v2: T) {

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
      mergePlatformObject(pf1, v1Child!, pf2, v2Child); // 递归合并
      continue; // 下一个循环
    }

    delete v1[key];
    (v1 as any)[p1pk] = v1Child;
    wrapIfdef(v1, p1pk, pf1);
    (v1 as any)[p2pk] = v2Child;
    wrapIfdef(v1, p2pk, pf2);

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
  }
}

function wrapIfdef(obj: any, key: string, platform: string): void {

  const upperPlatform = platform.toUpperCase();

  obj[Symbol.for(`before:${key}`)] = obj[Symbol.for(`before:${key}`)] || [] as CommentToken[];
  obj[Symbol.for(`before:${key}`)] = [{
    type: 'LineComment',
    value: ` #ifdef ${upperPlatform}`,
    inline: true,
    loc: {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    },
  }] as CommentToken[];

  obj[Symbol.for(`after:${key}`)] = obj[Symbol.for(`after:${key}`)] || [] as CommentToken[];
  obj[Symbol.for(`after:${key}`)] = [{
    type: 'LineComment',
    value: ` #endif`,
    inline: true,
    loc: {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    },
  }] as CommentToken[];
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
