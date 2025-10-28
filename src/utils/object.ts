export function deepMerge<T extends Record<string, any> = any>(...objs: T[]): T {
  const result = Object.assign({}, ...objs);

  for (const obj of objs) {
    for (const [key, val] of Object.entries(obj)) {
      if (isObject(val)) {
        result[key] = deepMerge(result[key], val);
      } else {
        result[key] = val;
      }
    }
  }

  return result;
}

export function deepAssign<T extends Record<string, any> = any>(target: T, ...sources: T[]) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      const val = (source as any)[key];
      if (isObject(val)) {
        (target as any)[key] = deepAssign((target as any)[key], val);
      } else {
        (target as any)[key] = val;
      }
    }
  }
  return target;
}

function isObject(item: any) {
  return item && typeof item === 'object' && !Array.isArray(item);
}
