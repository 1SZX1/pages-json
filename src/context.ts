import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { CommentToken } from 'comment-json';
import type { ResolvedConfig } from './config';
import type { PageFileOption } from './page-file';
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { stringify as cjStringify } from 'comment-json';
import fg from 'fast-glob';
import { writeDeclaration } from './declaration';
import { getPageType, getTabbarIndex, PageFile } from './page-file';
import { PagesConfigFile } from './pages-config-file';
import { debug } from './utils/debug';
import { checkFileSync, detectIndent } from './utils/file';
import { deepAssign } from './utils/object';
import { currentPlatform, type UniPlatform } from './utils/uni-env';
import { sleep } from './utils/utils';

interface JsonFileInfo {
  indent: number;
  eof: string;
  content: string;
}

export class Context {

  /**
   * 配置
   */
  private readonly cfg: ResolvedConfig;

  /**
   * 全局动态 pages.json 文件
   */
  private pagesConfigFile: PagesConfigFile;

  /**
   * Map<filepath, PageFile>
   */
  public files = new Map<string, PageFile>();

  /**
   * json 文件路径
   */
  private jsonFilePath: string;

  /**
   * json 文件信息
   */
  private jsonFileInfo?: JsonFileInfo;

  /**
   * 更新状态
   */
  private updating: Promise<boolean> | null = null;

  constructor(config: ResolvedConfig) {
    this.cfg = config;
    this.pagesConfigFile = new PagesConfigFile(config);

    this.jsonFilePath = path.join(this.cfg.src, 'pages.json');
  }

  /**
   * 扫描文件
   */
  public async scanFiles(): Promise<void> {

    const files = new Map<string, PageFile>();

    function parsePagePath(baseDir: string, filepath: string): string {
      const rel = path.relative(baseDir, filepath);
      return rel.replace(path.extname(rel), '').replaceAll('\\', '/');
    };

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
    }

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

  /**
   * 获取主包页面文件
   */
  public async getMainPageFiles(platform = currentPlatform()): Promise<PageFile[]> {
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

  /**
   * 获取分包页面文件
   */
  public async getSubPageFiles(platform = currentPlatform()): Promise<PageFile[]> {
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
   * 更新 pages.json
   *
   * @param filepath 指定更新的文件，空则更新所有文件
   */
  public async updatePagesJSON(filepath?: string): Promise<boolean> {

    if (!(await this.needUpdate(filepath))) {
      return false;
    }

    if (this.updating) {
      return await this.updating;
    }

    // 控制更新频率
    this.updating = this.doUpdate(100).finally(() => {
      setTimeout(() => {
        this.updating = null;
      }, 0);
    });

    return await this.updating;
  }

  /**
   * 将多个平台的 pages.json 合并成一个静态 pages.json
   */
  public stringifyPagesJson(jsons: Record<UniPlatform, PagesJSON.PagesJson>, indent = 4): string {
    const [p1 = currentPlatform(), ...p2s] = Object.keys(jsons).sort() as UniPlatform[];

    const pagesJson = jsons[p1] || {};

    for (const p2 of p2s) {
      const j2 = jsons[p2];

      // 合并不同平台的 pages
      if (j2.pages) {
        pagesJson.pages ??= [];
        mergePlatformArray(p1, pagesJson.pages, p2, j2.pages, v => v.path);
      }
      // 合并不同平台的 subPackages
      if (j2.subPackages) {
        pagesJson.subPackages ??= [];
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
        pagesJson.tabBar ??= {};
        mergePlatformObject(p1, pagesJson.tabBar, p2, j2.tabBar, ['list']);
        if (j2.tabBar.list && j2.tabBar.list.length > 0) {
          pagesJson.tabBar.list ??= [];
          mergePlatformArray(p1, pagesJson.tabBar.list, p2, j2.tabBar.list, v => v.pagePath);
        }
      }

      // 合并除 pages、subPackages、tabBar 外的其他属性
      mergePlatformObject(p1, pagesJson, p2, j2, ['pages', 'subPackages', 'tabBar']);
    }

    this.sortPagesJson(pagesJson);

    let rawJson = cjStringify(pagesJson, null, indent);

    // 清理 key 后缀
    rawJson = rawJson.replace(/"([^"]+)#ifdef_.*?"/g, '"$1"');

    // 修复 #ifdef 行注释位置。（comment-json 将此行注释放在上一个行的末尾，而不是同等缩进的新行）
    // eslint-disable-next-line regexp/no-super-linear-backtracking
    rawJson = rawJson.replace(/\n(\s*.+?)\s*(\/\/ #ifdef .*)\n(\s*)/g, '\n$1\n$3$2\n$3');

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
  public async generatePagesJson(platform = currentPlatform()): Promise<PagesJSON.PagesJson> {
    const pagesJson = (await this.pagesConfigFile.getJson(platform) || {});

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
      pagesJson.subPackages ??= [];
      for (const sub of subPackages) {
        const idx = pagesJson.subPackages.findIndex(p => p.root === sub.root);
        if (idx !== -1) {
          pagesJson.subPackages[idx].pages ??= [];
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
      pagesJson.tabBar ??= {};
      pagesJson.tabBar.list ??= [];
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
  private async generatePages(platform = currentPlatform()): Promise<PagesJSON.Page[]> {
    const pages = await this.getMainPageFiles(platform);
    return Promise.all(pages.map(async pf => pf.getPage({ platform })));
  }

  /**
   * 根据 platform 生成 subPackages
   */
  private async generateSubPackages(platform = currentPlatform()): Promise<PagesJSON.SubPackage[]> {
    const files = await this.getSubPageFiles(platform);

    const subPackages: Record<string, PagesJSON.SubPackage> = {};
    for (const pf of files) {
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
  private async generateTabbarItems(platform = currentPlatform()): Promise<PagesJSON.TabBarItem[]> {
    const files = await this.getMainPageFiles(platform);

    const items: PagesJSON.TabBarItem[] = [];
    for (const pf of files) {
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
  private sortPagesJson(pagesJson: PagesJSON.PagesJson): void {

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

  private async needUpdate(filepath?: string): Promise<boolean> {

    if (!filepath) { // 未指定文件，则更新所有文件
      await this.scanFiles();
      return true;
    }

    const abspath = path.isAbsolute(filepath)
      ? filepath
      : path.join(this.cfg.root, filepath);

    // 检测是否合格的动态 pages.json 文件
    if (this.pagesConfigFile.isValid(abspath)) {
      if (abspath !== this.pagesConfigFile.path) {
        this.pagesConfigFile.path = abspath;
      }
      this.pagesConfigFile.fresh();
      return true;
    }

    // 检测是否合格的 page 文件
    if (PageFile.isValid(abspath)) {
      const pageFile = this.files.get(abspath);
      if (pageFile) { // 文件存在
        pageFile.fresh();
        return true;
      } else { // 文件不存在，扫描全局文件
        await this.scanFiles();
        return true;
      }
    }

    // 既不是 page config 文件 又不是 page 文件
    debug.info(`文件 ${filepath} 不是 pages.json 相关文件，跳过更新。`);
    return false;
  }

  private async doUpdate(delay = 100) {

    await sleep(delay); // 控制更新频率

    if (this.files.size === 0) {
      await this.scanFiles(); // 避免每次都扫描全局
    }

    this.checkJsonFileSync();
    const { indent, eof, content } = await this.detectJsonFile(true);
    const platforms = await this.getPlatforms();

    const jsons = {} as Record<UniPlatform, PagesJSON.PagesJson>;

    for (const platform of platforms) {
      jsons[platform] = await this.generatePagesJson(platform);
    }

    const rawJson = this.stringifyPagesJson(jsons, indent) + eof;

    if (content === rawJson) {
      debug.info('pages.json 无改动，跳过更新。');
      return false;
    }

    await fs.promises.writeFile(this.jsonFilePath, rawJson);

    if (this.cfg.dts) {
      await writeDeclaration(jsons, this.cfg.dts as string);
    }

    debug.info('pages.json 更新成功。');

    return true;
  }

  private getRunningPlatforms(): UniPlatform[] {

    const readCacheFile = (file: string): Partial<Record<UniPlatform, number>>[] => {
      try {
        const exist = fs.existsSync(file);
        if (!exist) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          return [];
        }

        const json = fs.readFileSync(file, 'utf-8');

        return JSON.parse(json);
      } catch {
        return [];
      }
    };

    const cacheFile = path.join(this.cfg.cacheDir, 'running-platforms.json');
    const list = readCacheFile(cacheFile);

    let res: Partial<Record<UniPlatform, number>> = {};

    if (list.length > 0) {
      res = { ...list[0] };
    }

    if (list.length >= 2) {
      for (const [oldKey, oldVal] of Object.entries(list[1])) {
        const newVal = res[oldKey as UniPlatform];
        if (newVal && newVal === oldVal) {
          delete res[oldKey as UniPlatform]; // 如果旧的缓存时间和新的缓存时间一致，则删除旧的缓存
        }
      }
    }

    const now = new Date();
    debug.debug(`更新 running platforms [${currentPlatform()}], 时间：${now.toLocaleString()}`);

    res[currentPlatform()] = now.getTime(); // 更新当前平台运行时间

    list.unshift(res);

    fs.writeFileSync(cacheFile, JSON.stringify(list.slice(0, 3), null, 2));

    return [...Object.keys(res)].filter(Boolean) as UniPlatform[];
  }

  public async getPlatforms(): Promise<UniPlatform[]> {
    const platforms = new Set<UniPlatform>(this.cfg.platform);

    const jsonPlatforms = await this.pagesConfigFile.getPlatforms();
    jsonPlatforms.forEach(platform => platforms.add(platform));

    for (const [, file] of this.files) {
      const fp = await file.getPlatforms();
      fp.forEach(platform => platforms.add(platform));
    }

    const runningPlatforms = this.getRunningPlatforms();
    runningPlatforms.forEach(platform => platforms.add(platform));

    return Array.from(platforms).sort();
  }

  /**
   * 检查静态文件
   */
  public checkJsonFileSync(): boolean {
    return checkFileSync({
      path: this.jsonFilePath,
      newContent: JSON.stringify({ pages: [{ path: '' }] }, null, 4),
      modeFlag: fs.constants.R_OK | fs.constants.W_OK,
    });
  }

  /**
   * 读取 json 文件内容，并检测文件信息（代码缩进、末端换行）
   */
  public async detectJsonFile(forceUpdate = false): Promise<JsonFileInfo> {
    if (!forceUpdate && this.jsonFileInfo) {
      return this.jsonFileInfo;
    }

    const detect = async () => {
      const res = {
        platforms: new Set<UniPlatform>([currentPlatform()]),
        indent: 4,
        eof: '\n',
        content: '',
      };

      const content = await fs.promises.readFile(this.jsonFilePath, { encoding: 'utf-8' }).catch(() => '');
      if (!content) {
        return res;
      }

      res.content = content;

      try {
        res.indent = detectIndent(content);

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

  /**
   * 监听文件
   */
  public watch() {

    const paths: string[] = [];

    for (const dir of [this.cfg.pageDir, ...this.cfg.subPackageDirs]) {
      for (const ext of PageFile.exts) {
        paths.push(path.join(dir, `**/*${ext}`));
      }
    }

    const watcher = chokidar.watch([
      ...paths,
      ...this.cfg.pagesJsonFilePaths,
    ], {
      ignored: this.cfg.exclude,
    });

    setTimeout(() => {
      watcher.on('add', async (file) => {
        debug.debug(`新增文件: ${file}`);
        await this.updatePagesJSON(file);
      });

      watcher.on('change', async (file) => {
        debug.debug(`修改文件: ${file}`);
        await this.updatePagesJSON(file);
      });

      watcher.on('unlink', async (file) => {
        debug.debug(`删除文件: ${file}`);
        await this.updatePagesJSON();
      });
    }, 100); // 延迟 100ms，避免第一次扫描时触发更新
  }

}

const PF_ARR_ITEM_KEY = Symbol.for('platform-array-item');

/**
 * 合并两个不同平台的数组
 *
 * @param pf1 平台名称 1
 * @param v1  值 1
 * @param pf2 平台名称 2
 * @param v2  值 2
 * @param getKey 获取元素的 key
 */
function mergePlatformArray<T extends object>(pf1: UniPlatform, v1: T[], pf2: UniPlatform, v2: T[], getKey: (v: T) => string) {
  for (const v2item of v2) {
    const v2key = getKey(v2item);
    const v1idx = v1.findIndex((v) => {
      if (getKey(v) !== v2key) {
        return false;
      }
      const pf = (v as any)[PF_ARR_ITEM_KEY] as UniPlatform | undefined;
      return pf === undefined || pf === pf2;
    });
    if (v1idx > -1) {
      mergePlatformObject(pf1, v1[v1idx], pf2, v2item);
      continue;
    }

    const idx = v1.length;
    (v2item as any)[PF_ARR_ITEM_KEY] = pf2;
    v1.push(v2item);
    wrapIfdef(v1, idx, pf2);
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
function mergePlatformObject<T extends object>(pf1: UniPlatform, v1: T, pf2: UniPlatform, v2: T, ignoreKeys: string[] = []) {

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
    (v1 as any)[p1pk] ??= v1Child;
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

function wrapIfdef(obj: any, key: string | number, platform: string): void {

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
