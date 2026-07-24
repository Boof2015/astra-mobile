import { useCallback, useEffect, useMemo, useState } from 'react';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { normalizeKey } from '@/shared/library/albumGrouping';
import type { ArtistGroupingMode } from '@/library/artistGrouping';
import type { Album, Artist, DbTrack } from '@/types/library';

const DETAIL_PAGE_SIZE = 100;
const MAX_DETAIL_ITEMS = 500;

export type NativeAlbumSummary = Album & { total_duration?: number };

interface PagedDetail<T, S> {
  items: T[];
  summary: S | null;
  totalCount: number;
  loading: boolean;
  loadMore: () => Promise<void>;
}

function appendTracks(current: DbTrack[], incoming: DbTrack[]): DbTrack[] {
  const paths = new Set(current.map((track) => track.path));
  const merged = [...current, ...incoming.filter((track) => !paths.has(track.path))];
  return merged.length > MAX_DETAIL_ITEMS
    ? merged.slice(merged.length - MAX_DETAIL_ITEMS)
    : merged;
}

export function useNativeAlbumDetail(albumKey: string): PagedDetail<DbTrack, NativeAlbumSummary> {
  const [items, setItems] = useState<DbTrack[]>([]);
  const [summary, setSummary] = useState<NativeAlbumSummary | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reset = useCallback(async () => {
    if (!albumKey) return;
    setLoading(true);
    try {
      const page = await AstraLibraryData.getAlbumDetail<DbTrack, NativeAlbumSummary>(
        albumKey,
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
  }, [albumKey]);

  useEffect(() => {
    queueMicrotask(() => void reset());
    const subscription = AstraLibraryData.addListener('onCatalogChanged', () => void reset());
    return () => subscription.remove();
  }, [reset]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await AstraLibraryData.getAlbumDetail<DbTrack, NativeAlbumSummary>(
        albumKey,
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
  }, [albumKey, cursor, loading, reset]);

  return { items, summary, totalCount, loading, loadMore };
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
    const subscription = AstraLibraryData.addListener('onCatalogChanged', () => void reset());
    return () => subscription.remove();
  }, [reset]);

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
        const merged = [...current, ...page.items.filter((album) => !known.has(album.identity_key))];
        return merged.slice(-MAX_DETAIL_ITEMS);
      });
      setTotalCount(page.totalCount);
      setNextOffset(page.nextOffset);
    } finally {
      setLoading(false);
    }
  }, [artistKey, groupingMode, loading, nextOffset]);

  return { items, totalCount, loading, loadMore };
}
