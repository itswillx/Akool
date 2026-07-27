// Shared UI primitives of the finance module. Extracted from FinancePanel so
// submodules (works/obras) reuse the same modal, drawer and design tokens
// instead of duplicating them.
export { Modal } from './Modal'
export { Drawer } from './Drawer'
export { EmojiInput } from './EmojiInput'
export { FinanceMobileContext, useFinanceMobile, MOBILE_NAV_HEIGHT } from './mobileContext'
export {
  inputStyle,
  labelStyle,
  tabularNums,
  segTrackStyle,
  segBtnStyle,
  primaryBtnStyle,
  ghostBtnStyle,
  cardSurfaceStyle,
  sectionCaptionStyle,
  FIN_ACCENT,
  FIN_ACCENT_TEXT,
  FIN_POS,
  FIN_NEG,
  FIN_POS_SOFT,
  FIN_NEG_SOFT,
  FIN_WARN,
} from './tokens'
