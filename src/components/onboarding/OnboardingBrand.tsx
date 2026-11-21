import { StyleSheet } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

/*
 * The Astra mark and wordmark for the wizard's bookends. Same paths as
 * AstraLogo (mark) and assets/branding/astra-full.svg (letters), but each SVG is
 * cropped to its glyphs. AstraLogo's 1024 canvas carries ~28% empty margin under
 * the mark, which made every gap around it look wrong on the welcome page.
 */

const MARK_TRANSFORM = 'matrix(1.726813,0,0,1.726813,-660.505902,-397.11951)';
const MARK_LEFT =
  'M526.083,500.65C529.86,496.662 535.112,494.402 540.605,494.402C553.071,494.402 576.056,494.402 588.831,494.402C594.652,494.402 600.185,496.939 603.984,501.35C610.054,508.396 619.61,519.49 627.207,528.31C633.905,536.085 633.631,547.668 626.573,555.117C603.295,579.689 553.937,631.788 536.916,649.755C533.139,653.742 527.889,656 522.397,656L452,656C440.954,656 432,647.046 432,636C432,626.32 432,615.247 432,607.967C432,602.851 433.96,597.93 437.478,594.215C454.783,575.942 508.184,519.551 526.083,500.65Z';
const MARK_RIGHT =
  'M580,389.237C580,378.578 588.641,369.937 599.3,369.937C625.097,369.937 669.782,369.937 688.899,369.937C694.682,369.937 700.183,372.436 703.987,376.792C736.676,414.222 893.163,593.401 921.571,625.929C924.427,629.198 926,633.392 926,637.733C926,637.733 926,637.734 926,637.734C926,648.379 917.371,657.008 906.726,657.008L817.1,657.008C811.318,657.008 805.817,654.51 802.013,650.155C769.332,612.742 612.909,433.673 584.448,401.092C581.58,397.809 580,393.598 580,389.239C580,389.238 580,389.237 580,389.237Z';
/** The mark's own bounds inside the 1024 canvas (85.4–938.5 × 241.7–737.4). */
const MARK_VIEWBOX = { x: 85, y: 241, width: 854, height: 497 };

const LETTERS_TRANSFORM = 'matrix(0.332785,0,0,0.332785,477.937823,233.800469)';
const LETTER_A =
  'M152,100L236,100C322,100 392,168 392,254L392,424L296,424L296,256C296,216 268,188 228,188L160,188C120,188 92,216 92,256L92,268C92,308 120,334 160,334L264,334L264,424L152,424C66,424 0,358 0,272L0,252C0,168 68,100 152,100Z';
const LETTERS: { x: number; d: string }[] = [
  { x: -73, d: LETTER_A },
  {
    x: 347,
    d: 'M105,100L291,100L291,184L115,184C103,184 96,191 96,202C96,213 103,220 115,220L199,220C272,220 318,259 318,321L318,324C318,382 274,424 209,424L14,424L14,340L201,340C215,340 224,333 224,322C224,311 215,304 201,304L113,304C44,304 0,265 0,204L0,200C0,144 44,100 105,100Z',
  },
  { x: 693, d: 'M0,0L96,0L96,100L236,100L236,190L96,190L96,271C96,313 117,334 157,334L236,334L236,424L153,424C58,424 0,373 0,269L0,0Z' },
  { x: 965, d: 'M0,424L0,260C0,172 70,100 158,100L238,100L238,190L161,190C122,190 96,218 96,260L96,424L0,424Z' },
  { x: 1207, d: LETTER_A },
];
/** The letters' bounds in astra-full.svg's coordinate space. */
const WORDMARK_VIEWBOX = { x: 453.5, y: 244, width: 557, height: 142 };

export function HeroMark({ height, color }: { height: number; color: string }) {
  const width = (height * MARK_VIEWBOX.width) / MARK_VIEWBOX.height;
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`${MARK_VIEWBOX.x} ${MARK_VIEWBOX.y} ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <G transform={MARK_TRANSFORM}>
        <Path d={MARK_LEFT} fill={color} />
        <Path d={MARK_RIGHT} fill={color} />
      </G>
    </Svg>
  );
}

export function Wordmark({ height, color }: { height: number; color: string }) {
  const width = (height * WORDMARK_VIEWBOX.width) / WORDMARK_VIEWBOX.height;
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`${WORDMARK_VIEWBOX.x} ${WORDMARK_VIEWBOX.y} ${WORDMARK_VIEWBOX.width} ${WORDMARK_VIEWBOX.height}`}
      accessibilityRole="image"
      accessibilityLabel="Astra"
    >
      <G transform={LETTERS_TRANSFORM}>
        {LETTERS.map((letter) => (
          <Path key={letter.x} transform={`translate(${letter.x},32)`} d={letter.d} fill={color} />
        ))}
      </G>
    </Svg>
  );
}

/**
 * The bookends' background: the mark's two strokes, enlarged and cropped off the
 * bottom-right corner, in two flat accent tints. Anchored to that corner by
 * fractions of its own size so every window shape crops it the same way.
 * Draw-only: it sits behind everything and can't take touches or move layout.
 */
export function MarkBackdrop({ size, near, far }: { size: number; near: string; far: string }) {
  return (
    <Svg
      pointerEvents="none"
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      style={[styles.backdrop, { right: -0.5 * size, bottom: -0.458 * size }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <G transform={MARK_TRANSFORM}>
        <Path d={MARK_LEFT} fill={near} />
        <Path d={MARK_RIGHT} fill={far} />
      </G>
    </Svg>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
  },
});
