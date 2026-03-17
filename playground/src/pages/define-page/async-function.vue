<script lang="ts" setup>
definePage(async ({ platform }) => {

  if (platform === 'mp-weixin') {
    return null; // 返回 null 表示该页面应该被排除
  }

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
    // ...
  };
});
</script>

<template>
  <div>test</div>
</template>
