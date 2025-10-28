<script lang="ts" setup>
definePage(async () => {
  return {
    style: {
      navigationBarTitleText: 'async function page',
    },
    middlewares: [
      'auth',
    ],
  };
});
</script>

<template>
  <div>test</div>
</template>
