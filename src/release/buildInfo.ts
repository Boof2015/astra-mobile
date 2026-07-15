export type DistributionChannel = 'development' | 'github' | 'google-play';

export interface ExpoBuildConfig {
  version?: string | null;
  extra?: Record<string, unknown> | null;
}

export interface BuildInfo {
  distribution: DistributionChannel;
  distributionLabel: 'Development' | 'GitHub' | 'Google Play';
  showExternalSupportLink: boolean;
  version: string | null;
  versionLabel: string;
}

const DISTRIBUTION_LABELS: Record<DistributionChannel, BuildInfo['distributionLabel']> = {
  development: 'Development',
  github: 'GitHub',
  'google-play': 'Google Play',
};

export function normalizeDistributionChannel(value: unknown): DistributionChannel {
  return value === 'github' || value === 'google-play' ? value : 'development';
}

export function createBuildInfo(config: ExpoBuildConfig | null | undefined): BuildInfo {
  const rawVersion = typeof config?.version === 'string' ? config.version.trim() : '';
  const version = rawVersion || null;
  const distribution = normalizeDistributionChannel(config?.extra?.distribution);
  const distributionLabel = DISTRIBUTION_LABELS[distribution];

  return {
    distribution,
    distributionLabel,
    showExternalSupportLink: distribution !== 'google-play',
    version,
    versionLabel: version ? `v${version} (${distributionLabel})` : `Unavailable (${distributionLabel})`,
  };
}
