import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { Context } from '../src/context';

const cfg = resolveConfig({
  root: path.resolve(__dirname, '../playground'),
  pageDir: 'src/pages',
  subPackageDirs: ['src/pages-sub'],
});

const ctx = new Context(cfg);

describe('get files', () => {
  it('pages', async () => {
    await ctx.scanFiles();
    const files = [...ctx.files.keys()].map(f => path.posix.relative(cfg.root, f)).sort();
    expect(files).toMatchInlineSnapshot(`
      [
        "src/pages-sub/about/index.vue",
        "src/pages-sub/about/your.vue",
        "src/pages-sub/index.vue",
        "src/pages/define-page/async-function.vue",
        "src/pages/define-page/function.vue",
        "src/pages/define-page/nested-function.vue",
        "src/pages/define-page/object.vue",
        "src/pages/define-page/option-api.vue",
        "src/pages/define-page/yaml.vue",
        "src/pages/index/index.vue",
      ]
    `);
  });
});
