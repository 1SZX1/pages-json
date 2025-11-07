import type { BuiltInPlatform } from '@uni-helper/uni-env';
import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { UserPageMeta, UserTabBarItem } from './pageFile';
import type { DeepPartial } from './types';

interface DefinePageFuncArgs {
  t: (meta: UserPageMeta) => UserPageMeta;
  platform: BuiltInPlatform;
}

function definePage(arg: UserPageMeta | ((arg: DefinePageFuncArgs) => UserPageMeta | Promise<UserPageMeta>)) { }

interface DefineConfigFuncArgs {
  t: (p: DeepPartial<PagesJSON.PagesJson>) => DeepPartial<PagesJSON.PagesJson>;
  platform: BuiltInPlatform;
}

 type DefineConfigArg = DeepPartial<PagesJSON.PagesJson> | ((a: DefineConfigFuncArgs) => DeepPartial<PagesJSON.PagesJson> | Promise<DeepPartial<PagesJSON.PagesJson>>);

function defineConfig(userConfig: DefineConfigArg): DefineConfigArg {
  return userConfig;
}

export * from './types';

export type {
  DefineConfigArg,
  DefineConfigFuncArgs,
  DefinePageFuncArgs,
  UserPageMeta,
  UserTabBarItem,
};

export {
  defineConfig,
  definePage,
};
