import babelGenerator from '@babel/generator';
import * as babelTypes from '@babel/types';

function getDefaultExport<T = any>(expr: T): T {
  return (expr as any).default === undefined ? expr : (expr as any).default;
}

export const generate = getDefaultExport(babelGenerator);

export const t = getDefaultExport(babelTypes);
