<script lang="ts" setup>
definePage(({ t, platform }) => {

  return t({
    style: {
      navigationBarTitleText: `hello ${platform}`,
    },
    middlewares: [
      'auth',
    ],
  });
});
</script>

<template>
  <div>define page in function mode</div>
</template>
