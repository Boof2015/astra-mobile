import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

SPEC = importlib.util.spec_from_file_location('optimization', Path(__file__).parents[1] / 'verify-android-optimization.py')
optimization = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(optimization)
DEX_DATA = b'dex\n~~R8{"pg-map-id":"fixture-map"}\x00'


def r8_metadata():
    return {
        'version': '8.12.14',
        'options': {key: True for key in (
            'isObfuscationEnabled', 'isOptimizationsEnabled', 'isShrinkingEnabled')},
        'resourceOptimization': {'isOptimizedShrinkingEnabled': True},
        'dexFiles': [{'checksum': hashlib.sha256(DEX_DATA).hexdigest()}],
        'stats': {'noObfuscationPercentage': 17.12, 'noOptimizationPercentage': 17.62, 'noShrinkingPercentage': 16.8},
    }


class OptimizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.mapping = self.root / 'mapping'
        self.mapping.mkdir()
        for name in optimization.REPORT_FILES:
            (self.mapping / name).write_text('# R8 report\n')
        (self.mapping / 'mapping.txt').write_text('# pg_map_id: fixture-map\nexample.Player -> a.a:\n')

    def artifact(self, suffix='.aab', omit=(), mapping=None, metadata=None):
        artifact = self.root / ('candidate' + suffix)
        with ZipFile(artifact, 'w') as archive:
            archive.writestr('base/dex/classes.dex' if suffix == '.aab' else 'classes.dex', DEX_DATA)
            if suffix == '.aab':
                if optimization.MAPPING_METADATA not in omit:
                    archive.writestr(optimization.MAPPING_METADATA, mapping or (self.mapping / 'mapping.txt').read_bytes())
                if optimization.R8_METADATA not in omit:
                    archive.writestr(optimization.R8_METADATA, json.dumps(metadata if metadata is not None else r8_metadata()))
        return artifact

    def test_records_dex_size_and_metadata_for_matching_bundle(self):
        report = optimization.verify_artifact(self.artifact(), self.mapping)
        self.assertEqual(report['dexBytesUncompressed'], len(DEX_DATA))
        self.assertEqual(report['dexFiles'], 1)
        self.assertEqual(report['r8'], r8_metadata())
        self.assertEqual(report['r8CoveragePercent'], {'obfuscation': 82.88, 'optimization': 82.38, 'shrinking': 83.2})
        self.assertEqual(len(report['sha256']), 64)

    def test_apk_uses_matching_external_metadata(self):
        metadata_path = self.root / 'r8-metadata.dat'
        metadata_path.write_text(json.dumps(r8_metadata()))
        report = optimization.verify_artifact(self.artifact('.apk'), self.mapping, metadata_path)
        self.assertEqual(report['r8'], r8_metadata())
        with self.assertRaisesRegex(ValueError, 'requires --r8-metadata'):
            optimization.verify_artifact(self.artifact('.apk'), self.mapping)
        (self.mapping / 'mapping.txt').write_text('# pg_map_id: stale-map\nexample.Player -> a.a:\n')
        with self.assertRaisesRegex(ValueError, 'DEX map ID differs'):
            optimization.verify_artifact(self.artifact('.apk'), self.mapping, metadata_path)

    def test_rejects_missing_reports(self):
        for name in optimization.REPORT_FILES:
            with self.subTest(name=name):
                path = self.mapping / name
                original = path.read_bytes()
                path.unlink()
                with self.assertRaisesRegex(ValueError, 'Missing R8 report'):
                    optimization.verify_artifact(self.root / 'unused.apk', self.mapping)
                path.write_bytes(original)

    def test_rejects_global_disabling_rules_but_ignores_comments(self):
        artifact = self.artifact()
        for directive in ('dontoptimize', 'dontobfuscate', 'dontshrink'):
            (self.mapping / 'configuration.txt').write_text(f'# -{directive}\n')
            optimization.verify_artifact(artifact, self.mapping)
            (self.mapping / 'configuration.txt').write_text(f'  -{directive}\n')
            with self.assertRaisesRegex(ValueError, 'globally disabled'):
                optimization.verify_artifact(artifact, self.mapping)

    def test_rejects_missing_bundle_metadata(self):
        for name in (optimization.MAPPING_METADATA, optimization.R8_METADATA):
            with self.assertRaisesRegex(ValueError, 'AAB is missing'):
                optimization.verify_artifact(self.artifact(omit=(name,)), self.mapping)

    def test_rejects_reports_from_another_build(self):
        with self.assertRaisesRegex(ValueError, 'reports may be stale'):
            optimization.verify_artifact(self.artifact(mapping=b'example.Other -> b.a:\n'), self.mapping)
        metadata = r8_metadata()
        metadata['dexFiles'][0]['checksum'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'DEX checksums differ'):
            optimization.verify_artifact(self.artifact(metadata=metadata), self.mapping)

    def test_rejects_empty_metadata_and_unobfuscated_mapping(self):
        with self.assertRaisesRegex(ValueError, 'nonempty JSON object'):
            optimization.verify_artifact(self.artifact(metadata={}), self.mapping)
        (self.mapping / 'mapping.txt').write_text('example.Player -> example.Player:\n')
        with self.assertRaisesRegex(ValueError, 'no obfuscated classes'):
            optimization.verify_artifact(self.artifact(), self.mapping)

    def test_rejects_disabled_r8_features_in_bundle_metadata(self):
        for key in r8_metadata()['options']:
            metadata = r8_metadata()
            metadata['options'][key] = False
            with self.assertRaisesRegex(ValueError, 'does not enable'):
                optimization.verify_artifact(self.artifact(metadata=metadata), self.mapping)
        metadata = r8_metadata()
        metadata['resourceOptimization'] = {}
        with self.assertRaisesRegex(ValueError, 'optimized resource shrinking'):
            optimization.verify_artifact(self.artifact(metadata=metadata), self.mapping)

    def test_threshold_checks_each_metric_and_accepts_exactly_25_percent(self):
        for key in r8_metadata()['stats']:
            metadata = r8_metadata()
            metadata['stats'][key] = 75
            optimization.verify_r8_metadata(metadata, optimization.DEX_THRESHOLD_BYTES)
            metadata['stats'][key] = 75.01
            with self.assertRaisesRegex(ValueError, 'below the required 25%'):
                optimization.verify_r8_metadata(metadata, optimization.DEX_THRESHOLD_BYTES)
            optimization.verify_r8_metadata(metadata, optimization.DEX_THRESHOLD_BYTES - 1)

    def test_rejects_missing_or_invalid_percentage_metadata(self):
        for value in (None, True, '17', -1, 101, float('nan')):
            metadata = r8_metadata()
            metadata['stats']['noObfuscationPercentage'] = value
            with self.assertRaisesRegex(ValueError, 'lacks a valid'):
                optimization.verify_r8_metadata(metadata, optimization.DEX_THRESHOLD_BYTES)


class GeneratedConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'app/src/main/res/raw').mkdir(parents=True)
        (self.root / 'gradle.properties').write_text(
            'android.enableMinifyInReleaseBuilds=true\n'
            'android.enableShrinkResourcesInReleaseBuilds=true\n'
            'android.r8.optimizedResourceShrinking=true\n')
        (self.root / 'app/build.gradle').write_text(
            'proguardFiles getDefaultProguardFile("proguard-android-optimize.txt")\n'
            'minifyEnabled enableMinifyInReleaseBuilds\n'
            'shrinkResources enableShrinkResources.toBoolean()\n'
            'preview { initWith release }\n')
        (self.root / 'app/src/main/res/raw/astra_notification_keep.xml').write_text(
            '<resources xmlns:tools="http://schemas.android.com/tools" '
            'tools:keep="@drawable/astra_notification_icon,@drawable/exo_notification_small_icon" />')
        (self.root / 'app/proguard-rules.pro').write_text('-keep class expo.modules.kotlin.records.** { *; }\n')

    def test_accepts_optimized_prebuild_configuration(self):
        optimization.verify_generated(self.root)

    def test_rejects_disabled_or_duplicated_properties(self):
        path = self.root / 'gradle.properties'
        original = path.read_text()
        for properties in (original.replace('true', 'false', 1), original + original):
            path.write_text(properties)
            with self.assertRaisesRegex(ValueError, 'enabled exactly once'):
                optimization.verify_generated(self.root)

    def test_rejects_loss_of_record_compatibility_rule(self):
        (self.root / 'app/proguard-rules.pro').write_text('# missing keep rule\n')
        with self.assertRaisesRegex(ValueError, 'record-conversion compatibility'):
            optimization.verify_generated(self.root)

    def test_rejects_non_optimizing_default_and_missing_notification_keep(self):
        path = self.root / 'app/build.gradle'
        original = path.read_text()
        path.write_text(original.replace('proguard-android-optimize.txt', 'proguard-android.txt'))
        with self.assertRaisesRegex(ValueError, 'optimizing R8 configuration'):
            optimization.verify_generated(self.root)
        path.write_text(original)
        (self.root / 'app/src/main/res/raw/astra_notification_keep.xml').write_text('<resources />')
        with self.assertRaisesRegex(ValueError, 'Notification resources'):
            optimization.verify_generated(self.root)


if __name__ == '__main__':
    unittest.main()
