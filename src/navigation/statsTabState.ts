/** Stats is Home-owned: it is a hidden route while Home remains visibly selected. */
export function isDisplayedTabFocused(
  routeName: string,
  routeIndex: number,
  activeIndex: number,
  activeRouteName: string | undefined,
): boolean {
  return routeIndex === activeIndex || (routeName === 'index' && activeRouteName === 'stats');
}
