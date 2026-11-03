// Guard-reach lint (CLAUDE.md §4 reuse plan: the "is the check reached?" idea, written fresh).
// Every pay path in the runtime adapters, i.e. a hook that lets a payment go ahead, must call one of
// the paid.lock checks, directly or through functions defined in the same file. Static and
// conservative: a check that is only mentioned, not called, does not count.
import ts from "typescript";

/** Hook names that decide whether a payment goes ahead. Grows with each adapter, by reviewed PR. */
export const PAY_PATHS: readonly string[] = [
  // @x402/core x402Client: runs right before a payment is created and can abort it.
  "onBeforePaymentCreation",
];

/** The paid.lock checks (packages/runtime/src/check.ts). */
export const GUARDS: readonly string[] = ["checkAgainstLock", "checkResponse", "checkSelected"];

export interface GuardProblem {
  file: string;
  line: number;
  problem: string;
}

export function isAdapterFile(file: string): boolean {
  return /^packages\/runtime\/src\/adapters\/[^/]+\.ts$/u.test(file) && !file.endsWith(".test.ts");
}

type FnNode = ts.FunctionLikeDeclaration;

function nameOf(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isPropertyAssignment(node)) &&
    node.name !== undefined &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
  ) {
    return node.name.text;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  return undefined;
}

function functionOf(node: ts.Node): FnNode | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return node;
  const init = ts.isPropertyAssignment(node) || ts.isVariableDeclaration(node) ? node.initializer : undefined;
  if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return init;
  return undefined;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

export function checkGuardReach(file: string, source: string): GuardProblem[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const locals = new Map<string, FnNode[]>();
  const payPaths: { name: string; fn: FnNode }[] = [];
  const visit = (node: ts.Node): void => {
    const name = nameOf(node);
    const fn = functionOf(node);
    if (name !== undefined && fn !== undefined) {
      locals.set(name, [...(locals.get(name) ?? []), fn]);
      if (PAY_PATHS.includes(name)) payPaths.push({ name, fn });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const reaches = (fn: FnNode, seen: Set<FnNode>): boolean => {
    if (seen.has(fn)) return false;
    seen.add(fn);
    let found = false;
    const walk = (node: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(node)) {
        const callee = calleeName(node);
        if (callee !== undefined && GUARDS.includes(callee)) {
          found = true;
          return;
        }
        for (const local of callee === undefined ? [] : (locals.get(callee) ?? [])) {
          if (reaches(local, seen)) {
            found = true;
            return;
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    if (fn.body !== undefined) walk(fn.body);
    return found;
  };

  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  if (payPaths.length === 0) {
    return [
      { file, line: 1, problem: "no pay path found (add the hook name to PAY_PATHS in scripts/lib/guard-reach.ts)" },
    ];
  }
  return payPaths
    .filter(({ fn }) => !reaches(fn, new Set()))
    .map(({ name, fn }) => ({ file, line: lineOf(fn), problem: `pay path ${name} does not reach a paid.lock check` }));
}
