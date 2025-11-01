import type { Matcher as AnymatchMatcher } from 'anymatch';
import type { FSWatcher, PluginOption, ViteDevServer } from 'vite';
import path from 'node:path';
import anymatch from 'anymatch';
import chokidar from 'chokidar';
import MagicString from 'magic-string';
import { resolveConfig, type UserConfig } from './config';
import { Context } from './context';
import { debug } from './utils/debug';

const MODULE_ID_VIRTUAL = 'virtual:pages-json' as const;
const RESOLVED_MODULE_ID_VIRTUAL = `\0${MODULE_ID_VIRTUAL}` as const;

export default function pagesJson(userConfig: UserConfig = {}): PluginOption {

  let _server: ViteDevServer | undefined;

  const cfg = resolveConfig(userConfig);
  const ctx = new Context(cfg);

  ctx.checkStaticJsonFileSync();

  return {
    name: '@uni-ku/pages-json',
    enforce: 'pre',
    async configResolved(viteConf) {

      if (!userConfig.root) {
        ctx.cfg.root = viteConf.root;
      }

      await ctx.updatePagesJSON();

      if (viteConf.command === 'build' && viteConf.build.watch) {
        setupWatcher(ctx, chokidar.watch([
          ...dirsToGlob(ctx.cfg.root, [
            ctx.cfg.pageDir,
            ...ctx.cfg.subPackageDirs,
          ]),
          ...ctx.possibleDynamicJsonFilePaths(),
        ]));
      }
    },
    async transform(code: string, id: string) {
      const file = ctx.files.get(id);
      if (!file) {
        return;
      }

      const macro = await file.getMacroInfo();

      if (!macro) {
        return;
      }

      const s = new MagicString(code);
      s.remove(macro.loc.start, macro.loc.end);

      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: s.generateMap({
            source: id,
            includeContent: true,
            file: `${id}.map`,
          }),
        };
      }
    },

    configureServer(server) {
      if (_server === server) {
        return;
      }

      _server = server;

      setupWatcher(ctx, server.watcher);
    },

    resolveId(id) {
      if (id === MODULE_ID_VIRTUAL) {
        return RESOLVED_MODULE_ID_VIRTUAL;
      }
    },
    load(id) {
      if (id === RESOLVED_MODULE_ID_VIRTUAL) {
        return ctx.virtualModule();
      }
    },
  };
}

function dirsToGlob(root: string, dirs: string[]): string[] {
  return dirs.map(dir => path.isAbsolute(dir)
    ? `${dir}/**/*`
    : path.join(root, dir, '**/*'),
  );
}

async function setupWatcher(ctx: Context, watcher: FSWatcher) {

  const includes: AnymatchMatcher = [
    ...dirsToGlob(ctx.cfg.root, [
      ctx.cfg.pageDir,
      ...ctx.cfg.subPackageDirs,
    ]),
    ...ctx.possibleDynamicJsonFilePaths(),
  ];

  const excludes: AnymatchMatcher = [
    ...ctx.cfg.excludes,
    file => !ctx.isValidFile(file),
  ];

  watcher.on('add', async (file) => {
    if (!anymatch(includes, file)) {
      return;
    }
    if (anymatch(excludes, file)) {
      return;
    }

    debug.debug(`新增文件: ${file}`);
    await ctx.updatePagesJSON(file);
  });

  watcher.on('change', async (file) => {
    if (!anymatch(includes, file)) {
      return;
    }
    if (anymatch(excludes, file)) {
      return;
    }

    debug.debug(`修改文件: ${file}`);
    await ctx.updatePagesJSON(file);
  });

  watcher.on('unlink', async (file) => {
    if (!anymatch(includes, file)) {
      return;
    }
    if (anymatch(excludes, file)) {
      return;
    }

    debug.debug(`删除文件: ${file}`);
    await ctx.updatePagesJSON();
  });
}
