import process from 'node:process';
import { defineConfig } from 'vitest/config';

export default defineConfig((opt) => {
  const isDebug = !!(process.env.NODE_OPTIONS && process.env.NODE_OPTIONS.includes('--inspect'));

  return {
    test: {
      testTimeout: isDebug ? 0 : 5_000, // 测试模式不限制超时
      env: {
        UNI_PLATFORM: process.env.UNI_PLATFORM || 'h5', // 注入UNI_PLATFORM
      },
    },
  };
});
