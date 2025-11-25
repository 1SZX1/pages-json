import type { BuiltInPlatform } from '@uni-helper/uni-env';
import type * as PagesJSON from '@uni-ku/pages-json/types';
import type { ConfigHook, UserConfig } from './config';
import type { PageFileOption, UserPageMeta, UserTabBarItem } from './pageFile';
import type { DeepPartial } from './types';
import { Context } from './context';

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

function updatePagesJSON(userConfig: UserConfig = {}): Promise<boolean> {
  const ctx = new Context(userConfig);
  return ctx.updatePagesJSON();
}

export * from './types';

export type {
  ConfigHook,
  DefineConfigArg,
  DefineConfigFuncArgs,
  DefinePageFuncArgs,
  PageFileOption,
  UserConfig,
  UserPageMeta,
  UserTabBarItem,
};

export {
  defineConfig,
  definePage,
  updatePagesJSON,
};
