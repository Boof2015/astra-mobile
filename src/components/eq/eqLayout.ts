import { spacing } from '../../theme/spacing.ts';

/**
 * Equalizer shell geometry.
 *
 * The screen used to make one decision — `isWideWindow`, i.e. "is this landscape
 * and at least 600dp" — and hang both its layout and its editor off it. That is
 * a phone-in-landscape rule, and it answered two unrelated questions with one
 * boolean: *can the graph and the controls stack*, and *how much can the editor
 * show at once*. A tablet got the phone-landscape layout scaled up, and a tablet
 * in portrait got the phone layout stretched.
 *
 * They are separate questions, so they are separate knobs here:
 *
 * - **panes** — can the graph sit above the controls, the way it does on a
 *   phone? That is a question about *height*, not orientation, and it is the
 *   same question the navigation rail answers. A phone in landscape has ~411dp
 *   and genuinely cannot stack; a tablet in landscape has plenty and should look
 *   like the phone does.
 * - **editor** — chip strip plus a detail panel for the selected band, or a
 *   console of full per-band strips? That depends on the width the *editor*
 *   gets, which is the side pane when split and the whole scene when stacked.
 */
export type EQPaneMode = 'stacked' | 'split';
export type EQEditorMode = 'strip' | 'console';

export interface EQLayout {
  panes: EQPaneMode;
  editor: EQEditorMode;
  /** Width of the editing column. 0 when stacked — it gets the full scene. */
  sidePaneWidth: number;
  /** Width of one console strip. */
  stripWidth: number;
  /** Height of a console strip's gain rail. */
  railHeight: number;
  /** Total height of the console block, rail included. */
  consoleHeight: number;
}

/** Below this the graph and the controls cannot both be useful stacked. */
const STACK_MIN_HEIGHT = 600;
/** Below this a split pane is too cramped to edit in, whatever the height. */
const SPLIT_MIN_WIDTH = 600;

const SIDE_PANE_MIN_WIDTH = 280;
const SIDE_PANE_MAX_WIDTH = 360;
const SIDE_PANE_WIDTH_RATIO = 0.4;

/** Screen gutter either side of a stacked editor. */
const SCENE_GUTTER = spacing.lg;

/**
 * One console strip: band number and enable switch, the filter type, a gain
 * rail, and the three readouts under it.
 */
const STRIP_WIDTH = 152;
const STRIP_GAP = spacing.sm;
/** Trailing dashed "add band" cell. Narrower — it holds one glyph. */
export const CONSOLE_ADD_WIDTH = 56;

/**
 * Strips the console must be able to seat before it is worth having.
 *
 * Below four, a console is strictly worse than the chip strip it replaces: you
 * would scroll sideways to reach a band whose parameters the detail panel would
 * have shown you in place. The whole point of the console is seeing several
 * bands' values at once.
 */
const CONSOLE_MIN_STRIPS = 4;

const CONSOLE_MIN_WIDTH =
  STRIP_WIDTH * CONSOLE_MIN_STRIPS +
  STRIP_GAP * CONSOLE_MIN_STRIPS +
  CONSOLE_ADD_WIDTH;

/**
 * Everything in a strip that is not the rail: the header row, the type button,
 * three readout rows, and the padding around them. Declared rather than
 * measured, so the console's height is a sum of constants and the rail is the
 * only thing that flexes — the rigid-deck rule.
 */
const STRIP_CHROME_HEIGHT = 156;
const RAIL_HEIGHT_REGULAR = 148;
const RAIL_HEIGHT_COMPACT = 104;
/**
 * Above this the taller rail still leaves the graph a useful share.
 *
 * Set from the other direction: a tablet in landscape is ~800dp tall, and once
 * the header, mode switcher, preset row and preamp are paid for, the regular
 * rail would leave the response curve about 230dp. The rail concedes first —
 * the graph is the thing you are reading.
 */
const RAIL_REGULAR_MIN_HEIGHT = 900;

export function getEQLayout(availableWidth: number, availableHeight: number): EQLayout {
  const split = availableHeight < STACK_MIN_HEIGHT && availableWidth >= SPLIT_MIN_WIDTH;
  const sidePaneWidth = split
    ? Math.min(
        SIDE_PANE_MAX_WIDTH,
        Math.max(SIDE_PANE_MIN_WIDTH, Math.round(availableWidth * SIDE_PANE_WIDTH_RATIO))
      )
    : 0;
  const editorWidth = split ? sidePaneWidth : availableWidth - SCENE_GUTTER * 2;
  const railHeight =
    availableHeight >= RAIL_REGULAR_MIN_HEIGHT ? RAIL_HEIGHT_REGULAR : RAIL_HEIGHT_COMPACT;
  return {
    panes: split ? 'split' : 'stacked',
    editor: editorWidth >= CONSOLE_MIN_WIDTH ? 'console' : 'strip',
    sidePaneWidth,
    stripWidth: STRIP_WIDTH,
    railHeight,
    consoleHeight: STRIP_CHROME_HEIGHT + railHeight,
  };
}
