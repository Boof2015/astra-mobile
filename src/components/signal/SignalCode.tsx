import { forwardRef, useImperativeHandle, useMemo } from 'react';
import { AlphaType, Canvas, ColorType, Group, Path, Rect, Skia } from '@shopify/react-native-skia';
import {
  SIGNAL_SPEC,
  levelHeightModules,
  rasterizeSignal,
  type SignalLayout,
} from '@boof2015/astra-signal';

export interface SignalCodeHandle {
  /** Canonical six-pixels-per-module PNG as base64, independent of display size. */
  snapshot: () => string | null;
}

interface SignalCodeProps {
  layout: SignalLayout;
  width: number;
  foreground: string;
  background: string;
  branded?: boolean;
  exportForeground?: string;
  exportBackground?: string;
}

const G = SIGNAL_SPEC.geom;
const BRAND_WIDTH_MODULES = 46;
const BRAND_PADDING_MODULES = 10;
const BRAND_LOGO_SIZE_MODULES = 34;
const BRAND_LOGO_X_MODULES = 3;
const BRAND_LOGO_Y_MODULES = 3;
const LOGO_VIEWBOX_SIZE = 1024;
const LOGO_MAIN_SCALE = 1.726813;
const LOGO_MAIN_TRANSLATE_X = -660.505902;
const LOGO_MAIN_TRANSLATE_Y = -397.11951;
const LOGO_LEFT_PATH =
  'M526.083,500.65C529.86,496.662 535.112,494.402 540.605,494.402C553.071,494.402 576.056,494.402 588.831,494.402C594.652,494.402 600.185,496.939 603.984,501.35C610.054,508.396 619.61,519.49 627.207,528.31C633.905,536.085 633.631,547.668 626.573,555.117C603.295,579.689 553.937,631.788 536.916,649.755C533.139,653.742 527.889,656 522.397,656L452,656C440.954,656 432,647.046 432,636C432,626.32 432,615.247 432,607.967C432,602.851 433.96,597.93 437.478,594.215C454.783,575.942 508.184,519.551 526.083,500.65Z';
const LOGO_RIGHT_PATH =
  'M580,389.237C580,378.578 588.641,369.937 599.3,369.937C625.097,369.937 669.782,369.937 688.899,369.937C694.682,369.937 700.183,372.436 703.987,376.792C736.676,414.222 893.163,593.401 921.571,625.929C924.427,629.198 926,633.392 926,637.733C926,637.733 926,637.734 926,637.734C926,648.379 917.371,657.008 906.726,657.008L817.1,657.008C811.318,657.008 805.817,654.51 802.013,650.155C769.332,612.742 612.909,433.673 584.448,401.092C581.58,397.809 580,393.598 580,389.239C580,389.238 580,389.237 580,389.237Z';

function rgb(hex: string): [number, number, number] {
  const value = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error('Signal colors must be six-digit hex values');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function logoMatrix(pixelsPerModule: number, paddingModules = 0): number[] {
  const logoScale = (BRAND_LOGO_SIZE_MODULES * pixelsPerModule) / LOGO_VIEWBOX_SIZE;
  const pathScale = LOGO_MAIN_SCALE * logoScale;
  return [
    pathScale,
    0,
    (paddingModules + BRAND_LOGO_X_MODULES) * pixelsPerModule + LOGO_MAIN_TRANSLATE_X * logoScale,
    0,
    pathScale,
    (paddingModules + BRAND_LOGO_Y_MODULES) * pixelsPerModule + LOGO_MAIN_TRANSLATE_Y * logoScale,
    0,
    0,
    1,
  ];
}

function encodeBrandedSnapshot(
  signalImage: ReturnType<typeof Skia.Image.MakeImage>,
  signalWidth: number,
  signalHeight: number,
  foreground: string,
  background: string
): string | null {
  if (!signalImage) return null;
  const pixelsPerModule = 6;
  const brandWidth = BRAND_WIDTH_MODULES * pixelsPerModule;
  const padding = BRAND_PADDING_MODULES * pixelsPerModule;
  const surface = Skia.Surface.MakeOffscreen(
    padding * 2 + brandWidth + signalWidth,
    padding * 2 + signalHeight
  );
  const leftPath = Skia.Path.MakeFromSVGString(LOGO_LEFT_PATH);
  const rightPath = Skia.Path.MakeFromSVGString(LOGO_RIGHT_PATH);
  if (!surface || !leftPath || !rightPath) {
    surface?.dispose();
    leftPath?.dispose();
    rightPath?.dispose();
    return null;
  }

  const paint = Skia.Paint();
  let snapshot: ReturnType<typeof surface.makeImageSnapshot> | null = null;
  try {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color(background));
    canvas.drawImage(signalImage, padding + brandWidth, padding);
    paint.setColor(Skia.Color(foreground));
    const saveCount = canvas.save();
    canvas.concat(logoMatrix(pixelsPerModule, BRAND_PADDING_MODULES));
    canvas.drawPath(leftPath, paint);
    canvas.drawPath(rightPath, paint);
    canvas.restoreToCount(saveCount);
    surface.flush();
    snapshot = surface.makeImageSnapshot();
    return snapshot.encodeToBase64();
  } finally {
    snapshot?.dispose();
    paint.dispose();
    leftPath.dispose();
    rightPath.dispose();
    surface.dispose();
  }
}

/** Render the v3 connected upper/lower spectrum envelope directly from SignalLayout. */
export const SignalCode = forwardRef<SignalCodeHandle, SignalCodeProps>(function SignalCode(
  {
    layout,
    width,
    foreground,
    background,
    branded = false,
    exportForeground = foreground,
    exportBackground = background,
  },
  ref
) {
  const brandWidthModules = branded ? BRAND_WIDTH_MODULES : 0;
  const paddingModules = branded ? BRAND_PADDING_MODULES : 0;
  const scale = width / (layout.widthModules + brandWidthModules + paddingModules * 2);
  const height = (layout.heightModules + paddingModules * 2) * scale;

  useImperativeHandle(
    ref,
    () => ({
      snapshot: () => {
        const raster = rasterizeSignal(layout, {
          scale: 6,
          foreground: rgb(exportForeground),
          background: rgb(exportBackground),
        });
        const bytes = new Uint8Array(raster.data.length);
        bytes.set(raster.data);
        const data = Skia.Data.fromBytes(bytes);
        const image = Skia.Image.MakeImage(
          {
            width: raster.width,
            height: raster.height,
            colorType: ColorType.RGBA_8888,
            alphaType: AlphaType.Unpremul,
          },
          data,
          raster.width * 4
        );
        data.dispose();
        if (!image) return null;
        try {
          return branded
            ? encodeBrandedSnapshot(image, raster.width, raster.height, exportForeground, exportBackground)
            : image.encodeToBase64();
        } finally {
          image.dispose();
        }
      },
    }),
    [branded, exportBackground, exportForeground, layout]
  );

  const envelope = useMemo(() => {
    const path = Skia.Path.Make();
    const centerY = (paddingModules + G.quietModules + G.halfHeightModules) * scale;
    for (let index = 0; index < layout.columns.length; index += 1) {
      const column = layout.columns[index];
      if (!column) continue;
      const upper = levelHeightModules(column.upperLevel) * scale;
      const lower = levelHeightModules(column.lowerLevel) * scale;
      const x = (
        paddingModules
        + brandWidthModules
        + G.quietModules
        + index * G.columnPitchModules
      ) * scale;
      path.addRect(Skia.XYWHRect(x, centerY - upper, G.columnPitchModules * scale, upper + lower));
    }
    return path;
  }, [brandWidthModules, layout, paddingModules, scale]);

  const markMatrix = useMemo(
    () => logoMatrix(scale, paddingModules),
    [paddingModules, scale]
  );

  return (
    <Canvas style={{ width, height }}>
      <Rect x={0} y={0} width={width} height={height} color={background} />
      {branded ? (
        <Group matrix={markMatrix} color={foreground}>
          <Path path={LOGO_LEFT_PATH} />
          <Path path={LOGO_RIGHT_PATH} />
        </Group>
      ) : null}
      <Path path={envelope} color={foreground} />
    </Canvas>
  );
});
