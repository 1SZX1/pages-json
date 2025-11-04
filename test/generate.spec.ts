import type { PagesJson } from '@uni-ku/pages-json/types';
import path from 'node:path';
import { stringify as cjStringify } from 'comment-json';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { Context } from '../src/context';

const cfg = resolveConfig({
  root: path.resolve(__dirname, '../playground'),
  pageDir: 'src/pages',
  subPackageDirs: ['src/pages-sub'],
});

const ctx = new Context(cfg);

describe('generate', () => {
  it('pages snapshot', async () => {
    await ctx.scanFiles();
    const json = {} as PagesJson;
    await ctx.generatePages(json);

    const raw = cjStringify(json.pages, null, 2);

    expect(raw).toMatchInlineSnapshot(`
      "[
        {
          "path": "pages/define-page/async-function",
          "style": {
            "navigationBarTitleText": "hello world from async"
          }
        },
        {
          "path": "pages/define-page/function",
          "style": {
            "navigationBarTitleText": "hello from undefined"
          }
        },
        {
          "path": "pages/define-page/nested-function",
          "style": {
            "navigationBarTitleText": "hello world"
          }
        },
        {
          "path": "pages/define-page/object",
          "style": {
            "navigationBarTitleText": "hello world"
          }
        },
        {
          "path": "pages/define-page/option-api",
          "style": {
            "navigationBarTitleText": "Option API 内使用 definePage"
          }
        },
        {
          "path": "pages/define-page/yaml",
          "style": {
            "navigationBarTitleText": "yaml test"
          }
        },
        {
          "path": "pages/index/index",
          "style": {
            "animationType": "pop-in"
          }
        }
      ]"
    `);
  });

  it('subPackages snapshot', async () => {
    await ctx.scanFiles();
    const json = {} as PagesJson;
    await ctx.generateSubPackages(json);

    const raw = cjStringify(json.subPackages, null, 2);
    expect(raw).toMatchInlineSnapshot(`
      "[
        {
          "root": "pages-sub",
          "pages": [
            {
              "path": "index"
            },
            {
              "path": "about/index"
            },
            {
              "path": "about/your"
            }
          ]
        }
      ]"
    `);
  });

  it('tabBar snapshot', async () => {
    await ctx.scanFiles();
    const json = {} as PagesJson;
    await ctx.generateTabbar(json);

    const raw = cjStringify(json.tabBar, null, 2);
    expect(raw).toMatchInlineSnapshot(`
      "{
        "list": [
          {
            "pagePath": "pages/define-page/object"
          }
        ]
      }"
    `);
  });
});
