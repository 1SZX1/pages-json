import fs from 'node:fs';
import path from 'node:path';

/**
 * 检查指定路径的文件，如果文件不存在或不是有效文件则根据是否指定新文件内容创建新的文件
 *
 * @param opt - 配置选项
 * @param opt.path - 要检查的文件路径
 * @param opt.newContent - 新文件的内容。指定后，文件不存在将尝试以指定内容创建文件
 * @param opt.modeFlag - 访问标识。指定后，文件权限不存在则根据是否指定新内容进行创建文件或返回 false
 * @returns 操作是否成功
 */
export async function checkFile(opt: { path: fs.PathLike; newContent?: string; modeFlag?: number }): Promise<boolean> {

  try {
    // 检查文件是否存在且为文件
    const stat = await fs.promises.stat(opt.path);
    if (!stat.isFile()) {
      // 存在但不是文件，删除它
      await fs.promises.unlink(opt.path);
      throw new Error('Not a file'); // 抛出错误，进入 catch 流程
    }

    if (opt.modeFlag !== undefined) {
      // 检查是否有权限
      try {
        await fs.promises.access(opt.path, opt.modeFlag);
      } catch {
        if (opt.newContent !== undefined) {
          // 文件权限更新失败，尝试删除文件
          try {
            await fs.promises.unlink(opt.path);
          } catch {
            return false; // 删除失败，直接返回 false
          }
          throw new Error('Permission error'); // 抛出错误，进入 catch 流程
        } else {
          return false;
        }
      }
    }
    return true;
  } catch { // 文件不存在或不是有效文件或权限不足，需要重新创建
    if (opt.newContent !== undefined) {
      try {
        // 确保目录存在
        await fs.promises.mkdir(path.dirname(opt.path.toString()), { recursive: true });
        // 创建文件
        const mode = opt.modeFlag === undefined
          ? undefined
          : opt.modeFlag << 6 | opt.modeFlag << 3 | opt.modeFlag;
        await fs.promises.writeFile(opt.path, opt.newContent, { encoding: 'utf-8', mode });
        return true;
      } catch {
        return false;
      }
    } else {
      return false;
    }
  }
}

/**
 * 检查指定路径的文件，如果文件不存在或不是有效文件则根据是否指定新文件内容创建新的文件
 *
 * @param opt - 配置选项
 * @param opt.path - 要检查的文件路径
 * @param opt.newContent - 新文件的内容。指定后，文件不存在将尝试以指定内容创建文件
 * @param opt.modeFlag - 访问标识。指定后，文件权限不存在则根据是否指定新内容进行创建文件或返回 false
 * @returns 操作是否成功
 */
export function checkFileSync(opt: { path: fs.PathLike; newContent?: string; modeFlag?: number }): boolean {

  try {
    // 检查文件是否存在且为文件
    const stat = fs.statSync(opt.path);
    if (!stat.isFile()) {
      // 存在但不是文件，删除它
      fs.unlinkSync(opt.path);
      throw new Error('Not a file'); // 抛出错误，进入 catch 流程
    }

    if (opt.modeFlag !== undefined) {
      // 检查是否有权限
      try {
        fs.accessSync(opt.path, opt.modeFlag);
      } catch {

        if (opt.newContent !== undefined) {
          // 文件权限更新失败，尝试删除文件
          try {
            fs.unlinkSync(opt.path);
          } catch {
            return false; // 删除失败，直接返回 false
          }
          throw new Error('Permission error'); // 抛出错误，进入 catch 流程
        } else {
          return false;
        }
      }
    }
    return true;
  } catch {
    // 文件不存在或不是有效文件或权限不足，需要重新创建
    if (opt.newContent !== undefined) {
      try {
        // 确保目录存在
        fs.mkdirSync(path.dirname(opt.path.toString()), { recursive: true });
        // 创建文件
        const mode = opt.modeFlag === undefined
          ? undefined
          : opt.modeFlag << 6 | opt.modeFlag << 3 | opt.modeFlag;
        fs.writeFileSync(opt.path, opt.newContent, { encoding: 'utf-8', mode });
        return true;
      } catch {
        return false;
      }
    } else {
      return false;
    }
  }
}

/**
 * 检测缩进
 */
export function detectIndent(code: string): number {
  const lines = (code || '').split(/\r?\n/);
  const indentSizes: number[] = [];

  // 收集所有非空行的缩进大小
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    const match = line.match(/^(\s*)/);
    const spaces = match ? match[1].length : 0;

    if (spaces > 0) {
      indentSizes.push(spaces);
    }
  }

  if (indentSizes.length === 0) {
    return 2; // 默认返回2个空格
  }

  // 去重并排序
  const uniqueIndents = [...new Set(indentSizes)].sort((a, b) => a - b);

  // 如果只有一个缩进值，直接返回
  if (uniqueIndents.length === 1) {
    return uniqueIndents[0];
  }

  // 计算所有缩进值的最大公约数作为基础缩进
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  let baseIndent = uniqueIndents[0];

  for (let i = 1; i < uniqueIndents.length; i++) {
    baseIndent = gcd(baseIndent, uniqueIndents[i]);
    // 如果最大公约数为1，说明可能不是规则缩进
    if (baseIndent === 1) {
      break;
    }
  }

  // 验证基础缩进是否合理（通常是2-8之间的常见值）
  if (baseIndent >= 2 && baseIndent <= 8) {
    return baseIndent;
  }

  // 如果计算出的基础缩进不合理，回退到使用最小缩进值
  return uniqueIndents[0];
}
