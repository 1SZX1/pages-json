<script lang="ts" setup>
definePage(({ define }) => {
  return define({
    style: {
      navigationBarTitleText: `hello world`,
    },
  }).ifdef('mp-alipay', {
    // ifdef 内可写入需要条件编译的片段
    style: {
      backgroundColor: '#fff',
    },
  });
});
</script>

<template>
  <div>define page in function mode</div>
</template>
