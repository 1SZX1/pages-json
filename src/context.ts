import type { BuiltInPlatform } from '@uni-helper/uni-env';
import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { CommentToken } from 'comment-json';
import type { PageFileOption } from './pageFile';
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
  public async scanFiles(): Promise<void> {

    const files = new Map<string, PageFile>();

    const parsePagePath = (baseDir: string, filepath: string): string => {
      const rel = path.relative(baseDir, filepath);
      return rel.replace(path.extname(rel), '').replaceAll('\\', '/');
    };

    // subPackages, 先处理 subPackages 避免重复出现在 pages 里
    for (const dir of this.cfg.subPackageDirs) {

      const root = path.basename(dir);

      for (const file of listFiles(dir, { cwd: this.cfg.root, ignore: this.cfg.exclude })) {
        if (files.has(file)) {
          continue; // 跳过重复文件
        }

        debug.debug(`subPackages: ${file}`);

        const pagePath = parsePagePath(path.resolve(this.cfg.root, dir), file);
        let opt: PageFileOption = { filePath: file, pagePath, root };
        for (const hook of this.cfg.hooks) {
          if (hook.parsePageOption) {
            opt = await Promise.resolve(hook.parsePageOption(opt));
          }
        }

        const page = this.files.get(file) || new PageFile(opt);
        files.set(file, page);
      }
    }

    // pages
    for (const file of listFiles(this.cfg.pageDir, { cwd: this.cfg.root, ignore: this.cfg.exclude })) {
      if (files.has(file)) {
        continue; // 跳过重复文件
      }

      debug.debug(`pages: ${file}`);

      const pagePath = parsePagePath(this.cfg.src, file);
      let opt: PageFileOption = { filePath: file, pagePath };
      for (const hook of this.cfg.hooks) {
        if (hook.parsePageOption) {
          opt = await Promise.resolve(hook.parsePageOption(opt));
        }
      }

      const page = this.files.get(file) || new PageFile(opt);
      files.set(file, page);
    }

    this.files = files;
  }

  public async getPageFileOfPages(platform = currentPlatform): Promise<PageFile[]> {
    let opts: PageFileOption[] = [];
    for (const [, p] of this.files) {
      if (!p.root) { // root 为空，则为 pages
        opts.push({
          filePath: p.file,
          pagePath: p.path,
          root: p.root,
        });
      }
    }

    for (const hook of this.cfg.hooks) {
      if (hook.filterPages) {
        opts = await Promise.resolve(hook.filterPages(platform, opts));
      }
    }

    const files: PageFile[] = [];
    for (const opt of opts) {
      const file = this.files.get(opt.filePath) || new PageFile(opt);
      files.push(file);
    }

    return files;
  }

  public async getPageFileOfSubPackages(platform = currentPlatform): Promise<PageFile[]> {
    let opts: PageFileOption[] = [];
    for (const [, p] of this.files) {
      if (p.root) { // root 不为空，则为 subPackages
        opts.push({
          filePath: p.file,
          pagePath: p.path,
          root: p.root,
        });
      }
    }

    for (const hook of this.cfg.hooks) {
      if (hook.filterPages) {
        opts = await Promise.resolve(hook.filterPages(platform, opts));
      }
    }

    const files: PageFile[] = [];
    for (const opt of opts) {
      const file = this.files.get(opt.filePath) || new PageFile(opt);
      files.push(file);
    }

    return files;
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

    const jsons = {} as Record<BuiltInPlatform, PagesJSON.PagesJson>;

    for (const platform of platforms) {
      jsons[platform] = await this.generatePagesJson(platform);
    }

    const rawJson = this.stringifyPagesJson(jsons, indent, eof);

    if (this.lastPagesJson === rawJson) {
      debug.info('pages.json 无改动，跳过更新。');
      return false;
    }

    await writeFileWithLock(this.staticJsonFilePath, rawJson);

    this.lastPagesJson = rawJson;

    if (this.cfg.dts) {
      await writeDeclaration(jsons, this.cfg.dts as string);
    }

    return true;
  }

  /**
   * 是否合格的文件路径
   */
  public isValidFile(filepath: string): boolean {
    return this.isValidPageFile(filepath) || this.isValidDynamicJsonFile(filepath);
  }

  /**
   * 是否合格的 page 文件路径
   */
  private isValidPageFile(filepath: string): boolean {
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

  /**
   * 是否合格的 dynamic pages.json 文件路径
   */
  private isValidDynamicJsonFile(filepath: string): boolean {

    const abspath = path.isAbsolute(filepath)
      ? filepath
      : path.resolve(this.cfg.root, filepath);

    return this.possibleDynamicJsonFilePaths().includes(abspath);
  }

  /**
   * dynamic pages.json 文件可用路径
   */
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

  /**
   * 异步检测静态 pages.json 文件，如不存在或权限不正确，尝试重建
   */
  public checkStaticJsonFile(): Promise<boolean> {
    return checkFile({
      path: this.staticJsonFilePath,
      newContent: JSON.stringify({ pages: [{ path: '' }] }, null, 4),
      modeFlag: fs.constants.R_OK | fs.constants.W_OK,
    });
  }

  /**
   * 同步检测静态 pages.json 文件，如不存在或权限不正确，尝试重建
   */
  public checkStaticJsonFileSync(): boolean {
    return checkFileSync({
      path: this.staticJsonFilePath,
      newContent: JSON.stringify({ pages: [{ path: '' }] }, null, 4),
      modeFlag: fs.constants.R_OK | fs.constants.W_OK,
    });
  }

  /**
   * 检测静态 pages.json 文件信息（使用的platform、换行符、末端换行）
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
      };

      const content = await fs.promises.readFile(this.staticJsonFilePath, { encoding: 'utf-8' }).catch(() => '');
      if (!content) {
        return res;
      }

      try {
        const json = cjParse(content) as PagesJSON.PagesJson;
        const comments = json[Symbol.for('before-all') as any] as CommentToken[];
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
   * 将多个平台的 pages.json 合并成一个静态 pages.json
   */
  public stringifyPagesJson(jsons: Record<BuiltInPlatform, PagesJSON.PagesJson>, indent = ' '.repeat(4), eof = '\n'): string {
    const [p1 = currentPlatform, ...p2s] = Object.keys(jsons).sort() as BuiltInPlatform[];

    const pagesJson = jsons[p1] || {};

    for (const p2 of p2s) {
      const j2 = jsons[p2];

      // 合并不同平台的 pages
      if (j2.pages) {
        pagesJson.pages = pagesJson.pages || [];
        mergePlatformArray(p1, pagesJson.pages, p2, j2.pages, v => v.path);
      }
      // 合并不同平台的 subPackages
      if (j2.subPackages) {
        pagesJson.subPackages = pagesJson.subPackages || [];
        for (const j2Sub of j2.subPackages) {
          const idx = pagesJson.subPackages.findIndex(s => s.root === j2Sub.root);
          if (idx > -1) {
            mergePlatformObject(p1, pagesJson.subPackages[idx], p2, j2Sub, ['pages']);
            if (j2Sub.pages && j2Sub.pages.length > 0) {
              pagesJson.subPackages[idx].pages = pagesJson.subPackages[idx].pages || [];
              mergePlatformArray(p1, pagesJson.subPackages[idx].pages, p2, j2Sub.pages, v => v.path);
            }
          } else {
            pagesJson.subPackages.push(j2Sub);
          }
        }
      }
      // 合并不同平台的 tabBar
      if (j2.tabBar) {
        pagesJson.tabBar = pagesJson.tabBar || {};
        mergePlatformObject(p1, pagesJson.tabBar, p2, j2.tabBar, ['list']);
        if (j2.tabBar.list && j2.tabBar.list.length > 0) {
          pagesJson.tabBar.list = pagesJson.tabBar.list || [];
          mergePlatformArray(p1, pagesJson.tabBar.list, p2, j2.tabBar.list, v => v.pagePath);
        }
      }

      // 合并除 pages、subPackages、tabBar 外的其他属性
      mergePlatformObject(p1, pagesJson, p2, j2, ['pages', 'subPackages', 'tabBar']);
    }

    this.sortPagesJson(pagesJson);

    let rawJson = cjStringify(pagesJson, null, indent);

    const comment = `// GENERATED BY @uni-ku/pages-json, PLATFORM: ${[p1, ...p2s].join(' || ')} \n`;
    rawJson = comment + rawJson + eof;

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

  /**
   * 根据 platform 生成完整的 pages.json
   */
  public async generatePagesJson(platform = currentPlatform): Promise<PagesJSON.PagesJson> {
    const pagesJson = (await this.dynamicPagesJson.getJson({ platform }) || {});

    // 合并 pages
    const pages = await this.generatePages(platform);
    if (pages.length > 0) {
      pagesJson.pages = pagesJson.pages || [];
      for (const page of pages) {
        const idx = pagesJson.pages.findIndex(p => p.path === page.path);
        if (idx !== -1) {
          deepAssign(pagesJson.pages[idx], page);
        } else {
          pagesJson.pages.push(page);
        }
      }
    }

    // 合并 subPackages
    const subPackages = await this.generateSubPackages(platform);
    if (subPackages.length > 0) {
      pagesJson.subPackages = pagesJson.subPackages || [];
      for (const sub of subPackages) {
        const idx = pagesJson.subPackages.findIndex(p => p.root === sub.root);
        if (idx !== -1) {
          pagesJson.subPackages[idx].pages = pagesJson.subPackages[idx].pages || [];
          for (const page of (sub.pages || [])) {
            const pidx = pagesJson.subPackages[idx].pages.findIndex(p => p.path === page.path);
            if (pidx !== -1) {
              deepAssign(pagesJson.subPackages[idx].pages[pidx], page);
            } else {
              pagesJson.subPackages[idx].pages.push(page);
            }
          }
        } else {
          pagesJson.subPackages.push(sub);
        }
      }
    }

    // 合并 tabbar
    const subbarItems = await this.generateTabbarItems(platform);
    if (subbarItems.length > 0) {
      pagesJson.tabBar = pagesJson.tabBar || {};
      pagesJson.tabBar.list = pagesJson.tabBar.list || [];
      for (const item of subbarItems) {
        const idx = pagesJson.tabBar.list.findIndex(tb => tb.pagePath === item.pagePath);
        if (idx !== -1) {
          deepAssign(pagesJson.tabBar.list[idx], item);
        } else {
          pagesJson.tabBar.list.push(item);
        }
      }
    }

    this.sortPagesJson(pagesJson);

    return pagesJson;
  }

  /**
   * 根据 platform 生成 pages
   */
  public async generatePages(platform = currentPlatform): Promise<PagesJSON.Page[]> {
    const pages = await this.getPageFileOfPages(platform);
    return Promise.all(pages.map(async pf => pf.getPage({ platform })));
  }

  /**
   * 根据 platform 生成 subPackages
   */
  public async generateSubPackages(platform = currentPlatform): Promise<PagesJSON.SubPackage[]> {
    const pageFiles = await this.getPageFileOfSubPackages(platform);

    const subPackages: Record<string, PagesJSON.SubPackage> = {};
    for (const pf of pageFiles) {
      if (!pf.root) {
        continue;
      }
      subPackages[pf.root] = subPackages[pf.root] || { root: pf.root, pages: [] };

      const page = await pf.getPage({ platform });
      subPackages[pf.root].pages.push(page);
    }
    return Object.values(subPackages);
  }

  /**
   * 根据 platform 获取 tabbar items
   */
  public async generateTabbarItems(platform = currentPlatform): Promise<PagesJSON.TabBarItem[]> {
    const pageFiles = await this.getPageFileOfPages(platform);

    const items: PagesJSON.TabBarItem[] = [];
    for (const pf of pageFiles) {
      const item = await pf.getTabbarItem({ platform });
      if (item) {
        items.push(item);
      }
    }
    return items;
  }

  /**
   * 对 pagesJson 进行排序
   */
  public sortPagesJson(pagesJson: PagesJSON.PagesJson): void {

    // pages 排序： home 页面优先，其他页面按顺序排列
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

    // tabbar 排序： 按 index 升序排列
    if (pagesJson.tabBar && pagesJson.tabBar.list) {
      pagesJson.tabBar.list.sort((a, b) => getTabbarIndex(a) - getTabbarIndex(b));
    }
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
function mergePlatformObject<T extends object>(pf1: BuiltInPlatform, v1: T, pf2: BuiltInPlatform, v2: T, ignoreKeys: string[] = []) {

  const v1keys = new Set(Object.keys(v1));
  const ignores = new Set(ignoreKeys);

  for (const key in v2) {
    if (ignores.has(key)) {
      continue;
    }
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

    if (ignores.has(key)) {
      continue;
    }

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
