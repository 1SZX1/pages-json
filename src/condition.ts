import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { CommentToken } from 'comment-json';
import type { DeepPartial } from './types';
import { stringify as cjStringify } from 'comment-json';
import { getPageType, getTabbarIndex } from './page-file';
import { deepAssign } from './utils/object';
import { currentPlatform, type UniPlatform } from './utils/uni-env';

const CONDITION_DEFINES_KEY = Symbol('CONDITION_DEFINES_KEY');
const CONDITIONAL_OBJECT_KEY = Symbol('CONDITIONAL_OBJECT_KEY');
const CONDITIONAL_VALUES_KEY = Symbol('CONDITIONAL_VALUES_KEY');
const PLATFORM_ARRAY_ITEM_KEY = Symbol('PLATFORM_ARRAY_ITEM_KEY');

export interface ConditionDefine<T = any> {
  platforms: UniPlatform[];
  condition: 'ifdef' | 'ifndef';
  value: DeepPartial<T>;
}

export type ConditionalObject<T extends object> = T & {
  [CONDITION_DEFINES_KEY]: ConditionDefine<T>[];
};

export class Conditional<T extends object> {

  public [CONDITIONAL_OBJECT_KEY]: ConditionalObject<T>;

  constructor(obj: T) {
    this[CONDITIONAL_OBJECT_KEY] = obj as ConditionalObject<T>;
    this[CONDITIONAL_OBJECT_KEY][CONDITION_DEFINES_KEY] ??= [];
  }

  /**
   * 添加条件编译定义，当指定平台存在时生效
   */
  public ifdef(platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>) {
    this[CONDITIONAL_OBJECT_KEY] = addIfdef(this[CONDITIONAL_OBJECT_KEY], platform, obj);
    return this;
  }

  /**
   * 添加条件编译定义，当指定平台不存在时生效
   */
  public ifndef(platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>) {
    this[CONDITIONAL_OBJECT_KEY] = addIfndef(this[CONDITIONAL_OBJECT_KEY], platform, obj);
    return this;
  }
}

export function isConditional<T extends object>(obj: any): obj is Conditional<T> {
  return !!(obj && obj[CONDITIONAL_OBJECT_KEY]);
}

export function addIfdef<T extends object>(target: ConditionalObject<T>, platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>): ConditionalObject<T>;
export function addIfdef<T extends object>(target: T, platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>): ConditionalObject<T>;
export function addIfdef<T extends object>(target: T, platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>): ConditionalObject<T> {
  const platforms = Array.isArray(platform) ? new Set(platform) : new Set([platform]);

  const conditionDefine: ConditionDefine<T> = {
    platforms: [...platforms].sort(),
    condition: 'ifdef',
    value: obj,
  };

  return mergeConditionDefines(target, [conditionDefine]);
}

export function addIfndef<T extends object>(target: ConditionalObject<T>, platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>): ConditionalObject<T>;
export function addIfndef<T extends object>(target: T, platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>): ConditionalObject<T>;
export function addIfndef<T extends object>(target: T, platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>): ConditionalObject<T> {
  const platforms = Array.isArray(platform) ? new Set(platform) : new Set([platform]);

  const conditionDefine: ConditionDefine<T> = {
    platforms: [...platforms].sort(),
    condition: 'ifndef',
    value: obj,
  };

  return mergeConditionDefines(target, [conditionDefine]);
}

export function getConditionDefines<T extends object>(obj: ConditionalObject<T>): ConditionDefine<T>[];
export function getConditionDefines<T extends object>(obj: T): ConditionDefine<T>[];
export function getConditionDefines(obj: any): ConditionDefine<object>[] {
  return obj[CONDITION_DEFINES_KEY] || [];
}

export function setConditionDefines<T extends object>(obj: ConditionalObject<T>, defines: ConditionDefine<T>[]): ConditionalObject<T>;
export function setConditionDefines<T extends object>(obj: T, defines: ConditionDefine<T>[]): ConditionalObject<T>;
export function setConditionDefines<T extends object>(obj: T, defines: ConditionDefine<T>[]): ConditionalObject<T> {
  const res = obj as ConditionalObject<T>;
  res[CONDITION_DEFINES_KEY] = defines;
  return res;
}

export function mergeConditionDefines<T extends object>(obj: ConditionalObject<T>, defines: ConditionDefine<T>[]): ConditionalObject<T>;
export function mergeConditionDefines<T extends object>(obj: T, defines: ConditionDefine<T>[]): ConditionalObject<T>;
export function mergeConditionDefines<T extends object>(obj: T, defines: ConditionDefine<T>[]): ConditionalObject<T> {
  const result = obj as ConditionalObject<T>;
  result[CONDITION_DEFINES_KEY] ??= [];

  for (const define of defines) {

    const platformsSet = new Set(define.platforms);

    const def = result[CONDITION_DEFINES_KEY].find(d =>
      d.condition === define.condition
      && d.platforms.length === platformsSet.size
      && platformsSet.size > 0 // 避免空集合的无效比较
      && d.platforms.every(p => platformsSet.has(p)),
    );

    if (def) {
      def.value = {
        ...def.value,
        ...define.value,
      };
    } else {
      define.platforms.sort();
      result[CONDITION_DEFINES_KEY].push(define);
    }
  }

  return result;
}

export function getSupportedPlatforms(obj: any): UniPlatform[] {

  const val = isConditional(obj) ? obj[CONDITIONAL_OBJECT_KEY] : obj;

  const platforms = new Set<UniPlatform>();
  for (const define of val[CONDITION_DEFINES_KEY] || []) {
    for (const p of define.platforms) {
      platforms.add(p);
    }
  }
  return [...platforms].sort();
}

export function unwrapConditional<T extends object>(cond: Conditional<T>): ConditionalObject<T> {
  return cond[CONDITIONAL_OBJECT_KEY];
}

function _resolveByPlatform<T extends object>(obj: T, result: any, platform = currentPlatform()) {
  for (const key in obj) {
    const value = obj[key];

    // 处理数组
    if (Array.isArray(value)) {
      result[key] ??= [];
      _resolveByPlatform(value, result[key], platform);
      continue;
    }

    // 处理对象
    if (typeof value === 'object' && value != null) {
      result[key] ??= {};
      _resolveByPlatform(value, result[key], platform);
      continue;
    }

    result[key] = value;
  }

  const conditionDefines = getConditionDefines(obj).filter(define =>
    (define.condition === 'ifdef' && define.platforms.includes(platform))
    || (define.condition === 'ifndef' && !define.platforms.includes(platform)),
  );

  for (const define of conditionDefines) {
    deepAssign(result, define.value);
  }
}

export function resolveToObject<T extends object>(obj: ConditionalObject<T>, platform?: UniPlatform): T;
export function resolveToObject<T extends object>(obj: T, platform?: UniPlatform): T;
export function resolveToObject<T extends object>(obj: T, platform = currentPlatform()): T {
  const res = {} as any;
  _resolveByPlatform(obj, res, platform);
  return res;
}

function mergeObjectsByPlatform<T extends object>(
  platform1: UniPlatform,
  value1: T,
  platform2: UniPlatform,
  value2: T,
  ignoreKeys: string[] = [],
) {
  const object1 = value1 as any;
  const object2 = value2 as any;

  const object1Keys = new Set(Object.keys(object1));
  const ignoredKeys = new Set(ignoreKeys);

  for (const key2 in object2) {
    if (ignoredKeys.has(key2)) {
      continue;
    }

    object1Keys.delete(key2);

    if (object1[key2] === object2[key2]) {
      continue;
    }

    if (object1[key2] !== undefined && object2[key2] !== undefined) {
      if (Array.isArray(object2[key2])) {
        const string1 = JSON.stringify(object1[key2]);
        const string2 = JSON.stringify(object2[key2]);
        if (string1 === string2) {
          continue;
        }
      } else if (typeof object2[key2] === 'object' && object2[key2] !== null && object1[key2] !== null) {
        mergeObjectsByPlatform(platform1, object1[key2], platform2, object2[key2]);
        continue;
      }
    }

    // 处理不相等的值
    if (object1[key2] !== undefined) {
      const value = object1[key2];
      object1[key2] = undefined;
      markIfdef(object1, platform1, key2, value);
    }

    if (object2[key2] !== undefined) {
      markIfdef(object1, platform2, key2, object2[key2]);
    }
  }

  // 处理 object2 中不存在的键
  for (const key1 of object1Keys) {
    if (ignoredKeys.has(key1)) {
      continue;
    }

    if (object1[key1] !== undefined) {
      const value = object1[key1];
      object1[key1] = undefined;
      markIfdef(object1, platform1, key1, value);
    }
  }
}

function mergeArraysByPlatform<T extends object>(
  platform1: UniPlatform,
  array1: T[],
  platform2: UniPlatform,
  array2: T[],
  getUniqueKey: (v: T) => string,
) {
  const items1 = array1 as any[];
  const items2 = array2 as any[];
  let offset = 0;

  // 优化：使用 Map 提高查找效率
  const items1Map = new Map(items1.map(item => [getUniqueKey(item), item]));

  for (const item2 of items2) {
    const item2Id = getUniqueKey(item2);
    const item1 = items1Map.get(item2Id);

    if (item1 && canMergeItems(item1, platform2)) {
      mergeObjectsByPlatform(platform1, item1, platform2, item2);
      continue;
    }

    markIfdef(items1, platform2, items1.length + offset, item2);
    offset++;
  }
}

function canMergeItems(item: any, targetPlatform: UniPlatform): boolean {
  const platform = item[PLATFORM_ARRAY_ITEM_KEY] as UniPlatform | undefined;
  return platform === undefined || platform === targetPlatform;
};

interface IfdefValue {
  platforms: UniPlatform[];
  key: string | number;
  value: any;
}

function markIfdef(obj: object, platform: UniPlatform, key: string | number, val: any) {
  const target = obj as any;
  const pvalues = (target[CONDITIONAL_VALUES_KEY] || []) as IfdefValue[];

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

  target[CONDITIONAL_VALUES_KEY] = pvalues;
}

function convertIfdefToAlias(obj: object) {
  const target = obj as any;
  for (const [key, value] of Object.entries(target)) {
    if (key.includes('#ifdef')) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        convertIfdefToAlias(item);
      }
      continue;
    }

    if (typeof value === 'object' && value != null) {
      convertIfdefToAlias(value);
    }
  }

  const conditionalValues = (target[CONDITIONAL_VALUES_KEY] || []) as IfdefValue[];
  for (const conditionalValue of conditionalValues) {
    if (Array.isArray(target)) {
      let index = Number(conditionalValue.key);
      if (index < target.length) {
        index = target.length;
      }
      target[index] = conditionalValue.value;
      wrapIfdefComment(target, index, conditionalValue.platforms);
      continue;
    }

    const aliasKey = `${conditionalValue.key}#ifdef_${conditionalValue.platforms.join('_')}`;
    target[aliasKey] = conditionalValue.value;
    wrapIfdefComment(target, aliasKey, conditionalValue.platforms);
  }

  delete target[CONDITIONAL_VALUES_KEY];
}

function wrapIfdefComment(obj: any, key: string | number, platforms: string[]): void {

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
      mergeArraysByPlatform(p1, pagesJson.pages, p2, j2.pages, v => v.path);
    }
    // 合并不同平台的 subPackages
    if (j2.subPackages) {
      pagesJson.subPackages ??= [];
      for (const j2Sub of j2.subPackages) {
        const idx = pagesJson.subPackages.findIndex(s => s.root === j2Sub.root);
        if (idx > -1) {
          mergeObjectsByPlatform(p1, pagesJson.subPackages[idx], p2, j2Sub, ['pages']);
          if (j2Sub.pages && j2Sub.pages.length > 0) {
            pagesJson.subPackages[idx].pages = pagesJson.subPackages[idx].pages || [];
            mergeArraysByPlatform(p1, pagesJson.subPackages[idx].pages, p2, j2Sub.pages, v => v.path);
          }
        } else {
          pagesJson.subPackages.push(j2Sub);
        }
      }
    }
    // 合并不同平台的 tabBar
    if (j2.tabBar) {
      pagesJson.tabBar ??= {};
      mergeObjectsByPlatform(p1, pagesJson.tabBar, p2, j2.tabBar, ['list']);
      if (j2.tabBar.list && j2.tabBar.list.length > 0) {
        pagesJson.tabBar.list ??= [];
        mergeArraysByPlatform(p1, pagesJson.tabBar.list, p2, j2.tabBar.list, v => v.pagePath);
      }
    }

    // 合并除 pages、subPackages、tabBar 外的其他属性
    mergeObjectsByPlatform(p1, pagesJson, p2, j2, ['pages', 'subPackages', 'tabBar']);
  }

  convertIfdefToAlias(pagesJson); // 将 conditional 标识转为 key 别名，方便 stringify

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
