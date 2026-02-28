export function noop() {}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function slash(str: string) {
  return str.replace(/\\/g, '/');
}
