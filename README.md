# @uni-ku/pages-json

`definePage` 宏，用于动态生成 `pages.json`。

- 支持条件编译
- 支持类型提示、约束
- 支持 json
- 支持函数和异步函数
- 支持从外部导入变量、函数

## 安装

```shell
pnpm i -D @uni-ku/pages-json
```

## 配置

### vite 配置
```ts
import uni from '@dcloudio/vite-plugin-uni';
import pagesJson from '@uni-ku/pages-json/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    pagesJson(), // 详细配置请看下面的详细描述
    uni(), // 添加在 pagesJson() 之后
    // 其他plugins
  ],
});
```

### `definePage` 全局类型声明

将类型添加到 `tsconfig.json` 中的 `compilerOptions.types` 下

```json
{
  "compilerOptions": {
    "types": ["@uni-ku/pages-json"]
  }
}
```

### vite 详细配置说明

```ts
export interface UserConfig {

  /**
   * 项目根目录
   * @default vite 的 `root` 属性
   */
  root?: string;

  /**
   * 源码目录，pages.json 放置的目录
   * @default "src"
   */
  src?: string;

  /**
   * 为页面路径生成 TypeScript 声明
   * 接受相对项目根目录的路径
   * false 则取消生成
   * @default "pages.d.ts"
   */
  dts?: string | boolean;

  /**
   * pages的相对路径
   * @default 'src/pages'
   */
  pageDir?: string;

  /**
   * subPackages的相对路径
   * @default []
   */
  subPackageDirs?: string[];

  /**
   * 排除条件，应用于 pages 和 subPackages 的文件
   * @default ['node_modules', '.git', '** /__*__/ **']
   */
  excludes?: string[];

  /**
   * 显示调试
   * @default false
   */
  debug?: boolean | 'info' | 'error' | 'debug' | 'warn';
}
```

### 动态 pages 配置文件 `pages.json.(ts|mts|cts|js|cjs|mjs)`

动态 pages 配置文件，可放置在项目 `根目录` 或 `src 目录`。

将与 `definePage` 宏生成的内容合并，生成最终的 `pages.json`

```ts
import { definePagesJson } from '@uni-ku/pages-json';

export default definePagesJson({
  globalStyle: {
    navigationBarTextStyle: 'black',
    navigationBarTitleText: 'uni-app',
    navigationBarBackgroundColor: '#F8F8F8',
    backgroundColor: '#F8F8F8',
  },
  pages: [
    // pages数组中第一项表示应用启动页，参考：https://uniapp.dcloud.io/collocation/pages
    {
      path: 'pages/index/index',
      style: {
        navigationBarTitleText: 'uni-app',
      },
    },
  ],
});
```

## Vue SFC文件的 `definePage` 宏使用方式

更多使用方式请参考 [playground/pages/define-page](./playground/src/pages/define-page/)

> **注意：**
> 1. 以下代码需要写在 `script setup` 或 `script` 内
> 2. `definePage` 宏和当前 SFC 不同域，且先于 SFC 生成，SFC 内部变量无法使用。
> 3. 页面 path url 将会自动根据文件路径生成，如无须配置其他项目，`definePage` 可省略
> 4. 同一个页面内仅可使用一个 `definePage`

### 对象形式
```vue
<script setup lang="ts">
definePage({
  style: {
    navigationBarTitleText: 'hello world',
  },
  middlewares: [
    'auth',
  ],
});
</script>
```

### 函数形式
```vue
<script setup lang="ts">
import type { HelloWorld } from './utils';

definePage(() => {
  const words: HelloWorld = {
    hello: 'hello',
    world: 'world',
  };

  return {
    style: {
      navigationBarTitleText: [words.hello, words.world].join(' '),
    },
    middlewares: [
      'auth',
    ],
  };
});
</script>
```

### 异步数据获取
```vue
<script setup lang="ts">
definePage(async () => {
  function fetchTitle(): Promise<string> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve('hello world from async');
      }, 100);
    });
  }

  const title = await fetchTitle();

  return {
    style: {
      navigationBarTitleText: title,
    },
    middlewares: [
      'auth',
    ],
  };
});
</script>
```
### 引入外部函数、变量
> **注意，仅支持引入：**
> 1. 纯 JavaScript 代码 （如 node_modules 中的第三方库）
> 2. TypeScript 类型声明 （因为会被自动忽略）
```vue
<script setup lang="ts">
import { parse as parseYML } from 'yaml';

definePage(() => {
  const yml = `
style:
  navigationBarTitleText: "yaml test"
`;
  return parseYML(yml);
});
</script>
```

### 条件编译
> **注意：使用第三方库判断环境可能会判断错误。**
> **因为部分第三方库初始化时，变量值已经固定，后期环境变量修改无法跟着变更**
```vue
<script setup lang="ts">
definePage(({ platform }) => {
  // 使用注入的 platform 变量
  const title = platform === 'h5' ? 'H5 环境' : '非 H5 环境';
  // 使用 process.env.UNI_PLATFORM
  const bgColor = process.env.UNI_PLATFORM === 'h5' ? 'white' : 'black';
  return {
    style: {
      navigationBarTitleText: title,
      backgroundColor: bgColor,
    },
  };
});
</script>
```

### 选项式 API
```vue
<script>
definePage({
  style: {
    navigationBarTitleText: 'Option API 内使用 definePage',
  },
  middlewares: [
    'auth',
  ],
});

export default {
  data() {
    return {
      count: 0
    };
  }
};
</script>
```

## 获取当前上下文的数据

由于 `pages.json` 内包含条件编译，以及有重复 key，无法通过 `import` 引入当前环境的完整 json。
可通过虚拟模块引入：
```ts
import pagesJson from 'virtual:@uni-ku/pages-json';

console.log(pagesJson);
```

## 获取 uniapp pages.json 的类型提示
```ts
import type { Page, SubPackage } from '@uni-ku/pages-json/types';
```
