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
  platform: BuiltInPlatform;
}

 type DefinePagesJsonArg = DeepPartial<PagesJSON.PagesJson> | ((a: DefinePagesJsonFuncArgs) => DeepPartial<PagesJSON.PagesJson> | Promise<DeepPartial<PagesJSON.PagesJson>>);

function defineConfig(userConfig: DefinePagesJsonArg): DefinePagesJsonArg {
  return userConfig;
}

export type {
  DefinePageFuncArgs,
  DefinePagesJsonArg,
  DefinePagesJsonFuncArgs,
  UserPageMeta,
  UserTabBarItem,
};

export {
  defineConfig,
  definePage,
};
