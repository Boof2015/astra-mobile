import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { EqSheet } from '@/components/eq/EqSheet';
import type { KnownEQOutputDevice } from '@/audio/eqDevicePresets';
import type { EQPreset } from '@/types/audio';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { playHaptic } from '@/lib/haptics';

interface PresetDeviceAssignmentSheetProps {
  preset: EQPreset;
  devices: KnownEQOutputDevice[];
  assignments: Readonly<Record<string, string>>;
  presets: EQPreset[];
  currentDeviceKey: string | null;
  onSave: (deviceKeys: string[]) => void;
  onClose: () => void;
}

function kindLabel(device: KnownEQOutputDevice): string {
  switch (device.kind) {
    case 'speaker':
      return 'Phone speaker';
    case 'wired':
      return 'Wired output';
    case 'bluetooth':
      return 'Bluetooth';
    case 'usb':
      return 'USB audio';
    case 'hdmi':
      return 'HDMI audio';
    default:
      return 'Audio output';
  }
}

/** Optional Poweramp-style automation: one saved preset may own many devices. */
export function PresetDeviceAssignmentSheet({
  preset,
  devices,
  assignments,
  presets,
  currentDeviceKey,
  onSave,
  onClose,
}: PresetDeviceAssignmentSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(devices.filter((device) => assignments[device.key] === preset.id).map((device) => device.key))
  );
  const presetNames = useMemo(
    () => new Map(presets.map((candidate) => [candidate.id, candidate.name])),
    [presets]
  );
  const sortedDevices = useMemo(
    () => [...devices].sort((a, b) => {
      if (a.key === currentDeviceKey) return -1;
      if (b.key === currentDeviceKey) return 1;
      return b.lastSeenAt - a.lastSeenAt || a.label.localeCompare(b.label);
    }),
    [currentDeviceKey, devices]
  );

  const toggleDevice = (deviceKey: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(deviceKey)) next.delete(deviceKey);
      else next.add(deviceKey);
      return next;
    });
    playHaptic('selection');
  };

  return (
    <EqSheet onClose={onClose} scrollable>
      <Text variant="heading" style={styles.title}>
        Assign {preset.name}
      </Text>
      <Text variant="caption" color={colors.textSecondary} style={styles.description}>
        This preset will load automatically when a selected output becomes active.
      </Text>

      {sortedDevices.length === 0 ? (
        <Text variant="body" color={colors.textTertiary} style={styles.empty}>
          No audio outputs have been observed yet.
        </Text>
      ) : (
        <View style={styles.list}>
          {sortedDevices.map((device) => {
            const checked = selected.has(device.key);
            const assignedPresetId = assignments[device.key];
            const assignedPresetName = assignedPresetId ? presetNames.get(assignedPresetId) : null;
            const subtitle = assignedPresetId === preset.id
              ? 'Assigned to this preset'
              : assignedPresetName
                ? `Currently assigned to ${assignedPresetName}`
                : kindLabel(device);
            return (
              <Pressable
                key={device.key}
                android_ripple={ripple.bounded}
                unstable_pressDelay={SCROLL_PRESS_DELAY}
                style={styles.deviceRow}
                onPress={() => toggleDevice(device.key)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={`${device.label}${device.key === currentDeviceKey ? ', current output' : ''}`}
              >
                <View style={styles.deviceMeta}>
                  <View style={styles.deviceTitleRow}>
                    <Text variant="body" numberOfLines={1} style={styles.deviceTitle}>
                      {device.label}
                    </Text>
                    {device.key === currentDeviceKey ? (
                      <Text variant="caption" color={colors.accentTextStrong} style={styles.currentBadge}>
                        CURRENT
                      </Text>
                    ) : null}
                  </View>
                  <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
                    {subtitle}
                  </Text>
                </View>
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={checked ? colors.accent : colors.textTertiary}
                />
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.actions}>
        <Pressable android_ripple={ripple.bounded} style={[styles.button, styles.cancel]} onPress={onClose}>
          <Text variant="label" color={colors.textSecondary}>Cancel</Text>
        </Pressable>
        <Pressable
          android_ripple={ripple.bounded}
          style={[styles.button, styles.save]}
          onPress={() => {
            onSave([...selected]);
            onClose();
          }}
        >
          <Text variant="label" color={colors.accentTextStrong}>Save assignments</Text>
        </Pressable>
      </View>
    </EqSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  title: {
    marginTop: spacing.xs,
  },
  description: {
    lineHeight: 17,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  empty: {
    paddingVertical: spacing.xl,
  },
  list: {
    gap: spacing.xs,
  },
  deviceRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.glassBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  deviceMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  deviceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deviceTitle: {
    flexShrink: 1,
  },
  currentBadge: {
    fontSize: 10,
    letterSpacing: 0.7,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  button: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  cancel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  save: {
    backgroundColor: colors.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
}));

export default PresetDeviceAssignmentSheet;
