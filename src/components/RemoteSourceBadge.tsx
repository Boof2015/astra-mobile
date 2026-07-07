import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/theme/themed';
import type { TrackSourceType } from '@/types/library';

/**
 * Small "this track streams from a server" marker. Renders nothing for local files.
 * A cloud icon reads as remote/streamed regardless of provider (Subsonic/Jellyfin).
 */
export function RemoteSourceBadge({
  sourceType,
  size = 12,
  color,
}: {
  sourceType?: TrackSourceType | null;
  size?: number;
  color?: string;
}) {
  const colors = useColors();
  if (!sourceType || sourceType === 'local') return null;
  return (
    <Ionicons
      name="cloud"
      size={size}
      color={color ?? colors.accent}
      accessibilityLabel={`Streaming from ${sourceType}`}
    />
  );
}

export default RemoteSourceBadge;
