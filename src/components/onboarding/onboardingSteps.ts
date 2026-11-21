/**
 * First-run wizard sequencing. Pure so the rules can be tested without React.
 *
 * Pages vs. steps: a *page* is what fills the screen; a *step* is what the
 * progress bar counts. `server` is a sub-page of the music step, and the two
 * appearance pages share one step (the bar half-fills on the first). Welcome
 * and Done are bookends: they are pages but not steps.
 */

export type OnboardingPage =
  | 'welcome'
  | 'music'
  | 'server'
  | 'notifications'
  | 'portraits'
  | 'theme'
  | 'player'
  | 'done';

export type OnboardingStep = 'music' | 'notifications' | 'portraits' | 'appearance';

export type NotificationPermissionState = 'not_required' | 'prompt' | 'granted' | 'denied';

export interface OnboardingContext {
  /** A folder is registered or a scan is running: something the notification keeps alive. */
  localMusic: boolean;
  /** null until the native check resolves. */
  notificationPermission: NotificationPermissionState | null;
  /**
   * The notifications page has been shown in this run. Once seen it stays in the
   * sequence, so granting the permission (or a scan finishing) can never make
   * the page vanish under the user or change the progress count on the way back.
   */
  notificationsShown: boolean;
}

const BOOKEND_PAGES: readonly OnboardingPage[] = ['welcome', 'done'];

function notificationsNeeded(ctx: OnboardingContext): boolean {
  if (ctx.notificationsShown) return true;
  if (!ctx.localMusic) return false;
  // Unknown counts as needed: the check resolves in milliseconds, and showing a
  // page that then reports "allowed" beats skipping a grant the user needed.
  return ctx.notificationPermission !== 'granted' && ctx.notificationPermission !== 'not_required';
}

/** The main pages in order. Sub-pages (`server`) are entered from their step, never walked to. */
export function onboardingSequence(ctx: OnboardingContext): OnboardingPage[] {
  const pages: OnboardingPage[] = ['welcome', 'music'];
  if (notificationsNeeded(ctx)) pages.push('notifications');
  pages.push('portraits', 'theme', 'player', 'done');
  return pages;
}

export function stepOf(page: OnboardingPage): OnboardingStep | null {
  switch (page) {
    case 'music':
    case 'server':
      return 'music';
    case 'notifications':
      return 'notifications';
    case 'portraits':
      return 'portraits';
    case 'theme':
    case 'player':
      return 'appearance';
    default:
      return null;
  }
}

export function isBookend(page: OnboardingPage): boolean {
  return BOOKEND_PAGES.includes(page);
}

export function onboardingSteps(ctx: OnboardingContext): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  for (const page of onboardingSequence(ctx)) {
    const step = stepOf(page);
    if (step && !steps.includes(step)) steps.push(step);
  }
  return steps;
}

/** The page "Continue" leads to. Sub-pages continue from their parent. */
export function nextPage(page: OnboardingPage, ctx: OnboardingContext): OnboardingPage | null {
  const from = page === 'server' ? 'music' : page;
  const pages = onboardingSequence(ctx);
  const index = pages.indexOf(from);
  return index >= 0 && index < pages.length - 1 ? pages[index + 1] : null;
}

/**
 * What Android back does.
 * - `{ page }`: go there.
 * - `'exit'`: leave the wizard's back handling to the system (first run: the
 *   app backgrounds) or, on a replay, finish the replay.
 * - `'stay'`: swallow the press (the last page, or a connect in flight).
 */
export type BackResult = { page: OnboardingPage } | 'exit' | 'stay';

export function backFrom(
  page: OnboardingPage,
  ctx: OnboardingContext,
  options: { busy?: boolean } = {}
): BackResult {
  if (options.busy) return 'stay';
  if (page === 'welcome') return 'exit';
  if (page === 'done') return 'stay';
  if (page === 'server') return { page: 'music' };
  const pages = onboardingSequence(ctx);
  const index = pages.indexOf(page);
  return index > 0 ? { page: pages[index - 1] } : 'exit';
}

/** Fill (0..1) of each progress segment for the page on screen. */
export function progressFill(page: OnboardingPage, ctx: OnboardingContext): number[] {
  const steps = onboardingSteps(ctx);
  const current = stepOf(page);
  if (current === null) return steps.map(() => (page === 'done' ? 1 : 0));
  const currentIndex = steps.indexOf(current);
  return steps.map((_, index) => {
    if (index < currentIndex) return 1;
    if (index > currentIndex) return 0;
    return page === 'theme' ? 0.5 : 1;
  });
}

/** "2 of 4" for the eyebrow; null on bookends. */
export function stepPosition(
  page: OnboardingPage,
  ctx: OnboardingContext
): { index: number; count: number } | null {
  const step = stepOf(page);
  if (step === null) return null;
  const steps = onboardingSteps(ctx);
  return { index: steps.indexOf(step) + 1, count: steps.length };
}
