import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Text';
import {
  SettingsCard,
  SettingsNavRow,
  SettingsSectionScreen,
} from '@/components/settings/SettingsSectionScaffold';
import { legalDocuments, readLegalDocument } from '../../../modules/astra-discord';

export default function LicensesSettingsScreen() {
  const { document: id } = useLocalSearchParams<{ document?: string }>();
  const document = legalDocuments.find((entry) => entry.id === id);
  const [loaded, setLoaded] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    let current = true;
    if (document) {
      void readLegalDocument(document.id).then(
        (text) => { if (current) setLoaded({ id: document.id, text }); },
        () => { if (current) setLoaded({ id: document.id, text: 'This document could not be loaded. The license files are also available in Astra’s GitHub repository.' }); },
      );
    }
    return () => { current = false; };
  }, [document]);

  return (
    <SettingsSectionScreen title={document?.readerTitle ?? 'Licenses'} backLabel={document ? 'Licenses' : 'Info'}>
      {document ? (
        <SettingsCard>
          <Text variant="body" selectable style={{ lineHeight: 22 }}>
            {loaded?.id === document.id ? loaded.text : 'Loading…'}
          </Text>
        </SettingsCard>
      ) : legalDocuments.map((entry) => (
        <SettingsNavRow
          key={entry.id}
          icon="document-text-outline"
          title={entry.title}
          subtitle="Read the bundled document offline"
          onPress={() => router.push({ pathname: '/settings/licenses', params: { document: entry.id } })}
        />
      ))}
    </SettingsSectionScreen>
  );
}
