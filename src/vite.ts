import type { PluginOption } from 'vite';
import MagicString from 'magic-string';
import { resolveConfig, type UserConfig } from './config';
import { Context } from './context';

const MODULE_ID_VIRTUAL = 'virtual:pages-json' as const;
const RESOLVED_MODULE_ID_VIRTUAL = `\0${MODULE_ID_VIRTUAL}` as const;

export default function pagesJson(userConfig: UserConfig = {}): PluginOption {

  const cfg = resolveConfig(userConfig);

  const ctx = new Context(cfg);

  ctx.checkJsonFileSync();

  return {
    name: '@uni-ku/pages-json',
    enforce: 'pre',

    async configResolved(viteConf) {

      await ctx.updatePagesJSON();

      if (viteConf.command === 'serve' || (viteConf.command === 'build' && viteConf.build.watch)) {
        ctx.watch();
      }
    },
    async transform(code: string, id: string) {
      const file = ctx.files.get(id);
      if (!file) {
        return;
      }

      await file.parse(code);
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
      if (file) {
        const mod = server.moduleGraph.getModuleById(RESOLVED_MODULE_ID_VIRTUAL); // 获取虚拟模块
        if (mod) {
          server.moduleGraph.invalidateModule(mod); // 如果模块存在，将其标记为失效，使其触发更新
        }
      }
    },
  };
}
