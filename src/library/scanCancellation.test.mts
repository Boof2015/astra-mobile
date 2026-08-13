import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createScanCancellationController,
  runCancellableFolderScans,
  type ScanResult,
} from './scanCancellation.ts';

const completed = (added: number): ScanResult => ({
  added,
  updated: 0,
  removed: 0,
  errors: 0,
  cancelled: false,
});

test('cancellation controller is immediate and idempotent', () => {
  const controller = createScanCancellationController();
  assert.equal(controller.signal.cancelled, false);

  controller.cancel();
  controller.cancel();

  assert.equal(controller.signal.cancelled, true);
});

test('cancelling between folders keeps completed results and starts no later folder', async () => {
  const controller = createScanCancellationController();
  const started: number[] = [];

  const result = await runCancellableFolderScans(
    [1, 2, 3],
    controller.signal,
    () => true,
    async (folder) => {
      started.push(folder);
      if (folder === 1) controller.cancel();
      return completed(folder);
    }
  );

  assert.deepEqual(started, [1]);
  assert.deepEqual(result, { ...completed(1), cancelled: true });
});

test('a native cancellation discards the active result but keeps earlier folders', async () => {
  const started: number[] = [];

  const result = await runCancellableFolderScans(
    [1, 2, 3],
    undefined,
    () => true,
    async (folder) => {
      started.push(folder);
      return folder === 2
        ? { ...completed(0), cancelled: true }
        : completed(folder);
    }
  );

  assert.deepEqual(started, [1, 2]);
  assert.deepEqual(result, { ...completed(1), cancelled: true });
});

test('unavailable folders are skipped without affecting totals', async () => {
  const started: number[] = [];

  const result = await runCancellableFolderScans(
    [
      { id: 1, available: true },
      { id: 2, available: false },
      { id: 3, available: true },
    ],
    undefined,
    (folder) => folder.available,
    async (folder) => {
      started.push(folder.id);
      return completed(folder.id);
    }
  );

  assert.deepEqual(started, [1, 3]);
  assert.deepEqual(result, completed(4));
});
