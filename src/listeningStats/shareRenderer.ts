import { Asset } from 'expo-asset';
import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import {
  ClipOp,
  FontWeight,
  ImageFormat,
  Skia,
  TextAlign,
  TextDirection,
  rect,
  type SkCanvas,
  type SkFont,
  type SkImage,
  type SkPaint,
  type SkData,
  type SkTypeface,
} from '@shopify/react-native-skia';
import type {
  ListeningStatsShareItem,
  ListeningStatsShareModel,
} from './shareModel';
import {
  LISTENING_STATS_SHARE_HEIGHT,
  LISTENING_STATS_SHARE_WIDTH,
} from './shareDimensions';

export {
  LISTENING_STATS_SHARE_HEIGHT,
  LISTENING_STATS_SHARE_WIDTH,
} from './shareDimensions';

const BACKGROUND = '#0f0f10';
const TEXT = '#f5f5f6';
const TEXT_SECONDARY = '#bfc0c8';
const CONTENT_LEFT = 120;
const CONTENT_RIGHT = 1354;
const CENTER_X = LISTENING_STATS_SHARE_WIDTH / 2;
const HERO_X = 437;
const HERO_Y = 190;
const HERO_SIZE = 600;
const NON_LATIN =
  /[^\u0000-\u024F\u0370-\u03FF\u0400-\u04FF\u2000-\u206F\u20A0-\u20CF\u2100-\u214F]/;

interface RendererFonts {
  regular: SkFont;
  semibold: SkFont;
  bold: SkFont;
  mono: SkFont;
  typefaces: SkTypeface[];
  fontData: SkData[];
}

export interface ListeningStatsShareRenderOptions {
  accentColor: string;
  artworkUris: ReadonlyMap<string, string>;
}

async function loadTypeface(moduleId: number): Promise<{ typeface: SkTypeface; data: SkData }> {
  const asset = Asset.fromModule(moduleId);
  if (!asset.localUri) await asset.downloadAsync();
  const data = await Skia.Data.fromURI(asset.localUri ?? asset.uri);
  const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(data);
  if (!typeface) {
    data.dispose();
    throw new Error('A bundled share-card font could not be loaded.');
  }
  return { typeface, data };
}

async function loadFonts(): Promise<RendererFonts> {
  const loaded = await Promise.all([
    loadTypeface(Inter_400Regular),
    loadTypeface(Inter_600SemiBold),
    loadTypeface(Inter_700Bold),
    loadTypeface(JetBrainsMono_500Medium),
  ]);
  const typefaces = loaded.map((entry) => entry.typeface);
  return {
    regular: Skia.Font(typefaces[0], 32),
    semibold: Skia.Font(typefaces[1], 32),
    bold: Skia.Font(typefaces[2], 32),
    mono: Skia.Font(typefaces[3], 28),
    typefaces,
    fontData: loaded.map((entry) => entry.data),
  };
}

async function loadArtwork(
  artworkUris: ReadonlyMap<string, string>,
): Promise<Map<string, SkImage>> {
  const images = new Map<string, SkImage>();
  await Promise.all(
    [...artworkUris].map(async ([key, uri]) => {
      if (!uri) return;
      try {
        const data = await Skia.Data.fromURI(uri);
        try {
          const image = Skia.Image.MakeImageFromEncoded(data);
          if (image) images.set(key, image);
        } finally {
          data.dispose();
        }
      } catch {
        // A missing local file or unreachable remote cover gets the branded placeholder.
      }
    }),
  );
  return images;
}

function setColor(paint: SkPaint, color: string): void {
  paint.setColor(Skia.Color(color));
}

function fittedText(
  value: string,
  maxWidth: number,
  font: SkFont,
  paint: SkPaint,
): string {
  const clean = value.trim() || 'Unknown';
  if (font.measureText(clean, paint).width <= maxWidth) return clean;
  const characters = Array.from(clean);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join('').trimEnd()}…`;
    if (font.measureText(candidate, paint).width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join('').trimEnd()}…`;
}

function drawSystemParagraph(
  canvas: SkCanvas,
  fonts: RendererFonts,
  options: {
    text: string;
    x: number;
    y: number;
    maxWidth: number;
    size: number;
    minSize: number;
    color: string;
    font: SkFont;
    align?: 'left' | 'center' | 'right';
  },
): void {
  const weight = options.font === fonts.bold
    ? FontWeight.Bold
    : options.font === fonts.semibold
      ? FontWeight.SemiBold
      : options.font === fonts.mono
        ? FontWeight.Medium
        : FontWeight.Normal;
  const align = options.align === 'center'
    ? TextAlign.Center
    : options.align === 'right'
      ? TextAlign.Right
      : TextAlign.Left;
  const direction = /[\u0590-\u08FF]/.test(options.text)
    ? TextDirection.RTL
    : TextDirection.LTR;
  let size = options.size;
  let paragraph: ReturnType<ReturnType<typeof Skia.ParagraphBuilder.Make>['build']> | null = null;
  while (size >= options.minSize) {
    const builder = Skia.ParagraphBuilder.Make({
      maxLines: 1,
      ellipsis: '…',
      textAlign: align,
      textDirection: direction,
      textStyle: {
        color: Skia.Color(options.color),
        fontFamilies: ['sans-serif'],
        fontSize: size,
        fontStyle: { weight },
      },
    });
    builder.addText(options.text.trim() || 'Unknown');
    const candidate = builder.build();
    builder.dispose();
    candidate.layout(options.maxWidth);
    paragraph?.dispose();
    paragraph = candidate;
    if (candidate.getMaxIntrinsicWidth() <= options.maxWidth || size === options.minSize) break;
    size -= 1;
  }
  if (!paragraph) return;
  const baseline = paragraph.getLineMetrics()[0]?.baseline ?? size;
  const x = options.align === 'center'
    ? options.x - options.maxWidth / 2
    : options.align === 'right'
      ? options.x - options.maxWidth
      : options.x;
  paragraph.paint(canvas, x, options.y - baseline);
  paragraph.dispose();
}

function drawFittedText(
  canvas: SkCanvas,
  paint: SkPaint,
  fonts: RendererFonts,
  options: {
    text: string;
    x: number;
    y: number;
    maxWidth: number;
    size: number;
    minSize: number;
    color: string;
    font: SkFont;
    align?: 'left' | 'center' | 'right';
  },
): void {
  if (NON_LATIN.test(options.text)) {
    drawSystemParagraph(canvas, fonts, options);
    return;
  }
  const font = options.font;
  let size = options.size;
  font.setSize(size);
  while (size > options.minSize && font.measureText(options.text, paint).width > options.maxWidth) {
    size -= 1;
    font.setSize(size);
  }
  const text = fittedText(options.text, options.maxWidth, font, paint);
  const width = font.measureText(text, paint).width;
  const x = options.align === 'center'
    ? options.x - width / 2
    : options.align === 'right'
      ? options.x - width
      : options.x;
  setColor(paint, options.color);
  canvas.drawText(text, x, options.y, paint, font);
}

function drawCover(
  canvas: SkCanvas,
  paint: SkPaint,
  image: SkImage | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: string,
): void {
  const rounded = { rect: rect(x, y, width, height), rx: 20, ry: 20 };
  const save = canvas.save();
  canvas.clipRRect(rounded, ClipOp.Intersect, true);
  if (!image) {
    setColor(paint, '#222329');
    canvas.drawRect(rect(x, y, width, height), paint);
    setColor(paint, `${accent}55`);
    canvas.drawCircle(x + width * 0.32, y + height * 0.35, width * 0.25, paint);
    setColor(paint, `${accent}33`);
    canvas.drawCircle(x + width * 0.72, y + height * 0.68, width * 0.33, paint);
  } else {
    const scale = Math.max(width / image.width(), height / image.height());
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    canvas.drawImageRect(
      image,
      rect(
        (image.width() - sourceWidth) / 2,
        (image.height() - sourceHeight) / 2,
        sourceWidth,
        sourceHeight,
      ),
      rect(x, y, width, height),
      paint,
    );
  }
  canvas.restoreToCount(save);
}

function itemMetric(item: ListeningStatsShareItem, model: ListeningStatsShareModel): string {
  if (model.rankingMetric === 'plays') {
    const plays = Math.max(0, Math.round(item.qualifiedPlays));
    return `${plays.toLocaleString('en-US')} ${plays === 1 ? 'PLAY' : 'PLAYS'}`;
  }
  const minutes = Math.floor(Math.max(0, item.listenedSeconds) / 60);
  if (minutes < 1) return '<1 MIN';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${minutes} MIN`;
  return remainder === 0 ? `${hours} HR` : `${hours} HR ${remainder} MIN`;
}

function drawCard(
  canvas: SkCanvas,
  paint: SkPaint,
  fonts: RendererFonts,
  model: ListeningStatsShareModel,
  accent: string,
  images: ReadonlyMap<string, SkImage>,
): void {
  canvas.clear(Skia.Color(BACKGROUND));

  setColor(paint, `${accent}22`);
  canvas.drawCircle(CENTER_X, 360, 530, paint);
  setColor(paint, `${accent}12`);
  canvas.drawCircle(160, 720, 420, paint);

  drawFittedText(canvas, paint, fonts, {
    text: 'LISTENING STATS',
    x: 64,
    y: 82,
    maxWidth: 520,
    size: 31,
    minSize: 24,
    color: TEXT_SECONDARY,
    font: fonts.mono,
  });
  drawFittedText(canvas, paint, fonts, {
    text: model.rankingLabel.replace('RANKED ', ''),
    x: 1410,
    y: 82,
    maxWidth: 600,
    size: 31,
    minSize: 22,
    color: TEXT_SECONDARY,
    font: fonts.mono,
    align: 'right',
  });
  drawFittedText(canvas, paint, fonts, {
    text: model.title,
    x: CENTER_X,
    y: 148,
    maxWidth: 1100,
    size: 38,
    minSize: 28,
    color: accent,
    font: fonts.bold,
    align: 'center',
  });

  if (model.lens === 'overview') {
    const items = model.overviewItems.slice(0, 3);
    if (items.length <= 1) {
      drawCover(canvas, paint, images.get(items[0]?.key ?? ''), HERO_X, HERO_Y, HERO_SIZE, HERO_SIZE, accent);
    } else {
      const half = (HERO_SIZE - 6) / 2;
      drawCover(canvas, paint, images.get(items[0]?.key ?? ''), HERO_X, HERO_Y, half, HERO_SIZE, accent);
      drawCover(canvas, paint, images.get(items[1]?.key ?? ''), HERO_X + half + 6, HERO_Y, half, half, accent);
      drawCover(canvas, paint, images.get(items[2]?.key ?? ''), HERO_X + half + 6, HERO_Y + half + 6, half, half, accent);
    }
  } else {
    drawCover(canvas, paint, images.get(model.hero?.key ?? ''), HERO_X, HERO_Y, HERO_SIZE, HERO_SIZE, accent);
  }

  drawFittedText(canvas, paint, fonts, {
    text: model.hero?.title ?? 'YOUR TOP PICKS',
    x: CENTER_X,
    y: 880,
    maxWidth: 1180,
    size: 57,
    minSize: 34,
    color: TEXT,
    font: fonts.bold,
    align: 'center',
  });
  drawFittedText(canvas, paint, fonts, {
    text: model.hero?.subtitle ?? 'TRACK • ALBUM • ARTIST',
    x: CENTER_X,
    y: 940,
    maxWidth: 1120,
    size: 34,
    minSize: 24,
    color: TEXT_SECONDARY,
    font: fonts.regular,
    align: 'center',
  });

  drawFittedText(canvas, paint, fonts, {
    text: model.personalityValue,
    x: CENTER_X - 16,
    y: 1044,
    maxWidth: 210,
    size: 42,
    minSize: 30,
    color: accent,
    font: fonts.semibold,
    align: 'right',
  });
  drawFittedText(canvas, paint, fonts, {
    text: model.personalityText,
    x: CENTER_X,
    y: 1044,
    maxWidth: 630,
    size: 37,
    minSize: 24,
    color: TEXT,
    font: fonts.regular,
  });

  const summaryCenters = [240, 737, 1234];
  model.summaryStats.forEach((stat, index) => {
    drawFittedText(canvas, paint, fonts, {
      text: stat.value,
      x: summaryCenters[index],
      y: 1182,
      maxWidth: 330,
      size: 49,
      minSize: 34,
      color: TEXT,
      font: fonts.semibold,
      align: 'center',
    });
    drawFittedText(canvas, paint, fonts, {
      text: stat.label,
      x: summaryCenters[index],
      y: 1234,
      maxWidth: 340,
      size: 26,
      minSize: 21,
      color: TEXT_SECONDARY,
      font: fonts.mono,
      align: 'center',
    });
  });

  const items =
    model.lens === 'overview' ? model.overviewItems.slice(0, 3) : model.secondaryItems.slice(0, 3);
  drawFittedText(canvas, paint, fonts, {
    text: model.lens === 'overview' ? 'YOUR TOP PICKS' : `NEXT ${model.lens === 'track' ? 'TRACKS' : 'ALBUMS'}`,
    x: CONTENT_LEFT,
    y: 1396,
    maxWidth: 520,
    size: 27,
    minSize: 22,
    color: accent,
    font: fonts.mono,
  });
  drawFittedText(canvas, paint, fonts, {
    text: model.rankingLabel,
    x: CONTENT_RIGHT,
    y: 1396,
    maxWidth: 570,
    size: 27,
    minSize: 20,
    color: TEXT_SECONDARY,
    font: fonts.mono,
    align: 'right',
  });

  items.forEach((item, index) => {
    const y = 1448 + index * 115;
    drawFittedText(canvas, paint, fonts, {
      text: model.lens === 'overview' ? item.kind.toUpperCase() : String(item.rank).padStart(2, '0'),
      x: 134,
      y: y + 57,
      maxWidth: 145,
      size: model.lens === 'overview' ? 18 : 27,
      minSize: 15,
      color: TEXT_SECONDARY,
      font: fonts.mono,
      align: 'center',
    });
    drawCover(canvas, paint, images.get(item.key), 226, y, 92, 92, accent);
    drawFittedText(canvas, paint, fonts, {
      text: item.title,
      x: 356,
      y: y + 43,
      maxWidth: 735,
      size: 42,
      minSize: 28,
      color: TEXT,
      font: fonts.semibold,
    });
    drawFittedText(canvas, paint, fonts, {
      text: item.available ? item.subtitle : `${item.subtitle} • UNAVAILABLE`,
      x: 356,
      y: y + 81,
      maxWidth: 735,
      size: 27,
      minSize: 20,
      color: TEXT_SECONDARY,
      font: fonts.regular,
    });
    drawFittedText(canvas, paint, fonts, {
      text: itemMetric(item, model),
      x: CONTENT_RIGHT,
      y: y + 57,
      maxWidth: 250,
      size: 28,
      minSize: 20,
      color: TEXT_SECONDARY,
      font: fonts.mono,
      align: 'right',
    });
  });

  drawFittedText(canvas, paint, fonts, {
    text: model.rangeLabel,
    x: 64,
    y: 1882,
    maxWidth: 730,
    size: 24,
    minSize: 18,
    color: TEXT_SECONDARY,
    font: fonts.mono,
  });
  drawFittedText(canvas, paint, fonts, {
    text: 'LISTENED LOCALLY WITH',
    x: 1190,
    y: 1882,
    maxWidth: 420,
    size: 22,
    minSize: 17,
    color: TEXT_SECONDARY,
    font: fonts.mono,
    align: 'right',
  });
  setColor(paint, accent);
  canvas.drawCircle(1224, 1872, 18, paint);
  drawFittedText(canvas, paint, fonts, {
    text: 'ASTRA',
    x: 1256,
    y: 1882,
    maxWidth: 170,
    size: 28,
    minSize: 22,
    color: TEXT,
    font: fonts.bold,
  });
}

export async function renderListeningStatsSharePng(
  model: ListeningStatsShareModel,
  options: ListeningStatsShareRenderOptions,
): Promise<string> {
  const [fonts, images] = await Promise.all([
    loadFonts(),
    loadArtwork(options.artworkUris),
  ]);
  const surface = Skia.Surface.MakeOffscreen(
    LISTENING_STATS_SHARE_WIDTH,
    LISTENING_STATS_SHARE_HEIGHT,
  );
  if (!surface) throw new Error('Share-card rendering is unavailable on this device.');
  const paint = Skia.Paint();
  let snapshot: SkImage | null = null;
  try {
    drawCard(
      surface.getCanvas(),
      paint,
      fonts,
      model,
      options.accentColor,
      images,
    );
    surface.flush();
    snapshot = surface.makeImageSnapshot();
    return snapshot.encodeToBase64(ImageFormat.PNG, 100);
  } finally {
    snapshot?.dispose();
    paint.dispose();
    images.forEach((image) => image.dispose());
    fonts.regular.dispose();
    fonts.semibold.dispose();
    fonts.bold.dispose();
    fonts.mono.dispose();
    fonts.typefaces.forEach((typeface) => typeface.dispose());
    fonts.fontData.forEach((data) => data.dispose());
    surface.dispose();
  }
}
