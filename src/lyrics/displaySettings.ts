export const DEFAULT_LYRICS_LANGUAGE_PRIORITY = ['en', 'ja-Latn'] as const;

export interface LyricsDisplaySettings {
  wordTimingEnabled: boolean;
  furiganaEnabled: boolean;
  translationsEnabled: boolean;
  translationPriority: string[];
  voiceLabelsEnabled: boolean;
}

export const DEFAULT_LYRICS_DISPLAY_SETTINGS: LyricsDisplaySettings = {
  wordTimingEnabled: true,
  furiganaEnabled: true,
  translationsEnabled: true,
  translationPriority: [...DEFAULT_LYRICS_LANGUAGE_PRIORITY],
  voiceLabelsEnabled: false,
};

export function normalizeLyricsLanguagePriority(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_LYRICS_LANGUAGE_PRIORITY];
}

export function normalizeLyricsDisplaySettings(value: unknown): LyricsDisplaySettings {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<LyricsDisplaySettings>
    : {};
  return {
    wordTimingEnabled: candidate.wordTimingEnabled !== false,
    furiganaEnabled: candidate.furiganaEnabled !== false,
    translationsEnabled: candidate.translationsEnabled !== false,
    translationPriority: normalizeLyricsLanguagePriority(candidate.translationPriority),
    voiceLabelsEnabled: candidate.voiceLabelsEnabled === true,
  };
}
