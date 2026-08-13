import { AstraLibraryData } from '../../modules/astra-library-scanner';

export async function getNativeSetting(key: string): Promise<string | null> {
  await AstraLibraryData.initialize();
  const values = await AstraLibraryData.getSettings([key]);
  return values[key] ?? null;
}

export async function getNativeSettings(
  keys: readonly string[]
): Promise<Record<string, string | null>> {
  await AstraLibraryData.initialize();
  return AstraLibraryData.getSettings([...keys]);
}

export async function setNativeSetting(key: string, value: string | null): Promise<void> {
  await AstraLibraryData.setSettings({ [key]: value });
}
