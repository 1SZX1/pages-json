import type { BuiltInPlatform } from '@uni-helper/uni-env';
import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { UserPageMeta, UserTabBarItem } from './pageFile';
import type { DeepPartial } from './types';

interface DefinePageFuncArgs {
  t: (meta: UserPageMeta) => UserPageMeta;
  platform: BuiltInPlatform;
}

function definePage(arg: UserPageMeta | ((arg: DefinePageFuncArgs) => UserPageMeta | Promise<UserPageMeta>)) { }

interface DefinePagesJsonFuncArgs {
  t: (p: DeepPartial<PagesJSON.PagesJson>) => DeepPartial<PagesJSON.PagesJson>;
}

function definePagesJson<C extends DeepPartial<PagesJSON.PagesJson> | ((a: DefinePagesJsonFuncArgs) => DeepPartial<PagesJSON.PagesJson> | Promise<DeepPartial<PagesJSON.PagesJson>>)>(userConfig: C): C {
  return userConfig;
}

const _definePage = definePage;

// 全局声明 definePage 函数，使得用户无需导入即可使用
declare global {
  const definePage: typeof _definePage;
}

export type {
  DefinePageFuncArgs,
  DefinePagesJsonFuncArgs,
  UserPageMeta,
  UserTabBarItem,
};

export {
  definePage,
  definePagesJson,
};
