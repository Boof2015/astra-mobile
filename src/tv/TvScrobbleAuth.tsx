import { useEffect, useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useLastFmSettingsStore } from '@/stores/lastFmSettingsStore';
import { TvButton, useTvActive, useTvFocus } from './TvFocus';
import { useTvBackHandler } from './TvBack';
import { box, TvText } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';

export function TvScrobbleAuth({ profileId, close }: { profileId: string; close: () => void }) {
  const tv = useTvTheme(); const active = useTvActive(); const { request } = useTvFocus();
  const status = useLastFmSettingsStore(s => s.status); const polling = useLastFmSettingsStore(s => s.isAuthorizing);
  const error = useLastFmSettingsStore(s => s.errorMessage);
  const [url, setUrl] = useState<string | null>(null); const [message, setMessage] = useState('Preparing sign-in…');
  const [attempt, setAttempt] = useState(0); const [busy, setBusy] = useState(true);
  const connected = status?.profiles.find(profile => profile.id === profileId)?.connected;
  const username = status?.profiles.find(profile => profile.id === profileId)?.username;
  useTvBackHandler(active, () => { close(); return true; });
  useEffect(() => {
    let current = true; const store = useLastFmSettingsStore.getState();
    request('auth:close');
    void store.beginAuth(profileId, { openBrowser: false }).then(result => {
      if (!current) return;
      setBusy(false);
      setUrl(result?.ok ? result.authUrl ?? null : null);
      setMessage(result?.ok ? 'Approve Astra on your phone. This TV will connect automatically.' : result?.message || useLastFmSettingsStore.getState().errorMessage || 'Could not start sign-in.');
      request('auth:primary');
    });
    return () => { current = false; useLastFmSettingsStore.getState().cancelAuth(); };
  }, [profileId, attempt, request]);
  const check = async () => {
    if (connected) { close(); return; }
    if (busy) return;
    if (!url || !status?.authPending) { setBusy(true); setUrl(null); setMessage('Preparing sign-in…'); setAttempt(value => value + 1); return; }
    setBusy(true);
    try { const result = await useLastFmSettingsStore.getState().finishAuth(); if (!result?.ok) setMessage('Approval is still pending. Approve Astra on your phone, then check again.'); }
    finally { setBusy(false); }
  };
  return <View style={[box(0, 0, 960, 540), { backgroundColor: tv.bg }]}>
    <TvText size={28} weight="semibold" style={box(51, 57, 858)}>{connected ? 'Last.fm connected' : 'Connect Last.fm'}</TvText>
    <TvText color={tv.muted} style={box(51, 104, 858)}>{connected ? `Connected as ${username ?? 'your account'}.` : 'Scan with your phone, sign in to Last.fm, and approve Astra.'}</TvText>
    {!connected && url && <View style={[box(350, 155, 260, 260), { backgroundColor: '#fff', padding: 14, borderRadius: 12 }]}><QRCode value={url} size={232} quietZone={8} /></View>}
    <TvText color={tv.muted} size={12} numberOfLines={3} style={[box(100, url && !connected ? 430 : 240, 760), { textAlign: 'center' }]}>{connected ? 'Use the scrobbling controls to choose when Astra submits your listening activity.' : error || message}</TvText>
    <TvButton id="auth:primary" label={connected ? 'Done' : busy ? url ? 'Checking…' : 'Preparing…' : url && status?.authPending ? 'Check connection' : 'Try again'} onPress={() => void check()} links={{ right: 'auth:close' }} style={[box(286, 481, 190, 36), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText>{connected ? 'Done' : busy ? url ? 'Checking…' : 'Preparing…' : url && status?.authPending ? polling ? 'Check connection' : 'Check approval' : 'Try again'}</TvText></TvButton>
    <TvButton id="auth:close" label={connected ? 'Back' : 'Cancel'} onPress={close} links={{ left: 'auth:primary' }} style={[box(490, 481, 184, 36), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText>{connected ? 'Back' : 'Cancel'}</TvText></TvButton>
  </View>;
}
