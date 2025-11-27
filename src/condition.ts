import type { UniPlatform } from './utils/uni-env';
import { deepAssign } from './utils/object';

;

export interface ConditionItem<T = any> {
  platform: UniPlatform;
  condition: 'ifdef' | 'ifndef';
  value: T;
}

// 创建一个唯一的 Symbol 用于私有方法
const CONDITION_GET = Symbol('condition_get');
const CONDITION_HAS = Symbol('condition_has');
const CONDITION_GET_PLATFORMS = Symbol('condition_get_platforms');

export class Condition<T extends object> {

  private orig: T;

  private conds: ConditionItem<T>[] = [];

  constructor(obj: T) {
    this.orig = obj;
  }

  public ifdef(platform: UniPlatform | UniPlatform[], obj: T) {
    const platforms = new Set(Array.isArray(platform) ? platform : [platform]);

    for (const platform of platforms) {
      const cond = this.conds.find(c => c.condition === 'ifdef' && c.platform === platform);

      if (cond) {
        cond.value = {
          ...cond.value,
          ...obj,
        };
      } else {
        this.conds.push({
          condition: 'ifdef',
          platform,
          value: obj,
        });
      }
    }

    return this;
  }

  // 仅限项目内部使用的方法
  [CONDITION_GET](platform: UniPlatform): T {
    const cond = this.conds.find(c => c.condition === 'ifdef' && c.platform === platform);
    if (cond) {
      return deepAssign<T>({} as T, { ...this.orig }, cond.value); // 解构避免拷贝 symbol 属性
    }

    return deepAssign<T>({} as T, { ...this.orig }); // 解构避免拷贝 symbol 属性
  }

  [CONDITION_HAS](platform: UniPlatform, condition: 'ifdef' | 'ifndef' = 'ifdef'): boolean {
    return this.conds.some(c => c.condition === condition && c.platform === platform);
  }

  [CONDITION_GET_PLATFORMS](): UniPlatform[] {
    return this.conds.map(c => c.platform);
  }
}

export function get<T extends object>(obj: Condition<T>, platform: UniPlatform): T {
  return obj[CONDITION_GET](platform);
}

export function is(obj: any): obj is Condition<any> {
  if (obj instanceof Condition) {
    return true;
  }

  return obj && obj[CONDITION_GET] instanceof Function;
}

export function has<T extends object>(obj: Condition<T>, platform: UniPlatform, condition: 'ifdef' | 'ifndef' = 'ifdef'): boolean {
  if (is(obj)) {
    return obj[CONDITION_HAS](platform, condition);
  }

  return false;
}

export function getPlatforms<T extends object>(obj: Condition<T>): UniPlatform[] {
  if (is(obj)) {
    return obj[CONDITION_GET_PLATFORMS]();
  }

  return [];
}
