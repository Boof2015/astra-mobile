import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * The worklets Babel plugin turns every `function f() { 'worklet'; ... }` into
 * `var f = <factory>({ ...what f calls })`, run where `f` is declared. So a
 * worklet captures the helpers it calls *at its declaration*: a helper declared
 * further down the file is still `undefined` there, even though plain JS would
 * hoist it. Nothing fails until the UI thread calls it — then the app crashes.
 * (The Q-line drag did exactly this: `qFromLineDrag` sat above `quantizeQ`.)
 *
 * Under node the hoisting hides it, so this checks the order directly: a
 * worklet may only call same-file worklets declared above it.
 */
const FILES = [
  new URL('../../audio/eq.ts', import.meta.url),
  new URL('./peqGeometry.ts', import.meta.url),
  new URL('./eqGraphMath.ts', import.meta.url),
  new URL('./EQGraph.tsx', import.meta.url),
  new URL('../waveformTransition.ts', import.meta.url),
  new URL('../player/DrawnTransportIcons.tsx', import.meta.url),
];

interface Worklet {
  name: string;
  start: number;
  body: string;
}

function worklets(source: string): Worklet[] {
  const out: Worklet[] = [];
  const decl = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (let m = decl.exec(source); m; m = decl.exec(source)) {
    // Skip the parameter list, then take the body's opening brace: the last `{`
    // before the end of the signature's line (return types may hold braces).
    let i = m.index + m[0].length - 1;
    for (let depth = 0; ; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')' && --depth === 0) break;
    }
    const open = source.lastIndexOf('{', source.indexOf('\n', i));
    if (open < i) continue;
    let close = open;
    for (let depth = 0; close < source.length; close++) {
      if (source[close] === '{') depth++;
      else if (source[close] === '}' && --depth === 0) break;
    }
    const body = source.slice(open + 1, close);
    if (/^\s*'worklet';/.test(body)) out.push({ name: m[1], start: m.index, body });
  }
  return out;
}

test('every worklet calls only same-file worklets declared above it', () => {
  for (const file of FILES) {
    const all = worklets(readFileSync(file, 'utf8'));
    assert.ok(all.length > 0, `${file.pathname} has no worklets — is the scan broken?`);
    for (const caller of all) {
      for (const callee of all) {
        if (callee === caller) continue;
        if (!new RegExp(`\\b${callee.name}\\(`).test(caller.body)) continue;
        assert.ok(
          callee.start < caller.start,
          `${file.pathname.split('/').pop()}: ${caller.name} calls ${callee.name}, which is declared below it`
        );
      }
    }
  }
});
