import {
  AppSheet,
  AppSheetItem,
  AppSheetSection,
  type AppSheetItemProps,
} from '@/components/sheets/AppSheet';

/**
 * EQ-named wrappers around the shared app sheet chrome. Keeping these exports
 * avoids churn in EQ call sites while the same bottom-sheet UX is reused elsewhere.
 */
export const EqSheet = AppSheet;
export const EqSheetSection = AppSheetSection;
export const EqSheetItem = AppSheetItem;
export type EqSheetItemProps = AppSheetItemProps;

export default EqSheet;
