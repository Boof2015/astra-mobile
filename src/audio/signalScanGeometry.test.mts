import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SIGNAL_SCAN_GUIDE,
  signalGuideCapturePreviewRect,
  signalGuideCaptureSourceRect,
} from './signalScanGeometry.ts';

test('uses the padded small-tier presentation geometry for the visible guide', () => {
  assert.equal(SIGNAL_SCAN_GUIDE.aspectRatio, 2.65);
});

test('the high-resolution crop spans the preview but keeps allocation height bounded', () => {
  const preview = { width: 360, height: 640 };
  const crop = signalGuideCapturePreviewRect(preview);
  assert.ok(crop);
  const guideWidth = preview.width * (1 - SIGNAL_SCAN_GUIDE.horizontalInset * 2);
  const guideHeight = guideWidth / SIGNAL_SCAN_GUIDE.aspectRatio;
  assert.equal(crop.x, 0);
  assert.equal(crop.width, preview.width);
  assert.ok(crop.width > guideWidth);
  assert.ok(crop.height > guideHeight);
  assert.ok(crop.height < guideHeight * 1.5);
});

test('maps the expanded preview band into a portrait camera capture', () => {
  const crop = signalGuideCaptureSourceRect(
    { width: 3000, height: 4000 },
    { width: 360, height: 640 }
  );
  assert.ok(crop);
  assert.ok(crop.x > 0);
  assert.ok(crop.x + crop.width < 3000);
  assert.ok(crop.width > 2200);
  assert.ok(crop.height > 950);
  assert.ok(crop.height < 1200);
});
