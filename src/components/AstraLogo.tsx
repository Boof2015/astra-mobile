import Svg, { G, Path } from 'react-native-svg';
import { colors } from '@/theme';

/**
 * Astra mark — ported from desktop `astraLogoShared.ts` (same viewBox, paths,
 * transforms). The desktop CSS fills `hsl(198 100% 50%)` / `hsl(198 40% 14%)`
 * resolve to the hex tokens in the theme.
 */
const VIEWBOX = '0 0 1024 1024';
const BG_TRANSFORM = 'matrix(0.784074,0,0,0.973384,-34.499234,-27.254753)';
const SHADOW_TRANSFORM = 'matrix(1.726813,0,0,1.726813,-608.701518,-379.851382)';
const SHADOW_LEFT_TRANSFORM = 'matrix(1,0,0,1,-10,3)';
const SHADOW_RIGHT_TRANSFORM = 'matrix(1,0,0,1,0,3)';
const MAIN_TRANSFORM = 'matrix(1.726813,0,0,1.726813,-660.505902,-397.11951)';

const BG_PATH =
  'M1286.23,28C1321.449,28 1350,50.998 1350,79.367L1350,1028.633C1350,1057.002 1321.449,1080 1286.23,1080L107.77,1080C72.551,1080 44,1057.002 44,1028.633L44,79.367C44,50.998 72.551,28 107.77,28L1286.23,28Z';
const LEFT_PATH =
  'M526.083,500.65C529.86,496.662 535.112,494.402 540.605,494.402C553.071,494.402 576.056,494.402 588.831,494.402C594.652,494.402 600.185,496.939 603.984,501.35C610.054,508.396 619.61,519.49 627.207,528.31C633.905,536.085 633.631,547.668 626.573,555.117C603.295,579.689 553.937,631.788 536.916,649.755C533.139,653.742 527.889,656 522.397,656L452,656C440.954,656 432,647.046 432,636C432,626.32 432,615.247 432,607.967C432,602.851 433.96,597.93 437.478,594.215C454.783,575.942 508.184,519.551 526.083,500.65Z';
const RIGHT_PATH =
  'M580,389.237C580,378.578 588.641,369.937 599.3,369.937C625.097,369.937 669.782,369.937 688.899,369.937C694.682,369.937 700.183,372.436 703.987,376.792C736.676,414.222 893.163,593.401 921.571,625.929C924.427,629.198 926,633.392 926,637.733C926,637.733 926,637.734 926,637.734C926,648.379 917.371,657.008 906.726,657.008L817.1,657.008C811.318,657.008 805.817,654.51 802.013,650.155C769.332,612.742 612.909,433.673 584.448,401.092C581.58,397.809 580,393.598 580,389.239C580,389.238 580,389.237 580,389.237Z';

interface AstraLogoProps {
  size?: number;
  color?: string;
  includeBackground?: boolean;
}

export function AstraLogo({
  size = 28,
  color = colors.logoMain,
  includeBackground = false,
}: AstraLogoProps) {
  return (
    <Svg width={size} height={size} viewBox={VIEWBOX} fill="none">
      {includeBackground && (
        <G transform={BG_TRANSFORM}>
          <Path d={BG_PATH} fill={colors.logoBackdrop} />
        </G>
      )}
      <G transform={SHADOW_TRANSFORM}>
        <G transform={SHADOW_LEFT_TRANSFORM}>
          <Path d={LEFT_PATH} fill={colors.logoShadow} />
        </G>
        <G transform={SHADOW_RIGHT_TRANSFORM}>
          <Path d={RIGHT_PATH} fill={colors.logoShadow} />
        </G>
      </G>
      <G transform={MAIN_TRANSFORM}>
        <Path d={LEFT_PATH} fill={color} />
        <Path d={RIGHT_PATH} fill={color} />
      </G>
    </Svg>
  );
}

export default AstraLogo;
