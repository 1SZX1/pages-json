import { definePagesJson } from '@uni-ku/pages-json';

export default definePagesJson(({ platform }) => {
  return {
    globalStyle: {
      navigationBarTextStyle: 'black',
      navigationBarTitleText: platform === 'h5' ? 'uni-app H5' : 'uni-app',
      navigationBarBackgroundColor: '#F8F8F8',
      backgroundColor: '#F8F8F8',
    },
    pages: [ // pages数组中第一项表示应用启动页，参考：https://uniapp.dcloud.io/collocation/pages
      {
        path: 'pages/index/index',
        style: {
          navigationBarTitleText: 'uni-app',
        },
      },
    ],
    subPackages: [
      {
        root: 'pages-sub',
        plugins: {
          'uni-id-pages': {
            version: '1.0.0',
            provider: 'https://service-1.pages.dev',
          },
        },
      },
    ],
  };
});
