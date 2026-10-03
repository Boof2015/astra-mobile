import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * The React Compiler is all-or-nothing per component, and it fails silently:
 * anything it can't prove safe (an exhaustive-deps suppression, a `.value =`
 * write after a hook captured the shared value, a ref reached during render)
 * leaves the whole component as plain React, with no build or runtime error.
 * Uncompiled, the now-playing overlay re-rendered the entire player on every
 * store change (15-55ms passes on an S22 Ultra, 2026-10-02).
 *
 * So this runs the compiler the app builds with over the hot now-playing files
 * and fails, naming the function and the reason, when one falls out.
 */

// Resolved through babel-preset-expo, so this is the same compiler the build runs.
const expoRequire = createRequire(createRequire(import.meta.url).resolve('babel-preset-expo'));
const babel = expoRequire('@babel/core');
const reactCompiler = expoRequire('babel-plugin-react-compiler');

const MUST_COMPILE: { file: URL; functions: string[] }[] = [
  {
    file: new URL('./NowPlayingOverlay.tsx', import.meta.url),
    functions: ['NowPlayingOverlay'],
  },
  {
    file: new URL('./NowPlayingBackdrop.tsx', import.meta.url),
    functions: ['NowPlayingBackdrop', 'Blob'],
  },
  {
    file: new URL('./NowPlayingArtCarousel.tsx', import.meta.url),
    functions: ['NowPlayingArtCarousel'],
  },
  {
    file: new URL('./useArtSwipeHandoff.ts', import.meta.url),
    functions: ['useArtSwipeHandoff'],
  },
];

interface CompilerDetail {
  loc?: { start?: { line?: number } };
  message?: string | null;
}

interface CompilerEvent {
  kind: string;
  fnName?: string | null;
  fnLoc?: { start?: { line?: number } } | null;
  detail?: {
    reason?: string;
    description?: string | null;
    details?: CompilerDetail[];
    options?: { description?: string | null; details?: CompilerDetail[] };
    loc?: { start?: { line?: number } } | null;
  };
  data?: unknown;
}

function describeFailure(event: CompilerEvent): string {
  const detail = event.detail;
  const where = (detail?.details ?? detail?.options?.details ?? [])
    .map((d) => `line ${d.loc?.start?.line}: ${d.message ?? ''}`)
    .join('; ') || `line ${detail?.loc?.start?.line ?? '?'}`;
  const description = detail?.description ?? detail?.options?.description;
  return `function at line ${event.fnLoc?.start?.line ?? '?'}: ${detail?.reason ?? String(event.data)} (${where})${
    description ? ` — ${description}` : ''
  }`;
}

function compile(file: URL): CompilerEvent[] {
  const events: CompilerEvent[] = [];
  const filename = fileURLToPath(file);
  babel.transformSync(readFileSync(file, 'utf8'), {
    filename,
    babelrc: false,
    configFile: false,
    code: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    // babel-preset-expo's production options.
    plugins: [[reactCompiler, {
      target: '19',
      panicThreshold: 'none',
      logger: { logEvent: (_file: string, event: CompilerEvent) => events.push(event) },
    }]],
  });
  return events;
}

for (const { file, functions } of MUST_COMPILE) {
  const name = file.pathname.split('/').pop();
  test(`${name} compiles under the React Compiler`, () => {
    const events = compile(file);
    const failures = events
      .filter((event) => event.kind === 'CompileError' || event.kind === 'PipelineError')
      .map(describeFailure);
    assert.deepEqual([...new Set(failures)], [], `${name} fell out of the compiler`);
    const compiled = new Set(
      events.filter((event) => event.kind === 'CompileSuccess').map((event) => event.fnName),
    );
    for (const fn of functions) {
      assert.ok(compiled.has(fn), `${name}: ${fn} was not compiled`);
    }
  });
}
