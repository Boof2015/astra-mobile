import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { normalizeKey } from '@/shared/library/albumGrouping';
import type { ArtistGroupingMode } from '@/library/artistGrouping';
import type { Album, Artist, DbTrack } from '@/types/library';

const DETAIL_PAGE_SIZE = 200;

export type NativeAlbumSummary = Album & { total_duration?: number };

interface PagedDetail<T, S> {
  items: T[];
  summary: S | null;
  totalCount: number;
  loading: boolean;
  loadMore: () => Promise<void>;
}

// Grows without a cap: trimming the head shrank content height mid-scroll, which
// read as the list snapping to the bottom, and these lists have no way to page back
// upwards. See the same note on appendWindow in libraryStore.
function appendTracks(current: DbTrack[], incoming: DbTrack[]): DbTrack[] {
  const paths = new Set(current.map((track) => track.path));
  return [...current, ...incoming.filter((track) => !paths.has(track.path))];
}

export function useNativeAlbumDetail(
  albumKey: string, trackPath?: string
): PagedDetail<DbTrack, NativeAlbumSummary> & { resolvedAlbumKey: string } {
  const [items, setItems] = useState<DbTrack[]>([]);
  const [summary, setSummary] = useState<NativeAlbumSummary | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvedAlbumKey, setResolvedAlbumKey] = useState(albumKey);
  const anchor = useRef<{ key: string; path?: string }>({ key: albumKey, path: trackPath });
  const request = useRef(0);

  const reset = useCallback(async () => {
    if (!albumKey) return;
    const version = ++request.current;
    setLoading(true);
    try {
      const anchorPath = anchor.current.key === albumKey ? anchor.current.path ?? trackPath : trackPath;
      const anchorTrack = anchorPath ? await AstraLibraryData.getTrack<DbTrack>(anchorPath) : null;
      const nextKey = anchorTrack?.album_identity_key ?? albumKey;
      const page = await AstraLibraryData.getAlbumDetail<DbTrack, NativeAlbumSummary>(nextKey, null, DETAIL_PAGE_SIZE);
      if (version !== request.current) return;
      anchor.current = { key: albumKey, path: page.items?.[0]?.path ?? anchorPath };
      setResolvedAlbumKey(nextKey);
      setItems(page.items ?? []);
      setSummary(page.summary ?? null);
      setTotalCount(page.totalCount ?? 0);
      setCursor(page.nextCursor ?? null);
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [albumKey, trackPath]);

  useEffect(() => {
    queueMicrotask(() => void reset());
    const subscription = AstraLibraryData.addListener('onCatalogChanged', () => void reset());
    return () => { request.current += 1; subscription.remove(); };
  }, [reset]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    const version = request.current;
    setLoading(true);
    try {
      const page = await AstraLibraryData.getAlbumDetail<DbTrack, NativeAlbumSummary>(resolvedAlbumKey, cursor, DETAIL_PAGE_SIZE);
      if (version !== request.current) return;
      if (page.error === 'STALE_REVISION') return reset();
      setItems((current) => appendTracks(current, page.items));
      setSummary(page.summary ?? null);
      setTotalCount(page.totalCount ?? 0);
      setCursor(page.nextCursor ?? null);
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [resolvedAlbumKey, cursor, loading, reset]);

  return { items, summary, totalCount, loading, loadMore, resolvedAlbumKey };
}

export function useNativeArtistDetail(
  artistName: string,
  groupingMode: ArtistGroupingMode,
  section: 'songs' | 'appearances' | 'all'
): PagedDetail<DbTrack, Artist> {
  const artistKey = useMemo(() => normalizeKey(artistName), [artistName]);
  const [items, setItems] = useState<DbTrack[]>([]);
  const [summary, setSummary] = useState<Artist | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reset = useCallback(async () => {
    if (!artistKey) return;
    setLoading(true);
    try {
      const page = await AstraLibraryData.getArtistDetail<DbTrack, Artist>(
        artistKey,
        groupingMode,
        section,
        null,
        DETAIL_PAGE_SIZE
      );
      setItems(page.items ?? []);
      setSummary(page.summary ?? null);
      setTotalCount(page.totalCount ?? 0);
      setCursor(page.nextCursor ?? null);
    } finally {
      setLoading(false);
    }
  }, [artistKey, groupingMode, section]);

  useEffect(() => {
    queueMicrotask(() => void reset());
    const catalogSubscription = AstraLibraryData.addListener(
      'onCatalogChanged',
      () => void reset()
    );
    const imageSubscription = AstraLibraryData.addListener(
      'onArtistImagesChanged',
      (event) => {
        if (event.artistKey === artistKey && event.groupingMode === groupingMode) {
          void reset();
        }
      }
    );
    return () => {
      catalogSubscription.remove();
      imageSubscription.remove();
    };
  }, [artistKey, groupingMode, reset]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await AstraLibraryData.getArtistDetail<DbTrack, Artist>(
        artistKey,
        groupingMode,
        section,
        cursor,
        DETAIL_PAGE_SIZE
      );
      if (page.error === 'STALE_REVISION') return reset();
      setItems((current) => appendTracks(current, page.items));
      setSummary(page.summary ?? null);
      setTotalCount(page.totalCount ?? 0);
      setCursor(page.nextCursor ?? null);
    } finally {
      setLoading(false);
    }
  }, [artistKey, cursor, groupingMode, loading, reset, section]);

  return { items, summary, totalCount, loading, loadMore };
}

export function useNativeArtistAlbums(
  artistName: string,
  groupingMode: ArtistGroupingMode,
): {
  items: NativeAlbumSummary[];
  totalCount: number;
  loading: boolean;
  loadMore: () => Promise<void>;
} {
  const artistKey = useMemo(() => normalizeKey(artistName), [artistName]);
  const [items, setItems] = useState<NativeAlbumSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);

  const reset = useCallback(async () => {
    if (!artistKey) return;
    setLoading(true);
    try {
      const page = await AstraLibraryData.getArtistAlbums<NativeAlbumSummary>(
        artistKey,
        groupingMode,
        0,
        DETAIL_PAGE_SIZE,
      );
      setItems(page.items);
      setTotalCount(page.totalCount);
      setNextOffset(page.nextOffset);
    } finally {
      setLoading(false);
    }
  }, [artistKey, groupingMode]);

  useEffect(() => {
    queueMicrotask(() => void reset());
    const subscription = AstraLibraryData.addListener('onCatalogChanged', () => void reset());
    return () => subscription.remove();
  }, [reset]);

  const loadMore = useCallback(async () => {
    if (nextOffset == null || loading) return;
    setLoading(true);
    try {
      const page = await AstraLibraryData.getArtistAlbums<NativeAlbumSummary>(
        artistKey,
        groupingMode,
        nextOffset,
        DETAIL_PAGE_SIZE,
      );
      setItems((current) => {
        const known = new Set(current.map((album) => album.identity_key));
        return [...current, ...page.items.filter((album) => !known.has(album.identity_key))];
      });
      setTotalCount(page.totalCount);
      setNextOffset(page.nextOffset);
    } finally {
      setLoading(false);
    }
  }, [artistKey, groupingMode, loading, nextOffset]);

  return { items, totalCount, loading, loadMore };
}
