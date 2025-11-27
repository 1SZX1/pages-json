import type { ConfigHook, UserConfig } from './config';
import type { DefinePageFuncArgs, PageFileOption, UserPageMeta, UserTabBarItem } from './pageFile';
import type { DefineConfigArg, DefineConfigFuncArgs } from './pagesJson';
import { Context } from './context';
import { definePage } from './pageFile';
import { defineConfig } from './pagesJson';

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
