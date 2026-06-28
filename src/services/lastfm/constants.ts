// Last.fm API credentials. Desktop reads these from `LASTFM_API_KEY` /
// `LASTFM_SHARED_SECRET` env vars (src/main/index.ts). Expo inlines `EXPO_PUBLIC_*`
// vars at build time, so put your registered Last.fm API application's key + secret
// in a (gitignored) `.env` file — see `.env.example`. Without them, the official
// Last.fm protocol is disabled (custom/AudioScrobbler/ListenBrainz still work, as
// they sign with their own credentials).
//
// Note: like every Last.fm desktop/mobile client, the "shared secret" ships inside
// the app. Last.fm's auth model accepts this — the session key (obtained per user
// via browser approval) is what authorizes scrobbles, and it lives in secure-store.

export const LASTFM_API_KEY = (process.env.EXPO_PUBLIC_LASTFM_API_KEY ?? '').trim();
export const LASTFM_SHARED_SECRET = (process.env.EXPO_PUBLIC_LASTFM_SHARED_SECRET ?? '').trim();
