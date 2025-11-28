import type { UniPlatform } from './utils/uni-env';
import { deepAssign } from './utils/object';

;

export interface ConditionItem<T = any> {
  platform: UniPlatform;
  condition: 'ifdef' | 'ifndef';
  value: T;
}

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
  public get(platform: UniPlatform): T {
    const cond = this.conds.find(c => c.condition === 'ifdef' && c.platform === platform);
    if (cond) {
      return deepAssign<T>({} as T, { ...this.orig }, cond.value); // 解构避免拷贝 symbol 属性
    }

    return deepAssign<T>({} as T, { ...this.orig }); // 解构避免拷贝 symbol 属性
  }

  public has(platform: UniPlatform, condition: 'ifdef' | 'ifndef' = 'ifdef'): boolean {
    return this.conds.some(c => c.condition === condition && c.platform === platform);
  }

  public getPlatforms(): UniPlatform[] {
    return this.conds.map(c => c.platform);
  }
}

const INNER = Symbol('INNER_CONDITION');

export class Cond<T extends object> {

  public [INNER]: Condition<T>;

  constructor(obj: T) {
    this[INNER] = new Condition<T>(obj);
  }

  public ifdef(platform: UniPlatform | UniPlatform[], obj: T) {
    this[INNER].ifdef(platform, obj);
    return this;
  }
}

export function unwrap<T extends object>(cond: Cond<T>): Condition<T> {
  return cond[INNER] || cond;
}

export function is(obj: any): obj is Cond<any> {
  if (obj instanceof Cond) {
    return true;
  }

  return obj && obj.ifdef instanceof Function;
}
