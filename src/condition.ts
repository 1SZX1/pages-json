import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { DeepPartial } from './types';
import * as cjson from 'comment-json';
import { getPageType, getTabbarIndex } from './page-file';
import { deepMerge } from './utils/object';
import { currentPlatform, type UniPlatform } from './utils/uni-env';

const PLATFORMS = Symbol('PLATFORMS');
const DEFINES = Symbol('DEFINES');
const CONDITION = Symbol('CONDITION');

/**
 * 重构后：Key<T> 直接约束为 keyof T 的子类型，保证索引兼容性
 * - 数组：Key<T> = number（keyof T[] 的子类型）
 * - 对象：Key<T> = keyof T
 * - 非对象/数组：never
 */
type Key<T> = keyof T & (
  T extends any[]
    ? number
    : T extends object
      ? keyof T
      : never
);

export type ConditionValue<
  T extends object | any[],
  K extends Key<T> = Key<T>,
> = T & {
  [PLATFORMS]: UniPlatform[];
  [DEFINES]: Map<K, Define[]>;
};

interface Define {
  platforms: UniPlatform[];
  platformStr: string;
  condition: 'ifdef' | 'ifndef';
  value: any;
}

export function conditionValue<
  T extends object | any[] | Condition<T, K>,
  K extends Key<T> = Key<T>,
>(orig: T, ...platform: UniPlatform[]): ConditionValue<T, K> {

  if (isCondition<T, K>(orig)) {
    return conditionValue(orig[CONDITION], ...platform);
  }

  if (isConditionValue<T, K>(orig)) {
    if (platform.length > 0) {
      orig[PLATFORMS] = [...new Set([...(orig[PLATFORMS] || []), ...platform])].sort();
    }
    return orig;
  }

  const result = orig as ConditionValue<T, K>;
  result[PLATFORMS] = [...new Set([...(result[PLATFORMS] || []), ...platform])].sort();
  result[DEFINES] = result[DEFINES] || new Map();

  return result;
}

export class Condition<T extends object, K extends Key<T> = Key<T>> {
  public [CONDITION]: ConditionValue<T, K>;
  constructor(orig: T, ...platform: UniPlatform[]) {
    this[CONDITION] = conditionValue(orig, ...platform);
  }

  public ifdef(platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>) {
    ifdef(this[CONDITION], platform, obj);
    return this;
  }

  public ifndef(platform: UniPlatform | UniPlatform[], obj: DeepPartial<T>) {
    ifndef(this[CONDITION], platform, obj);
    return this;
  }
}

export function isCondition<T extends object, K extends Key<T> = Key<T>>(obj?: Condition<T, K> | any): obj is Condition<T, K> {
  if (!obj) {
    return false;
  }

  return (obj as Condition<T, K>)[CONDITION] !== undefined;
}

export function isConditionValue<T extends object | any[], K extends Key<T>>(obj?: T): obj is ConditionValue<T, K> {
  if (!obj) {
    return false;
  }

  return (obj as any)[PLATFORMS] !== undefined && (obj as any)[DEFINES] !== undefined;
}

export function ifdef<T extends object, K extends Key<T>>(
  orig: ConditionValue<T, K>,
  platform: UniPlatform | UniPlatform[],
  obj: DeepPartial<T>,
) {
  addCondition(orig, 'ifdef', platform, obj);
}

export function ifndef<T extends object, K extends Key<T>>(
  orig: ConditionValue<T, K>,
  platform: UniPlatform | UniPlatform[],
  obj: DeepPartial<T>,
) {
  addCondition(orig, 'ifndef', platform, obj);
}

export function resolveCondition<T extends object, K extends Key<T> = Key<T>>(
  obj: T | ConditionValue<T, K> | Condition<T, K>,
  platform: UniPlatform,
): T {

  if (obj instanceof Condition) {
    return resolveCondition(obj[CONDITION], platform);
  }

  const isArr = Array.isArray(obj);
  const defineMap = new Map<K, Define[]>((obj as unknown as ConditionValue<T, K>)[DEFINES]);

  const result = {} as any;

  for (const k of Object.keys(obj) as unknown as K[]) {
    const v = obj[k];
    const define = defineMap.get(k)?.find((define) => {
      if (define.condition === 'ifdef' && define.platforms.includes(platform)) {
        return true;
      }
      if (define.condition === 'ifndef' && !define.platforms.includes(platform)) {
        return true;
      }
      return false;
    });

    defineMap.delete(k); // 移除已处理的定义

    const key = isArr ? Number(k) : k;
    const value = define ? define.value : v;

    if (typeof value === 'object' && value != null) {
      result[key] = resolveCondition(value, platform);
    } else {
      result[key] = value;
    }

  }

  for (const [k, v] of defineMap) {
    const define = v.find((define) => {
      if (define.condition === 'ifdef' && define.platforms.includes(platform)) {
        return true;
      }
      if (define.condition === 'ifndef' && !define.platforms.includes(platform)) {
        return true;
      }
      return false;
    });

    if (define) {
      const key = isArr ? Number(k) : k;
      result[key] = define.value;
    }
  }

  return result;
}

export function getSupportedPlatforms(obj: any): UniPlatform[] {

  const platforms = [...((obj as ConditionValue<any>)[PLATFORMS] || [])];

  for (const [, v] of Object.entries(obj)) {
    if (typeof v === 'object' && v != null) {
      platforms.push(...getSupportedPlatforms(v));
    }
  }

  return [...new Set(platforms)].sort();
}

function addCondition<T extends object, K extends Key<T>>(
  orig: ConditionValue<T, K>,
  condition: 'ifdef' | 'ifndef',
  platform: UniPlatform | UniPlatform[],
  obj: DeepPartial<T>,
) {
  const needKeys = Object.keys(obj);
  if (needKeys.length === 0) {
    return orig;
  }

  const fullObj = deepMerge(orig, obj);
  const platforms = Array.isArray(platform) ? platform : [platform];
  const ignoredKeys = Object.keys(orig).filter(k => !needKeys.includes(k)) as unknown as K[];

  mergeCondition(condition, orig, conditionValue(fullObj, ...platforms), ignoredKeys);
}

function addDefine<K extends string | number | symbol = string>(defineMap: Map<K, Define[]>, key: K, define: Define) {
  const defines = defineMap.get(key) || [];

  const found = defines.find(c => c.condition === define.condition && c.value === define.value);
  if (found) {
    found.platforms = [...new Set([...found.platforms, ...define.platforms])].sort();
    found.platformStr = found.platforms.join(',');
  } else {
    defines.push(define);
  }
  defineMap.set(key, defines);
}

function mergeCondition<T extends object, K extends Key<T>>(condition: 'ifdef' | 'ifndef', obj1: T | ConditionValue<T, K>, obj2: T | ConditionValue<T, K>, ignoreKeys: K[] = []): ConditionValue<T, K> {

  const obj1Platforms = (obj1 as ConditionValue<T, K>)[PLATFORMS] || [];
  const obj2Platforms = (obj2 as ConditionValue<T, K>)[PLATFORMS] || [];
  // const obj1Defines = (obj1 as Condition<T, K>)[DEFINES] || {} as Record<K, Define[]>;
  const obj2Defines = (obj2 as ConditionValue<T, K>)[DEFINES] || new Map<K, Define[]>();

  const result = conditionValue(obj1, ...obj2Platforms) as ConditionValue<T, K>;

  // 合并条件定义
  obj2Defines.forEach((defines, k) => {
    for (const define of defines) {
      addDefine(result[DEFINES], k, define);
    }
  });

  const keys = new Set(Object.keys(obj1) as unknown as K[]);
  const ignoredKeys = new Set(ignoreKeys.filter(k => typeof k !== 'string' || !(k as string).includes('.'))); // 不是 string 或者不带点的string。（带 . 的 string 是下层的key））

  const getSubIgnKeys = (pre: string | number | symbol) => {

    if (typeof pre === 'symbol') {
      return [];
    }

    const preWithDot = `${pre}.`;

    const subKeys: string[] = [];
    for (const ik of (ignoredKeys as unknown as string[])) {
      if (typeof ik !== 'string') {
        continue;
      }
      if (ik.startsWith(preWithDot)) {
        subKeys.push(ik.substring(preWithDot.length));
      }
    }
    return subKeys;
  };

  for (const k2 of Object.keys(obj2) as unknown as K[]) {
    const k = k2 as unknown as Key<T>;
    const v2 = obj2[k];

    keys.delete(k2);

    if (ignoredKeys.has(k2)) {
      // 需要忽略，跳过
      continue;
    }

    if (result[DEFINES].has(k2)) {
      addDefine(result[DEFINES], k2, {
        platforms: obj2Platforms,
        platformStr: obj2Platforms.join(','),
        condition,
        value: v2,
      });
      continue;
    }

    if (v2 === undefined && result[k] === undefined) {
      // 当 v2 为 undefined 且 result[k] 也 undefined 时，跳过
      continue;
    }

    if (obj1[k] === obj2[k]) {
      // 浅对比值相等，跳过
      continue;
    }

    // 处理不相等的值

    if (typeof v2 === 'object' && v2 != null && result[k] != null) {

      if (Array.isArray(v2)) {
        const s1 = JSON.stringify(result[k]);
        const s2 = JSON.stringify(v2);
        if (s1 === s2) {
          continue; // 数组相等，跳过
        }
      } else {
        const v1Cond = conditionValue(result[k], ...obj1Platforms);
        const v2Cond = conditionValue(v2 as any, ...obj2Platforms);
        result[k] = mergeCondition(condition, v1Cond, v2Cond, getSubIgnKeys(k) as any) as any;
        continue;
      }
    }

    if (result[k] !== undefined) {
      addDefine(result[DEFINES], k2, {
        platforms: obj1Platforms,
        platformStr: obj1Platforms.join(','),
        condition,
        value: obj1[k],
      });
    }

    if (v2 !== undefined) {
      addDefine(result[DEFINES], k2, {
        platforms: obj2Platforms,
        platformStr: obj2Platforms.join(','),
        condition,
        value: v2,
      });
    }

  }

  // 处理剩余的key
  for (const k of keys) {
    if (ignoredKeys.has(k)) {
      continue; // 需要忽略，跳过
    }
    addDefine(result[DEFINES], k, {
      platforms: obj1Platforms,
      platformStr: obj1Platforms.join(','),
      condition,
      value: result[k as unknown as Key<T>],
    });
  }

  return result;
}

function mergeArrayCondition<T extends object, K extends Key<T>>(condition: 'ifdef' | 'ifndef', arr1: T[] | ConditionValue<T[]>, arr2: T[] | ConditionValue<T[]>, getKey: (v: T) => string): ConditionValue<T[], number> {

  const arr1Platforms = (arr1 as ConditionValue<T[], K>)[PLATFORMS] || [];
  const arr2Platforms = (arr2 as ConditionValue<T[], K>)[PLATFORMS] || [];
  const arr1Defines = (arr1 as ConditionValue<T[], K>)[DEFINES] || new Map<K, Define[]>();
  const arr2Defines = (arr2 as ConditionValue<T[], K>)[DEFINES] || new Map<K, Define[]>();

  const obj1KeyMap = new Map<string, K>();
  let obj1 = conditionValue<Record<string, T>>({}, ...arr1Platforms);
  for (let i = 0; i < arr1.length; i++) {
    const item1 = arr1[i];
    const k = getKey(arr1[i]);
    obj1KeyMap.set(k, i as K);
    obj1[k] = item1;
    const defines = arr1Defines.get(i as K);
    for (const define of (defines || [])) {
      addDefine(obj1[DEFINES], k, define);
    }
  }

  const obj2KeyMap = new Map<string, K>();
  const obj2 = conditionValue<Record<string, T>>({}, ...arr2Platforms);
  for (let i = 0; i < arr2.length; i++) {
    const item2 = arr2[i];
    const k = getKey(arr2[i]);
    obj2KeyMap.set(k, i as K);
    obj2[k] = item2;
    const defines = arr2Defines.get(i as K);
    for (const define of (defines || [])) {
      addDefine(obj2[DEFINES], k, define);
    }
  }

  // 执行合并条件
  obj1 = mergeCondition(condition, obj1, obj2);

  const result = conditionValue<T[]>([], ...arr1Platforms, ...arr2Platforms);
  let lastIndx = arr1.length - 1;
  for (const [k, v] of Object.entries(obj1) as [string, T][]) {
    const idx1 = obj1KeyMap.get(k);
    if (idx1 !== undefined) {
      result[idx1] = v; // 赋值
      const defines = obj1[DEFINES].get(k);
      obj1[DEFINES].delete(k);
      if (defines) {
        for (const define of defines) {
          addDefine(result[DEFINES], idx1, define);
        }
      }
    } else {
      result[++lastIndx] = v;
      const defines = obj1[DEFINES].get(k);
      obj1[DEFINES].delete(k);
      if (defines) {
        for (const define of defines) {
          addDefine(result[DEFINES], lastIndx, define);
        }
      }
    }
  }

  for (const [, defines] of Object.entries(obj2[DEFINES])) {
    lastIndx++;
    for (const define of defines) {
      addDefine(result[DEFINES], lastIndx, define);
    }
  }

  return result;
}

export function stringifyPagesJsons(jsons: Record<UniPlatform, PagesJSON.PagesJson>, indent: string | number = 4): string {
  const [p1 = currentPlatform(), ...ps] = Object.keys(jsons).sort() as UniPlatform[];

  let pagesJson = conditionValue(jsons[p1] || {}, p1);

  sortPagesJson(pagesJson);

  for (const p2 of ps) {
    const j2 = jsons[p2] || {};
    sortPagesJson(j2);

    // 合并不同平台的 pages
    if (j2.pages) {
      if (!isConditionValue(pagesJson.pages)) {
        pagesJson.pages = conditionValue(pagesJson.pages || [], p1);
      }
      pagesJson.pages = mergeArrayCondition('ifdef', pagesJson.pages, conditionValue(j2.pages, p2), v => v.path);
    }

    // 合并不同平台的 subPackages
    if (j2.subPackages) {
      pagesJson.subPackages ??= [];
      for (const j2Sub of j2.subPackages) {
        const idx = pagesJson.subPackages.findIndex(s => s.root === j2Sub.root);
        if (idx > -1) {
          if (!isConditionValue(pagesJson.subPackages[idx])) {
            pagesJson.subPackages[idx] = conditionValue(pagesJson.subPackages[idx] || {}, p1);
          }
          pagesJson.subPackages[idx] = mergeCondition('ifdef', pagesJson.subPackages[idx], conditionValue(j2Sub, p2), ['pages']);

          if (j2Sub.pages && j2Sub.pages.length > 0) {
            if (!isConditionValue(pagesJson.subPackages[idx].pages)) {
              pagesJson.subPackages[idx].pages = conditionValue(pagesJson.subPackages[idx].pages || [], p1);
            }
            pagesJson.subPackages[idx].pages = mergeArrayCondition('ifdef', pagesJson.subPackages[idx].pages, conditionValue(j2Sub.pages, p2), v => v.path);
          }
        } else {
          pagesJson.subPackages.push(j2Sub);
        }
      }
    }

    // 合并不同平台的 tabBar
    if (j2.tabBar) {
      if (!isConditionValue(pagesJson.tabBar)) {
        pagesJson.tabBar = conditionValue(pagesJson.tabBar || {}, p1);
      }
      pagesJson.tabBar = mergeCondition('ifdef', pagesJson.tabBar, conditionValue(j2.tabBar, p2), ['list']);
      if (j2.tabBar.list && j2.tabBar.list.length > 0) {
        if (!isConditionValue(pagesJson.tabBar.list)) {
          pagesJson.tabBar.list = conditionValue(pagesJson.tabBar.list || [], p1);
        }
        pagesJson.tabBar.list = mergeArrayCondition('ifdef', pagesJson.tabBar.list, conditionValue(j2.tabBar.list, p2), v => v.pagePath);
      }
    }

    // 合并除 pages、subPackages、tabBar 外的其他属性
    pagesJson = mergeCondition('ifdef', pagesJson, conditionValue(j2, p2), ['pages', 'subPackages', 'tabBar']);
  }

  const converted = convertConditionWithAlias(pagesJson);

  let rawJson = cjson.stringify(converted, null, indent);

  // 清理 key 后缀
  rawJson = rawJson.replace(/"([^"]+)#ifn?def_.*?"/g, '"$1"');

  // 修复 #ifdef 行注释位置。（comment-json 将此行注释放在上一个行的末尾，而不是同等缩进的新行）
  // eslint-disable-next-line regexp/no-super-linear-backtracking
  rawJson = rawJson.replace(/\n(\s*.+?)\s*(\/\/ #ifn?def .*)\n(\s*)/g, '\n$1\n$3$2\n$3');

  // 修复 #endif 行注释位置。（comment-json 将此行注释行末尾，而不是同等缩进的新行）
  // eslint-disable-next-line regexp/no-super-linear-backtracking
  rawJson = rawJson.replace(/\n((\s*).*?)\s*\/\/ #endif/g, '\n$1\n$2// #endif');

  // 清除多余的换行符
  rawJson = rawJson.replace(/\n\s*\n/g, '\n');

  return rawJson;
}

function convertConditionWithAlias<T extends object | any[], K extends Key<T>>(obj: ConditionValue<T, K>): T {

  if (!isConditionValue(obj)) {
    return obj;
  }

  if (Array.isArray(obj)) {
    const newArr = [] as any[];
    const defineMap = obj[DEFINES] || {};
    for (let i = 0; i < obj.length; i++) {
      const defines = defineMap.get(i as K);
      defineMap.delete(i as K);
      if (defines) {
        for (const define of defines) {
          newArr.push(define.value);
          wrapConditionComment(newArr, define.condition, newArr.length - 1, define.platforms);
        }
      } else {
        if (typeof obj[i] === 'object' && obj[i] != null) {
          newArr.push(convertConditionWithAlias(obj[i]));
        } else {
          newArr.push(obj[i]);
        }
      }
    }

    for (const [, defines] of Object.entries(defineMap) as [string, Define[]][]) {
      for (const define of (defines || [])) {
        newArr.push(define.value);
        wrapConditionComment(newArr, define.condition, newArr.length - 1, define.platforms);
      }
    }

    return newArr as T;
  }

  const result = {} as Record<string, any>;
  const defineMap = new Map<K, Define[]>(obj[DEFINES]);

  const aliasKey = (k: string, condition: 'ifdef' | 'ifndef', platforms: UniPlatform[]) => `${k}#${condition}_${platforms.join('_')}`;

  for (const [k, v] of Object.entries(obj)) {
    if (k.includes('#ifdef') || k.includes('#ifndef')) {
      continue;
    }

    const defines = defineMap.get(k as unknown as K);
    defineMap.delete(k as unknown as K);
    if (defines) {
      for (const define of defines) {
        const newKey = aliasKey(k, define.condition, define.platforms);
        result[newKey] = define.value;
        wrapConditionComment(result, define.condition, newKey, define.platforms);
      }
    } else {

      if (typeof v === 'object' && v != null) {
        result[k] = convertConditionWithAlias(v);
      } else {
        result[k] = v;
      }
    }
  }

  for (const [k, defines] of defineMap) {
    for (const define of defines) {
      const newKey = aliasKey(String(k), define.condition, define.platforms);
      result[newKey] = define.value;
      wrapConditionComment(result, define.condition, newKey, define.platforms);
    }
  }

  return result as T;
}

function wrapConditionComment<T extends object>(obj: T, condition: 'ifdef' | 'ifndef', key: string | number, platforms: UniPlatform[]): void {

  const upperPlatforms = platforms.map(p => p.toUpperCase());

  const Key = (key: string): cjson.CommentSymbol => Symbol.for(key) as cjson.CommentSymbol;

  const target = obj as cjson.CommentObject;
  target[Key(`before:${key}`)] = target[Key(`before:${key}`)] || [];
  target[Key(`before:${key}`)].push({
    type: 'LineComment',
    value: ` #${condition} ${upperPlatforms.join(' || ')}`,
    inline: true,
    loc: {
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    },
  });

  target[Key(`after:${key}`)] = target[Key(`after:${key}`)] || [];
  target[Key(`after:${key}`)].push({
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
