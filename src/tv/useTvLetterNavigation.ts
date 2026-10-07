import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AstraLibraryData, type LibrarySectionAnchor, type NativePage } from '../../modules/astra-library-scanner';
import { onTvVerticalHold } from '../../modules/astra-tv';
import { createSectionJumpCoordinator, prepareSectionJump, type SectionJumpWindow } from '@/library/sectionJump';
import type { TvPage } from './useTvPage';
import type { TvMenu } from './TvPanel';
import { heldPage, heldSection, nextAvailableLetter, TV_LETTERS } from './letterNavigation';

type Options<T> = {
  active: boolean; alphabetic: boolean; contentFocused: boolean;
  items: T[]; index: number; previousCursor?: string | null; pageSize: number;
  keyOf: (item: T) => string; labelOf: (item: T) => string;
  anchors: () => Promise<LibrarySectionAnchor[]>;
  readAt: (cursor: string, before: boolean) => Promise<NativePage<T>>;
  readStart: () => Promise<TvPage<T>>;
  replace: (window: TvPage<T>, restore: () => Promise<TvPage<T>>) => void;
  land: (item: T, index: number) => void;
  more: () => void; previous: () => void;
  menu: (menu: TvMenu) => void; unavailable: () => void;
};

/** Catalog windows and the existing jump coordinator bound native work during
 * a hold. The latest intent wins, and focus moves only after a complete window. */
export function useTvLetterNavigation<T>(options: Options<T>) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const [anchors, setAnchors] = useState<LibrarySectionAnchor[]>([]);
  const [badge, setBadge] = useState<string | null>(null);
  const [instant, setInstant] = useState(false);
  const [mountedRevision, setMountedRevision] = useState(0);
  const sequence = useRef(0);
  const coordinator = useRef(createSectionJumpCoordinator<SectionJumpWindow<T>>());
  const intent = useRef<string | null>(null);
  const repeating = useRef(false);
  const hiding = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getAnchors = options.anchors;
  const readAt = options.readAt;
  const keyOf = options.keyOf;
  const refreshAnchors = useCallback(async () => {
    const result = await getAnchors();
    return result;
  }, [getAnchors]);

  useEffect(() => {
    let current = true;
    let version = 0;
    const controller = coordinator.current;
    const refresh = () => {
      const request = ++version;
      controller.cancel(); intent.current = null;
      void refreshAnchors().then(value => { if (current && version === request) setAnchors(value); }).catch(() => { if (current && version === request) setAnchors([]); });
    };
    refresh();
    const subscription = AstraLibraryData.addListener('onCatalogChanged', refresh);
    return () => { current = false; controller.cancel(); subscription.remove(); };
  }, [refreshAnchors]);
  useLayoutEffect(() => { coordinator.current.ready(mountedRevision); }, [mountedRevision]);

  const prepare = useCallback(async (label: string) => {
    // Fresh cursors are important when a scan changed the catalog revision.
    const all = await refreshAnchors();
    const anchor = all.find(value => value.label === label);
    return anchor ? prepareSectionJump(() => readAt(anchor.cursor, false), () => readAt(anchor.cursor, true), keyOf) : null;
  }, [refreshAnchors, readAt, keyOf]);
  const jump = useCallback((label: string, showBadge: boolean) => {
    intent.current = label;
    void coordinator.current.request({ key: label, prepare: () => prepare(label), apply: window => {
      const state = latest.current;
      const item = window.items[window.anchorIndex];
      if (!item) return null;
      setInstant(true);
      state.replace(window, async () => {
        const current = latest.current;
        const currentLabel = current.items[current.index] ? current.labelOf(current.items[current.index]) : label;
        const restored = await prepare(currentLabel);
        // A removed section (or an empty library) must still have a recovery
        // path; never retain a dead anchor through every future refresh.
        return restored ?? current.readStart();
      });
      state.land(item, window.anchorIndex);
      if (showBadge) {
        setBadge(label);
        if (!repeating.current) {
          if (hiding.current) clearTimeout(hiding.current);
          hiding.current = setTimeout(() => setBadge(null), 500);
        }
      }
      const revision = ++sequence.current;
      setMountedRevision(revision);
      return revision;
    }, onUnavailable: () => { intent.current = null; latest.current.unavailable(); } });
  }, [prepare]);

  useEffect(() => {
    if (options.active) return;
    coordinator.current.cancel(); intent.current = null; repeating.current = false;
    if (hiding.current) clearTimeout(hiding.current);
    queueMicrotask(() => setBadge(null));
  }, [options.active]);

  useEffect(() => {
    const hideLater = () => {
      if (hiding.current) clearTimeout(hiding.current);
      hiding.current = setTimeout(() => setBadge(null), 500);
    };
    const subscription = onTvVerticalHold(event => {
      const state = latest.current;
      if (!state.active || !state.contentFocused) return;
      if (event.phase === 'start' || event.phase === 'cancel') {
        coordinator.current.cancel(); intent.current = null; repeating.current = false; setBadge(null); setInstant(false);
        return;
      }
      if (event.phase === 'release') { repeating.current = false; hideLater(); return; }
      if (hiding.current) clearTimeout(hiding.current);
      repeating.current = true;
      const item = state.items[state.index];
      if (!item) return;
      const label = state.labelOf(item);
      if (state.alphabetic) setBadge(label);
      if (event.phase !== 'jump') return;
      if (!state.alphabetic) {
        setInstant(true);
        const index = heldPage(state.index, state.items.length, state.pageSize, event.direction);
        state.land(state.items[index], index);
        if (event.direction === 'down') state.more(); else state.previous();
        return;
      }
      const atStart = intent.current !== null || (state.index > 0 ? state.labelOf(state.items[state.index - 1]) !== label : !state.previousCursor);
      const target = heldSection(anchors.map(anchor => anchor.label), intent.current ?? label, event.direction, atStart);
      if (target) jump(target, true);
    });
    return () => { subscription?.remove(); if (hiding.current) clearTimeout(hiding.current); };
  }, [anchors, jump]);

  const open = (left: number) => {
    const state = latest.current;
    const present = anchors.map(anchor => anchor.label);
    const current = state.items[state.index] ? state.labelOf(state.items[state.index]) : 'A';
    state.menu({ title: 'Jump to', opener: 'jump', left, top: 108, columns: 7, selected: Math.max(0, TV_LETTERS.indexOf(current)),
      items: TV_LETTERS.map(label => {
        const target = nextAvailableLetter(label, present);
        return { label, muted: !present.includes(label), keepOpen: !target, run: () => { if (target) jump(target, false); else state.unavailable(); } };
      }),
    });
  };
  // Derive from the focused item: native repeat events precede the focus event.
  const visible = badge && options.active && options.contentFocused && options.alphabetic;
  return { open, instant, badge: visible && options.items[options.index] ? options.labelOf(options.items[options.index]) : null };
}
