/**
 * The only part of a list's imperative API a tab re-tap needs.
 *
 * Narrower than `FlashListRef<T>` on purpose: the library's child views key
 * their lists on private row types (`FoldersView`'s tree rows, `PlaylistsView`'s
 * playlists), and a parent holding `FlashListRef<Row>` would have to import
 * them. A callback ref onto this shape is also the variance-safe direction — a
 * `RefObject<Supertype>` is not assignable to `Ref<FlashListRef<Row>>`, while a
 * callback accepting the supertype is.
 */
export interface ScrollToTopHandle {
  scrollToTop: (params?: { animated?: boolean }) => void;
}
