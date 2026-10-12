import type { Album, Artist, DbTrack } from '@/types/library';
import type { Playlist } from '@/types/playlist';
import type { TvMenu } from './TvPanel';
import type { NativeFolderNode } from '../../modules/astra-library-scanner';

export type TvPlaylist = Playlist | 'favorites';
export type TvDetail = { kind: 'album'; album: Album } | { kind: 'artist'; artist: Artist } | { kind: 'playlist'; playlist: TvPlaylist } | { kind: 'folder'; node: NativeFolderNode; breadcrumb: string };
export type TvRun = (operation: () => Promise<void>, success?: string) => void;
export type TrackMenu = (track: DbTrack, opener: string, top: number, extra?: { label: string; run: () => void }[]) => void;
export type TvActions = {
  open: (detail: TvDetail) => void;
  light: (uri: string | null) => void;
  menu: (menu: TvMenu) => void;
  trackMenu: TrackMenu;
  run: TvRun;
  namePlaylist: (playlist?: Playlist) => void;
  deletePlaylist: (playlist: Playlist, opener: string) => void;
};
export type DetailProps = { nav: string; actions: TvActions; setEntry: (key: string) => void };
export const playlistName = (playlist: TvPlaylist) => playlist === 'favorites' ? 'Favorites' : playlist.name;
export const playlistKey = (playlist: TvPlaylist) => playlist === 'favorites' ? 'favorites' : String(playlist.id);
export const playlistQuery = (playlist: TvPlaylist) => playlist === 'favorites'
  ? { kind: 'favorites' as const }
  : { kind: playlist.kind === 'dynamic' ? 'dynamicPlaylist' as const : 'playlist' as const, playlistId: playlist.id };
