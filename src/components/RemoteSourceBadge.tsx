import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';
import type { TrackSourceType } from '@/types/library';

/**
 * Small "this track streams from a server" marker. Renders nothing for local files.
 * A cloud icon reads as remote/streamed regardless of provider (Subsonic/Jellyfin).
 */
export function RemoteSourceBadge({
  sourceType,
  size = 12,
  color = colors.accent,
}: {
  sourceType?: TrackSourceType | null;
  size?: number;
  color?: string;
}) {
  if (!sourceType || sourceType === 'local') return null;
  return (
    <Ionicons
      name="cloud"
      size={size}
      color={color}
      accessibilityLabel={`Streaming from ${sourceType}`}
    />
  );
}

export default RemoteSourceBadge;
