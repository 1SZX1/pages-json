import type { ConfigHook } from './config';

export const hookUniPlatform: ConfigHook = {
  parsePageOption: (opt) => {
    opt.pagePath = opt.pagePath.replace(/\..*$/, '');
    return opt;
  },
  filterPages: (platform, opts) => {
    return opts.filter((opt) => {
      const matched = opt.filePath.match(/([^.]+)\.([^.]+)\.([^.]+)$/);
      return !matched || matched[2] === platform;
    });
  },
};
