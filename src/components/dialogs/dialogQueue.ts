export type AppDialogActionRole = 'default' | 'cancel' | 'destructive';

export interface AppDialogAction {
  label: string;
  role?: AppDialogActionRole;
  onPress?: () => void;
}

export interface AppDialogOptions {
  title: string;
  message?: string;
  actions?: readonly AppDialogAction[];
}

export interface AppDialog {
  id: number;
  title: string;
  message?: string;
  actions: readonly AppDialogAction[];
}

export interface AppDialogQueueState {
  active: AppDialog | null;
  pending: readonly AppDialog[];
}

export const EMPTY_DIALOG_QUEUE: AppDialogQueueState = {
  active: null,
  pending: [],
};

export function normalizeDialog(options: AppDialogOptions, id: number): AppDialog {
  const sourceActions = options.actions?.length
    ? options.actions
    : [{ label: 'OK', role: 'default' as const }];
  const actions = [
    ...sourceActions.filter((action) => action.role === 'cancel'),
    ...sourceActions.filter((action) => action.role !== 'cancel'),
  ].map((action) => ({
    ...action,
    role: action.role ?? 'default',
  }));

  return {
    id,
    title: options.title,
    message: options.message,
    actions,
  };
}

export function enqueueDialog(
  state: AppDialogQueueState,
  dialog: AppDialog,
): AppDialogQueueState {
  if (!state.active) {
    return { active: dialog, pending: state.pending };
  }
  return { active: state.active, pending: [...state.pending, dialog] };
}

export function dismissActiveDialog(
  state: AppDialogQueueState,
  expectedId: number,
): { state: AppDialogQueueState; dismissed: boolean } {
  if (state.active?.id !== expectedId) {
    return { state, dismissed: false };
  }
  const [next = null, ...pending] = state.pending;
  return {
    state: { active: next, pending },
    dismissed: true,
  };
}

export function takeActiveDialogAction(
  state: AppDialogQueueState,
  expectedId: number,
  actionIndex: number,
): { state: AppDialogQueueState; action: AppDialogAction | null } {
  const action = state.active?.id === expectedId
    ? state.active.actions[actionIndex] ?? null
    : null;
  if (!action) return { state, action: null };
  const result = dismissActiveDialog(state, expectedId);
  return {
    state: result.state,
    action,
  };
}
