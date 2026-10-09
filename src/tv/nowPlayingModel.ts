export type TvPlayerView = 'cover' | 'lyrics' | 'visualizer';
export type TvVisualizer = 'off' | 'oscilloscope' | 'spectrum';

export function restorePlayerPresentation(storedView: string | null, storedVisualizer: string | null): { view: TvPlayerView; visualizer: TvVisualizer } {
  const visualizer = storedVisualizer === 'off' || storedVisualizer === 'oscilloscope' || storedVisualizer === 'spectrum'
    ? storedVisualizer : storedView === 'visualizer' ? 'oscilloscope' : 'off';
  return { visualizer, view: storedView === 'lyrics' ? 'lyrics' : visualizer === 'oscilloscope' ? 'visualizer' : 'cover' };
}

export function playerViewWithVisualizer(view: TvPlayerView, visualizer: TvVisualizer): TvPlayerView {
  return view === 'lyrics' ? 'lyrics' : visualizer === 'oscilloscope' ? 'visualizer' : 'cover';
}
export type PlayerControl = 'favorite' | 'play' | 'seek' | 'previous' | 'next' | 'shuffle' | 'repeat' | 'lyrics' | 'queue' | 'more';
type Direction = 'up' | 'down' | 'left' | 'right';
const bottom: PlayerControl[] = ['previous', 'next', 'shuffle', 'repeat', 'lyrics', 'queue', 'more'];

/** The same controls retain their order when Lyrics stacks the bottom row. */
export function playerNeighbor(control: PlayerControl, direction: Direction, split: boolean, lastBottom: PlayerControl = 'previous'): PlayerControl {
  if (control === 'favorite') return direction === 'down' ? 'seek' : control;
  if (control === 'play' || control === 'seek') {
    if (direction === 'up') return 'favorite';
    if (direction === 'left') return 'play';
    if (direction === 'right') return 'seek';
    return control === 'play' ? 'previous' : split && bottom.indexOf(lastBottom) > 3 ? 'shuffle' : lastBottom;
  }
  const index = bottom.indexOf(control);
  if (direction === 'left' || direction === 'right') {
    const low = split && index >= 4 ? 4 : 0;
    const high = split && index < 4 ? 3 : 6;
    return bottom[Math.max(low, Math.min(high, index + (direction === 'left' ? -1 : 1)))];
  }
  if (direction === 'down') return split && index < 4 ? index < 2 ? 'lyrics' : 'queue' : control;
  if (split && index >= 4) return index === 4 ? 'next' : 'repeat';
  return index === 0 ? 'play' : 'seek';
}

export function seekPreview(position: number, duration: number, direction: 'left' | 'right', heldMs = 0, repeat = false) {
  const step = repeat && heldMs > 600 ? 15 : 5;
  return Math.max(0, Math.min(Math.max(0, duration - 1), position + (direction === 'left' ? -step : step)));
}

export function canPlayerIdle(playing: boolean, foreground: boolean, seeking: boolean, overlay: boolean) {
  return playing && foreground && !seeking && !overlay;
}

export const playerTime = (seconds: number) => {
  const time = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
};
