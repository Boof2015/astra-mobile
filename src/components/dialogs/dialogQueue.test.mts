import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dismissActiveDialog,
  EMPTY_DIALOG_QUEUE,
  enqueueDialog,
  normalizeDialog,
  takeActiveDialogAction,
} from './dialogQueue.ts';

test('normalizes a notice with a default OK action', () => {
  const dialog = normalizeDialog({ title: 'Saved' }, 1);
  assert.deepEqual(dialog.actions, [{ label: 'OK', role: 'default' }]);
});

test('orders cancel before primary and destructive actions', () => {
  const dialog = normalizeDialog({
    title: 'Delete?',
    actions: [
      { label: 'Delete', role: 'destructive' },
      { label: 'Cancel', role: 'cancel' },
    ],
  }, 1);
  assert.deepEqual(
    dialog.actions.map(({ label, role }) => ({ label, role })),
    [
      { label: 'Cancel', role: 'cancel' },
      { label: 'Delete', role: 'destructive' },
    ],
  );
});

test('queues dialogs FIFO and promotes the next dialog on dismissal', () => {
  const first = normalizeDialog({ title: 'First' }, 1);
  const second = normalizeDialog({ title: 'Second' }, 2);
  const third = normalizeDialog({ title: 'Third' }, 3);
  const queued = enqueueDialog(enqueueDialog(enqueueDialog(
    EMPTY_DIALOG_QUEUE,
    first,
  ), second), third);

  const afterFirst = dismissActiveDialog(queued, first.id);
  assert.equal(afterFirst.dismissed, true);
  assert.equal(afterFirst.state.active?.title, 'Second');
  assert.deepEqual(afterFirst.state.pending.map((dialog) => dialog.title), ['Third']);
});

test('a stale or repeated dismissal cannot consume another dialog', () => {
  const first = normalizeDialog({ title: 'First' }, 1);
  const second = normalizeDialog({ title: 'Second' }, 2);
  const queued = enqueueDialog(enqueueDialog(EMPTY_DIALOG_QUEUE, first), second);

  const afterFirst = dismissActiveDialog(queued, first.id);
  const repeated = dismissActiveDialog(afterFirst.state, first.id);
  assert.equal(repeated.dismissed, false);
  assert.strictEqual(repeated.state, afterFirst.state);
  assert.equal(repeated.state.active?.title, 'Second');
});

test('an action can be taken only once and a dismissal never invokes it', () => {
  let calls = 0;
  const dialog = normalizeDialog({
    title: 'Delete?',
    actions: [{
      label: 'Delete',
      role: 'destructive',
      onPress: () => {
        calls += 1;
      },
    }],
  }, 1);
  const queued = enqueueDialog(EMPTY_DIALOG_QUEUE, dialog);

  const dismissed = dismissActiveDialog(queued, dialog.id);
  assert.equal(calls, 0);
  assert.equal(dismissed.state.active, null);

  const selected = takeActiveDialogAction(queued, dialog.id, 0);
  selected.action?.onPress?.();
  const repeated = takeActiveDialogAction(selected.state, dialog.id, 0);
  repeated.action?.onPress?.();
  assert.equal(calls, 1);
  assert.equal(repeated.action, null);
});
