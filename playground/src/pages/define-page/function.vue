<script lang="ts" setup>
// define 函数可对页面配置条件编译
// 函数参数 platform 会被自动注入，表示当前页面所属平台。
definePage(({ define, platform }) => define({
  style: {
    navigationBarTitleText: `hello from ${platform}`,
  },
}).ifdef('mp-alipay', {
  // ifdef 内可写入需要条件编译的片段
  style: {
    backgroundColor: '#fff',
  },
}));
</script>

<template>
  <div>define page in function mode</div>
</template>
