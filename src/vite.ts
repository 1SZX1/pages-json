import type { Matcher as AnymatchMatcher } from 'anymatch';
import type { FSWatcher, PluginOption, ViteDevServer } from 'vite';
import type { UserConfig } from './config';
import path from 'node:path';
import anymatch from 'anymatch';
import chokidar from 'chokidar';
import MagicString from 'magic-string';
import { Context } from './context';
import { debug } from './utils/debug';

const MODULE_ID_VIRTUAL = 'virtual:pages-json' as const;
const RESOLVED_MODULE_ID_VIRTUAL = `\0${MODULE_ID_VIRTUAL}` as const;

export type { UserConfig };

export default function pagesJson(userConfig: UserConfig = {}): PluginOption {

  let _server: ViteDevServer | undefined;

  const ctx = new Context(userConfig);

  ctx.checkStaticJsonFileSync();

  return {
    name: '@uni-ku/pages-json',
    enforce: 'pre',

    async configResolved(viteConf) {

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
      s.remove(macro.ast.start!, macro.ast.end!);

      if (s.hasChanged()) {
        const newCode = s.toString();
        return {
          code: newCode,
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

    async load(id) {
      if (id === RESOLVED_MODULE_ID_VIRTUAL) {
        const pagesJson = await ctx.generatePagesJson();
        return `export default ${JSON.stringify(pagesJson, null, 2)};`;
      }
    },

    handleHotUpdate: ({ file, server }) => {
      if (file && isWatchFile(ctx, file)) {
        const mod = server.moduleGraph.getModuleById(RESOLVED_MODULE_ID_VIRTUAL); // 获取虚拟模块
        if (mod) {
          server.moduleGraph.invalidateModule(mod); // 如果模块存在，将其标记为失效，使其触发更新
        }
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

function isWatchFile(ctx: Context, file: string) {
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

  if (!anymatch(includes, file)) {
    return false;
  }

  if (anymatch(excludes, file)) {
    return false;
  }

  return true;
}

async function setupWatcher(ctx: Context, watcher: FSWatcher) {

  watcher.on('add', async (file) => {
    if (!isWatchFile(ctx, file)) {
      return;
    }

    debug.debug(`新增文件: ${file}`);
    await ctx.updatePagesJSON(file);
  });

  watcher.on('change', async (file) => {
    if (!isWatchFile(ctx, file)) {
      return;
    }

    debug.debug(`修改文件: ${file}`);
    await ctx.updatePagesJSON(file);
  });

  watcher.on('unlink', async (file) => {
    if (!isWatchFile(ctx, file)) {
      return;
    }

    debug.debug(`删除文件: ${file}`);
    await ctx.updatePagesJSON();
  });
}
