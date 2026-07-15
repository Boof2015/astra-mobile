import { forwardRef, useImperativeHandle, useMemo } from 'react';
import { AlphaType, Canvas, ColorType, Path, Rect, Skia } from '@shopify/react-native-skia';
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
  exportForeground?: string;
  exportBackground?: string;
}

const G = SIGNAL_SPEC.geom;

function rgb(hex: string): [number, number, number] {
  const value = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error('Signal colors must be six-digit hex values');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/** Render the v3 connected upper/lower spectrum envelope directly from SignalLayout. */
export const SignalCode = forwardRef<SignalCodeHandle, SignalCodeProps>(function SignalCode(
  { layout, width, foreground, background, exportForeground = foreground, exportBackground = background },
  ref
) {
  const scale = width / layout.widthModules;
  const height = layout.heightModules * scale;

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
          return image.encodeToBase64();
        } finally {
          image.dispose();
        }
      },
    }),
    [exportBackground, exportForeground, layout]
  );

  const envelope = useMemo(() => {
    const path = Skia.Path.Make();
    const centerY = (G.quietModules + G.halfHeightModules) * scale;
    for (let index = 0; index < layout.columns.length; index += 1) {
      const column = layout.columns[index];
      if (!column) continue;
      const upper = levelHeightModules(column.upperLevel) * scale;
      const lower = levelHeightModules(column.lowerLevel) * scale;
      const x = (G.quietModules + index * G.columnPitchModules) * scale;
      path.addRect(Skia.XYWHRect(x, centerY - upper, G.columnPitchModules * scale, upper + lower));
    }
    return path;
  }, [layout, scale]);

  return (
    <Canvas style={{ width, height }}>
      <Rect x={0} y={0} width={width} height={height} color={background} />
      <Path path={envelope} color={foreground} />
    </Canvas>
  );
});
