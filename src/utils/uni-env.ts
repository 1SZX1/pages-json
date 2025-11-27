import process from 'node:process';

/**
 * `process.env.UNI_PLATFORM`
 *
 * @link {https://github.com/dcloudio/uni-app/blob/v3.0.0-4020920240930001/packages/shims-node.d.ts#L9}
 * @link {https://github.com/dcloudio/uni-app/blob/v3.0.0-4020920240930001/packages/shims-uni-app.d.ts#L24}
 * @link {https://github.com/dcloudio/uni-app/blob/v3.0.0-4020920240930001/packages/shims-uni-app.d.ts#L193-L211}
 * @link {https://github.com/dcloudio/uni-app/blob/v3.0.0-4020920240930001/packages/uni-cli-shared/src/env/define.ts#L24}
 */
export type UniPlatform = 'h5' | 'web' | 'app' | 'app-plus' | 'app-harmony' | 'mp-360' | 'mp-alipay' | 'mp-baidu' | 'mp-qq' | 'mp-toutiao' | 'mp-weixin' | 'mp-kuaishou' | 'mp-lark' | 'mp-jd' | 'mp-xhs' | 'mp-harmony' | 'quickapp-webview' | 'quickapp-webview-huawei' | 'quickapp-webview-union';

/**
 * `process.env.UNI_PLATFORM`
 *
 * @link {https://github.com/dcloudio/uni-app/blob/v3.0.0-4020920240930001/packages/shims-node.d.ts#L9}
 * @link {https://github.com/dcloudio/uni-app/blob/v3.0.0-4020920240930001/packages/shims-uni-app.d.ts#L24}
 * @link {https://github.com/dcloudio/uni-app/blob/v3.0.0-4020920240930001/packages/shims-uni-app.d.ts#L193-L211}
 * @link {https://github.com/dcloudio/uni-app/blob/v3.0.0-4020920240930001/packages/uni-cli-shared/src/env/define.ts#L24}
 */
export const currentPlatform = () => (process.env.UNI_PLATFORM || 'h5') as UniPlatform;
