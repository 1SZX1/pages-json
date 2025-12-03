import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { CommentToken } from 'comment-json';
import type { DeepPartial } from './types';
import { stringify as cjStringify } from 'comment-json';
import { getPageType, getTabbarIndex } from './page-file';
import { deepAssign } from './utils/object';
import { currentPlatform, type UniPlatform } from './utils/uni-env';

const DEFINES = Symbol('DEFINES_KEY');
const COBJECT = Symbol('COBJECT');

export interface Define<T = any> {
  platforms: UniPlatform[];
  condition: 'ifdef' | 'ifndef';
  value: DeepPartial<T>;
}

export type CObject<T extends object> = T & {
  [DEFINES]: Define<T>[];
};

export class Cond<T extends object> {

  public [COBJECT]: CObject<T>;

  constructor(obj: T) {
    this[COBJECT] = obj as CObject<T>;
    this[COBJECT][DEFINES] ??= [];
  }

  public ifdef(platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>) {
    this[COBJECT] = ifdef(this[COBJECT], platform, obj);
    return this;
  }
}

export function isCond<T extends object>(obj: any): obj is Cond<T> {
  return !!(obj && obj[COBJECT]);
}

export function ifdef<T extends object>(target: CObject<T>, platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>): CObject<T> {
  const platforms = Array.isArray(platform) ? new Set(platform) : new Set([platform]);

  const define: Define<T> = {
    platforms: [...platforms].sort(),
    condition: 'ifdef',
    value: obj,
  };

  return mergeDefine(target, [define]);
}

export function ifndef<T extends object>(target: CObject<T>, platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>): CObject<T> {
  const platforms = Array.isArray(platform) ? new Set(platform) : new Set([platform]);

  const define: Define<T> = {
    platforms: [...platforms].sort(),
    condition: 'ifndef',
    value: obj,
  };

  return mergeDefine(target, [define]);
}

export function getDefine<T extends object>(obj: CObject<T>): Define<T>[];
export function getDefine<T extends object>(obj: T): Define<T>[];
export function getDefine(obj: any): Define<object>[] {
  return obj[DEFINES] || [];
}

export function setDefine<T extends object>(obj: T, defines: Define<T>[]): CObject<T> {
  const res = obj as CObject<T>;
  res[DEFINES] = defines;
  return res;
}

export function mergeDefine<T extends object>(obj: T, defines: Define<T>[]): CObject<T> {
  const res = obj as CObject<T>;
  res[DEFINES] ??= [];

  for (const define of defines) {

    const platforms = new Set(define.platforms);

    const def = res[DEFINES].find(d => d.condition === define.condition && d.platforms.length === platforms.size && d.platforms.every(p => platforms.has(p)));

    if (def) {
      def.value = {
        ...def.value,
        ...define.value,
      };
    } else {
      define.platforms.sort();
      res[DEFINES].push(define);
    }
  }

  return res;
}

export function getPlatforms(obj: any): UniPlatform[] {

  const val = isCond(obj) ? obj[COBJECT] : obj;

  const platforms = new Set<UniPlatform>();
  for (const define of val[DEFINES] || []) {
    for (const p of define.platforms) {
      platforms.add(p);
    }
  }
  return [...platforms].sort();
}

export function unwrap<T extends object>(cond: Cond<T>): CObject<T> {
  return cond[COBJECT];
}

function _getByPlatform<T extends object>(obj: T, result: any, platform = currentPlatform()) {

  for (const k in obj) {
    const v = obj[k];

    // 数组
    if (Array.isArray(v)) {
      result[k] ??= [];
      _getByPlatform(v, result[k], platform);
      continue;
    }

    // 对象
    if (typeof v === 'object' && v != null) {
      result[k] ??= {};
      _getByPlatform(v, result[k], platform);
      continue;
    }

    result[k] = v;
  }

  const defines = getDefine(obj);
  for (const def of defines) {
    if (def.condition === 'ifdef' && def.platforms.includes(platform)) {
      deepAssign(result, def.value);
      continue;
    }

    if (def.condition === 'ifndef' && !def.platforms.includes(platform)) {
      deepAssign(result, def.value);
      continue;
    }
  }
}

export function toObject<T extends object>(obj: CObject<T>, platform?: UniPlatform): T;
export function toObject<T extends object>(obj: T, platform?: UniPlatform): T;
export function toObject<T extends object>(obj: T, platform = currentPlatform()): T {
  const res = {} as any;
  _getByPlatform(obj, res, platform);
  return res;
}

function mergeObject<T extends object>(pf1: UniPlatform, val1: T, pf2: UniPlatform, val2: T, ignoreKeys: string[] = []) {

  const v1 = val1 as any;
  const v2 = val2 as any;

  const v1keys = new Set(Object.keys(v1));
  const ignores = new Set(ignoreKeys); // TODO: 支持点符号

  for (const v2k in v2) {
    if (ignores.has(v2k)) {
      continue;
    }

    v1keys.delete(v2k); // 删除已对比的 key

    if (v1[v2k] === v2[v2k]) {
      continue; // 值相同，跳过
    }

    if (v1[v2k] !== undefined && v2[v2k] !== undefined) {
      if (Array.isArray(v2[v2k])) {
        const s1 = JSON.stringify(v1[v2k]);
        const s2 = JSON.stringify(v2[v2k]);
        if (s1 === s2) {
          continue;
        }
      } else if (typeof v2[v2k] === 'object' && v2[v2k] !== null && v1[v2k] !== null) {
        mergeObject(pf1, v1[v2k], pf2, v2[v2k]); // 递归合并
        continue; // 下一个循环
      }
    }

    // 下面为不相等的处理

    if (v1[v2k] !== undefined) {
      const val = v1[v2k];
      v1[v2k] = undefined; // 将其标识为 undefined，避免 stringify 时显示
      markIfdef(v1, pf1, v2k, val);
    }

    if (v2[v2k] !== undefined) {
      markIfdef(v1, pf2, v2k, v2[v2k]);
    }
  }

  // 处理 v2 不存在的 key
  for (const v1k of v1keys) {
    if (ignores.has(v1k)) {
      continue;
    }

    if (v1[v1k] !== undefined) {
      const val = v1[v1k];
      v1[v1k] = undefined; // 将其标识为 undefined，避免 stringify 时显示
      markIfdef(v1, pf1, v1k, val);
    }
  }
}

const PF_ARR_ITEM_KEY = Symbol.for('platform-array-item');

function mergeArray<T extends object>(pf1: UniPlatform, arr1: T[], pf2: UniPlatform, arr2: T[], getUniqueKey: (v: T) => string) {

  const v1s = arr1 as any[];
  const v2s = arr2 as any[];

  let offset = 0;

  for (const v2 of v2s) {
    const v2id = getUniqueKey(v2);
    const v1 = v1s.find((v) => {
      if (getUniqueKey(v) !== v2id) {
        return false;
      }
      const pf = v[PF_ARR_ITEM_KEY] as UniPlatform | undefined;
      return pf === undefined || pf === pf2;
    });

    if (v1 !== undefined) {
      mergeObject(pf1, v1, pf2, v2);
      continue;
    }

    markIfdef(v1s, pf2, v1s.length + offset, v2);
    offset++;
  }
}

interface PValue {
  platforms: UniPlatform[];
  key: string | number;
  value: any;
}

const CONDITIONAL_KEY = Symbol.for('CONDITIONAL_KEY');

function markIfdef(obj: object, platform: UniPlatform, key: string | number, val: any) {
  const target = obj as any;
  const pvalues = (target[CONDITIONAL_KEY] || []) as PValue[];

  const pval = pvalues.find(p => p.key === key && p.value === val);
  if (pval) {
    pval.platforms = [...new Set([...pval.platforms, platform])].sort();
  } else {
    pvalues.push({
      platforms: [platform],
      key,
      value: val,
    });
  }

  target[CONDITIONAL_KEY] = pvalues;
}

function aliasIfdef(obj: object) {
  const target = obj as any;
  for (const [k, v] of Object.entries(target)) {
    if (k.includes('#ifdef')) {
      continue;
    }

    if (Array.isArray(v)) {
      for (const item of v) {
        aliasIfdef(item);
      }
      continue;
    }

    if (typeof v === 'object' && v != null) {
      aliasIfdef(v);
    }
  }

  const pvalues = (target[CONDITIONAL_KEY] || []) as PValue[];
  for (const pval of pvalues) {
    if (Array.isArray(target)) {
      let idx = Number(pval.key);
      if (idx < target.length) {
        idx = target.length;
      }
      target[idx] = pval.value;
      wrapIfdef(target, idx, pval.platforms);
      continue;
    }

    const alias = `${pval.key}#ifdef_${pval.platforms.join('_')}`;
    target[alias] = pval.value;
    wrapIfdef(target, alias, pval.platforms);
  }

  delete target[CONDITIONAL_KEY];
}

function wrapIfdef(obj: any, key: string | number, platforms: string[]): void {

  const upperPlatforms = platforms.map(p => p.toUpperCase());

  obj[Symbol.for(`before:${key}`)] = obj[Symbol.for(`before:${key}`)] || [] as CommentToken[];
  obj[Symbol.for(`before:${key}`)] = [{
    type: 'LineComment',
    value: ` #ifdef ${upperPlatforms.join(' || ')}`,
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
 * 对 pagesJson 进行排序
 */
function sortPagesJson(pagesJson: PagesJSON.PagesJson): void {

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

/**
 * 将多个平台的 pages.json 合并成一个静态 pages.json
 */
export function stringify(jsons: Record<UniPlatform, PagesJSON.PagesJson>, indent = 4): string {
  const [p1 = currentPlatform(), ...p2s] = Object.keys(jsons).sort() as UniPlatform[];

  const pagesJson = jsons[p1] || {};

  sortPagesJson(pagesJson);

  for (const p2 of p2s) {
    const j2 = jsons[p2];

    sortPagesJson(j2);

    // 合并不同平台的 pages
    if (j2.pages) {
      pagesJson.pages ??= [];
      mergeArray(p1, pagesJson.pages, p2, j2.pages, v => v.path);
    }
    // 合并不同平台的 subPackages
    if (j2.subPackages) {
      pagesJson.subPackages ??= [];
      for (const j2Sub of j2.subPackages) {
        const idx = pagesJson.subPackages.findIndex(s => s.root === j2Sub.root);
        if (idx > -1) {
          mergeObject(p1, pagesJson.subPackages[idx], p2, j2Sub, ['pages']);
          if (j2Sub.pages && j2Sub.pages.length > 0) {
            pagesJson.subPackages[idx].pages = pagesJson.subPackages[idx].pages || [];
            mergeArray(p1, pagesJson.subPackages[idx].pages, p2, j2Sub.pages, v => v.path);
          }
        } else {
          pagesJson.subPackages.push(j2Sub);
        }
      }
    }
    // 合并不同平台的 tabBar
    if (j2.tabBar) {
      pagesJson.tabBar ??= {};
      mergeObject(p1, pagesJson.tabBar, p2, j2.tabBar, ['list']);
      if (j2.tabBar.list && j2.tabBar.list.length > 0) {
        pagesJson.tabBar.list ??= [];
        mergeArray(p1, pagesJson.tabBar.list, p2, j2.tabBar.list, v => v.pagePath);
      }
    }

    // 合并除 pages、subPackages、tabBar 外的其他属性
    mergeObject(p1, pagesJson, p2, j2, ['pages', 'subPackages', 'tabBar']);
  }

  aliasIfdef(pagesJson); // 将 conditional 标识转为 key 别名，方便 stringify

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
