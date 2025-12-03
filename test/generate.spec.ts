import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from '../src/condition';
import { resolveConfig } from '../src/config';
import { Context } from '../src/context';

const cfg = resolveConfig({
  root: path.resolve(__dirname, '../playground'),
  pageDir: 'pages',
  subPackageDirs: ['pages-sub'],
  platform: ['h5', 'mp-weixin', 'mp-alipay'],
});

const ctx = new Context(cfg);

describe('generate', async () => {

  it('pagesJson snapshot', async () => {

    await ctx.scanFiles();

    const platforms = await ctx.getPlatforms();

    const jsons = {} as any;

    for (const platform of platforms) {
      jsons[platform] = await ctx.generatePagesJson(platform);
    }

    const raw = stringify(jsons, 2);

    expect(raw).toMatchInlineSnapshot(`
      "{
        "globalStyle": {
          "navigationBarTextStyle": "black",
          "navigationBarBackgroundColor": "#F8F8F8",
          "backgroundColor": "#F8F8F8",
          // #ifdef H5
          "navigationBarTitleText": "uni-app H5",
          // #endif
          // #ifdef MP-ALIPAY || MP-WEIXIN
          "navigationBarTitleText": "uni-app other"
          // #endif
        },
        "pages": [
          {
            "path": "pages/index/index",
            "style": {
              "navigationBarTitleText": "uni-app",
              "animationType": "pop-in"
            }
          },
          {
            "path": "pages/define-page/async-function",
            "style": {
              "navigationBarTitleText": "hello world from async"
            }
          },
          {
            "path": "pages/define-page/function",
            "style": {
              "navigationBarTitleText": "hello world",
              // #ifdef MP-ALIPAY
              "backgroundColor": "#fff"
              // #endif
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
          }
        ],
        "subPackages": [
          {
            "root": "pages-sub",
            "plugins": {
              "uni-id-pages": {
                "version": "1.0.0",
                "provider": "https://service-1.pages.dev"
              }
            },
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
        ],
        "tabBar": {
          "list": [
            {
              "pagePath": "pages/define-page/object"
            }
          ]
        }
      }"
      `);
  });
});
