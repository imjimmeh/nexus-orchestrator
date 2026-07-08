const RAIL_OFFSET = "pl-0 md:pl-12";
const WIDE_OFFSET = "pl-0 md:pl-64";
const PANEL_OFFSET = "pl-0 md:pl-[288px]"; // 48px rail + 240px scope panel

export function getEffectiveNavExpanded(
  isNavExpanded: boolean,
  isScopePanelOpen: boolean,
): boolean {
  return isNavExpanded && !isScopePanelOpen;
}

export function getContentOffsetClass(
  isNavExpanded: boolean,
  isScopePanelOpen: boolean,
): string {
  if (isScopePanelOpen) {
    return PANEL_OFFSET;
  }
  return getEffectiveNavExpanded(isNavExpanded, isScopePanelOpen)
    ? WIDE_OFFSET
    : RAIL_OFFSET;
}
