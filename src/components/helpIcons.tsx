import {
  Rocket, FileText, Pencil, Layers, CheckSquare, Wallet, KanbanSquare,
  Share2, FileDown, Settings, Sparkles, HelpCircle,
} from 'lucide-react'
import type { HelpIcon } from '../i18n/helpContent'

const ICONS: Record<HelpIcon, React.ComponentType<{ size?: number }>> = {
  rocket: Rocket,
  fileText: FileText,
  pencil: Pencil,
  layers: Layers,
  checkSquare: CheckSquare,
  wallet: Wallet,
  kanban: KanbanSquare,
  share: Share2,
  fileDown: FileDown,
  settings: Settings,
  sparkles: Sparkles,
  help: HelpCircle,
}

export function HelpGlyph({ name, size = 22 }: { name: HelpIcon; size?: number }) {
  const Icon = ICONS[name] ?? HelpCircle
  return <Icon size={size} />
}
