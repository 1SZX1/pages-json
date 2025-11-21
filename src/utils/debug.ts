import Debug from 'debug';

const PREFIX = 'pages-json:';

const DebugLevel = {
  error: 0,
  info: 1,
  warn: 2,
  debug: 3,
};

export type DebugLevelType = keyof typeof DebugLevel;

export const debug = generateDebug();

function generateDebug() {
  return Object.fromEntries(Object.keys(DebugLevel).map(t => ([t, Debug(PREFIX + t)]))) as Record<DebugLevelType, Debug.Debugger>;
}

export function enableDebug(enable: boolean | DebugLevelType) {
  if (enable === false) {
    return;
  }

  const level = (enable === true) ? DebugLevel.info : (DebugLevel[enable] || DebugLevel.info);

  for (const [key, val] of Object.entries(DebugLevel)) {
    if (level >= val) {
      Debug.enable(`${PREFIX}${key}`);
    }
  }
}
