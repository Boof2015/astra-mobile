import { ScrollView, type ScrollViewProps } from 'react-native';
import { SCREEN_GUTTER } from '@/components/Screen';

interface BleedRailProps extends Omit<ScrollViewProps, 'horizontal'> {
  /**
   * The horizontal padding of whatever this rail sits in. Defaults to the
   * screen gutter, which is right for anything in a screen's main column.
   */
  gutter?: number;
}

/**
 * A horizontal rail that runs to the edges of the scene instead of stopping at
 * the page margins.
 *
 * A rail laid out inside the gutter is clipped by it: tiles scroll into a
 * 16dp strip of nothing on each side, so the row reads as a window cut into
 * the page rather than a shelf that carries on past the screen. Here the
 * scroll frame cancels the gutter with a negative margin and the content pays
 * it back as padding, so the first tile still lines up with the section header
 * above it at rest, the last one comes to rest on the opposite margin, and in
 * between tiles travel all the way off the edge.
 *
 * The parent must be padded *content*, not a padded frame: a vertical scroll
 * view whose own frame is inset clips its children at that frame, and the
 * negative margin has nowhere to go. Put the gutter in the scroll view's
 * `contentContainerStyle` (with `<Screen padded={false}>`), not around it.
 */
export function BleedRail({
  gutter = SCREEN_GUTTER,
  style,
  contentContainerStyle,
  ...rest
}: BleedRailProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      {...rest}
      style={[{ marginHorizontal: -gutter }, style]}
      contentContainerStyle={[{ paddingHorizontal: gutter }, contentContainerStyle]}
    />
  );
}

export default BleedRail;
