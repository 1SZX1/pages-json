import type { DefinePageFuncArgs, PageFileOption, UserPageMeta, UserTabBarItem } from './page-file';
import type { DefineConfigArg, DefineConfigFuncArgs } from './pages-config-file';
import { type ConfigHook, resolveConfig, type UserConfig } from './config';
import { Context } from './context';
import { definePage } from './page-file';
import { defineConfig } from './pages-config-file';

function updatePagesJSON(userConfig: UserConfig = {}): Promise<boolean> {
  const cfg = resolveConfig(userConfig);
  const ctx = new Context(cfg);
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
