// Tiny test harness. The test build is one concatenated script (module:
// none, same as the app build), so tests register through a global t()
// and run.ts executes them under plain `node test/build.js`.

declare const process: { exitCode?: number };

interface TestCase { name: string; fn: () => void; }
const testCases: TestCase[] = [];

function t(name: string, fn: () => void): void {
  testCases.push({ name, fn });
}

function eq<T>(got: T, want: T, what = ""): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${what ? what + ": " : ""}got ${g}, want ${w}`);
}

function ok(cond: boolean, what: string): void {
  if (!cond) throw new Error(what);
}

function runTests(): void {
  let failed = 0;
  for (const c of testCases) {
    try {
      c.fn();
      console.log(`ok   ${c.name}`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${c.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`${testCases.length - failed}/${testCases.length} passed`);
  if (failed > 0) process.exitCode = 1;
}
