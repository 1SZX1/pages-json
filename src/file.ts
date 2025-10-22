import type { SFCScriptBlock } from '@vue/compiler-sfc';
import type { ParseResult } from 'ast-kit';
import type { Page } from './page';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import * as t from '@babel/types';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { babelParse, isCallOf } from 'ast-kit';
import * as ts from 'typescript';
import { getConfig } from './config';
import { generate } from './utils/babel';
import { debug } from './utils/debug';

interface ScriptSetup extends SFCScriptBlock {
  ast: ParseResult<t.Program>;
  findMacro: (macro: string) => t.CallExpression | undefined;
  findImports: () => t.ImportDeclaration[];
  getMacroResult: <R = any>(macro: string) => Promise<R | undefined> | undefined;
}

export class File {
  /** absolute file path */
  readonly absolutePath: string;

  /** relative file path */
  readonly relativePath: string;

  private _filename: string | undefined;
  private _name: string | undefined;
  private _ext: string | undefined;

  private _content: string | undefined;
  private _scriptSetup: ScriptSetup | undefined;

  page: Page | undefined;

  constructor(filepath: string) {
    const config = getConfig();

    if (path.isAbsolute(filepath)) {
      this.absolutePath = filepath;
      this.relativePath = path.relative(config.basePath, this.absolutePath);
    } else {
      this.relativePath = filepath;
      this.absolutePath = path.join(config.basePath, this.relativePath);
    }
  }

  get filename() {
    if (!this._filename) {
      this._filename = path.basename(this.relativePath);
    }
    return this._filename;
  }

  get name() {
    if (!this._name) {
      this._name = path.parse(this.relativePath).name;
    }
    return this._name;
  }

  get ext() {
    if (!this._ext) {
      this._ext = path.extname(this.relativePath).slice(1);
    }
    return this._ext;
  }

  getContent(forceUpdate = false) {
    if (forceUpdate || !this._content) {
      this.setContent(fs.readFileSync(this.absolutePath, 'utf-8'));
    }
    return this._content!;
  }

  setContent(content: string | null) {
    this._scriptSetup = undefined; // 清空 script setup
    this._content = content === null ? undefined : content;
    return this;
  }

  getScriptSetup(forceUpdate = false) {
    if (forceUpdate || !this._scriptSetup) {
      this.getContent(forceUpdate); // 读取一次content
      this._scriptSetup = parseScriptSetup(this);
    }

    return this._scriptSetup!;
  }

  exec(expression: t.Expression, imports: t.ImportDeclaration[] = []) {
    return exec(this.absolutePath, expression, imports);
  }

  toString() {
    return this.absolutePath;
  }

  toJSON() {
    return this.absolutePath;
  }
}

function findMacro(script: t.Program, fn: string) {
  const nodes = script.body
    .map((raw: t.Node) => {
      let node = raw;
      if (raw.type === 'ExpressionStatement') {
        node = raw.expression;
      }
      return isCallOf(node, fn) ? node : undefined;
    })
    .filter((node): node is t.CallExpression => !!node);

  if (!nodes.length) {
    return;
  }

  if (nodes.length > 1) {
    throw new Error(`duplicate ${fn}() call`);
  }

  const macro = nodes[0];

  const [arg] = macro.arguments;

  if (arg && !t.isFunctionExpression(arg) && !t.isArrowFunctionExpression(arg) && !t.isObjectExpression(arg)) {
    throw new Error(`${fn}() only accept argument in function or object`);
  }

  return macro;
}

function findImports(script: t.Program) {
  return script.body
    .map((node: t.Node) => (node.type === 'ImportDeclaration') ? node : undefined)
    .filter((node): node is t.ImportDeclaration => !!node);
}

function parseScriptSetup(file: File) {
  const source = file.getContent();

  const { descriptor: sfc, errors } = parseSFC(source);

  if (errors.length) {
    debug.error('parseScriptSetup', errors);
    return;
  }

  if (!sfc.scriptSetup) {
    return;
  }

  const { scriptSetup } = sfc;

  const ast = babelParse(scriptSetup.content, scriptSetup.lang || 'js', {
    plugins: [['importAttributes', { deprecatedAssertSyntax: true }]],
  });

  return {
    ...scriptSetup,
    ast,
    findMacro: (macro: string) => findMacro(ast, macro),
    findImports: () => findImports(ast),
    getMacroResult: <R = any>(macro: string) => {
      const _macro = findMacro(ast, macro);
      if (!_macro) {
        return;
      }

      const [arg] = _macro.arguments as [t.Expression];

      if (!arg) {
        return;
      }

      const imports = findImports(ast);

      return exec<R>(file.absolutePath, arg, imports);
    },
  };
}

async function exec<R = any>(file: string, exp: t.Expression, imports: t.ImportDeclaration[]): Promise<R | undefined> {

  const code = generate(exp).code;

  let script = '';

  const importScript = imports.map(imp => `${generate(imp).code}\n`).join('');

  script += importScript;

  script += `export default ${code}`;

  debug.exec(`\nFILE: ${file};`);
  debug.exec(`SCRIPT: \n${script}`);

  const result = await executeTypeScriptCode(script, file);

  debug.exec(`RESULT: `, result);

  return result;
}

/**
 * 执行 TypeScript 代码字符串并返回其返回值
 * @param code - TypeScript 代码字符串
 * @returns 返回值
 */
async function executeTypeScriptCode(code: string, filename: string): Promise<any> {
  // 编译 TypeScript 代码为 JavaScript
  const jsCode = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;

  const dir = path.dirname(filename);

  // 创建一个新的虚拟机上下文
  const vmContext = {
    require: createRequire(dir),
    module: {},
    exports: {},
    __filename: filename,
    __dirname: dir,
  };

  // 使用 vm 模块执行 JavaScript 代码
  const script = new vm.Script(jsCode);

  try {
    script.runInNewContext(vmContext);
  } catch (error: any) {
    throw new Error(`[@uni-ku/pages-json] ${filename} ${error.message}`);
  }

  // 获取导出的值
  const result = (vmContext.exports as any).default || vmContext.exports;

  // 如果是函数，执行函数并返回其返回值
  if (typeof result === 'function') {
    return Promise.resolve(result());
  }

  // 如果不是函数，返回结果
  return Promise.resolve(result);
}
