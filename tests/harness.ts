/**
 * 极简断言器。
 *
 * 刻意不引入 vitest / node:test：本项目没有 @types/node，
 * 引入测试框架就得再装依赖，而测试只需要"跑一遍、失败就非零退出"。
 * 由 tests/all.ts 汇总，最后 report() 抛错让 node 以非零码退出。
 */
interface Case {
  name: string;
  ok: boolean;
  msg?: string;
}

const cases: Case[] = [];

export function test(name: string, fn: () => void): void {
  try {
    fn();
    cases.push({ name, ok: true });
  } catch (e) {
    cases.push({ name, ok: false, msg: e instanceof Error ? e.message : String(e) });
  }
}

export function ok(cond: boolean, what: string): void {
  if (!cond) throw new Error(what);
}

export function eq<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) {
    throw new Error(`${what}：期望 ${String(expected)}，实际 ${String(actual)}`);
  }
}

export function near(actual: number, expected: number, tol: number, what: string): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${what}：期望 ${expected}±${tol}，实际 ${actual}`);
  }
}

/** 断言一段代码会抛错 */
export function throws(fn: () => void, what: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`${what}：期望抛错但没有`);
}

/** 汇总，失败则以非零码退出 */
export function report(): void {
  const passed = cases.filter((c) => c.ok).length;
  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}\n      ${c.msg ?? ''}`);
  console.log(`\n测试：${passed}/${cases.length} 通过`);
  if (failed.length > 0) {
    throw new Error(`${failed.length} 个测试失败`);
  }
}
