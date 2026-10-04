import type { SVGProps } from "react";
import type { FluentIcon } from "@fluentui/react-icons";
import { Add20Regular, Add20Filled, Archive20Regular, Archive20Filled, ArrowDown20Regular, ArrowDown20Filled, ArrowDownload20Regular, ArrowDownload20Filled, ArrowLeft20Regular, ArrowLeft20Filled, ArrowRedo20Regular, ArrowRedo20Filled, ArrowRight20Regular, ArrowRight20Filled, ArrowUndo20Regular, ArrowUndo20Filled, ArrowUp20Regular, ArrowUp20Filled, ArrowUpload20Regular, ArrowUpload20Filled, Board20Regular, Board20Filled, Book20Regular, Book20Filled, Calendar20Regular, Calendar20Filled, ChatHelp20Regular, ChatHelp20Filled, Checkmark20Regular, Checkmark20Filled, ChevronDown20Regular, ChevronDown20Filled, ChevronRight20Regular, ChevronRight20Filled, Clock20Regular, Clock20Filled, Copy20Regular, Copy20Filled, Dismiss20Regular, Dismiss20Filled, Document20Regular, Document20Filled, Edit20Regular, Edit20Filled, Eye20Regular, Eye20Filled, FullScreenMaximize20Regular, FullScreenMaximize20Filled, Grid20Regular, Grid20Filled, Home20Regular, Home20Filled, Info20Regular, Info20Filled, Library20Regular, Library20Filled, Lightbulb20Regular, Lightbulb20Filled, Link20Regular, Link20Filled, List20Regular, List20Filled, MoreHorizontal20Regular, MoreHorizontal20Filled, Navigation20Regular, Navigation20Filled, People20Regular, People20Filled, Person20Regular, Person20Filled, Play20Regular, Play20Filled, Presenter20Regular, Presenter20Filled, QuestionCircle20Regular, QuestionCircle20Filled, Search20Regular, Search20Filled, Settings20Regular, Settings20Filled, Shield20Regular, Shield20Filled, SignOut20Regular, SignOut20Filled, Sparkle20Regular, Sparkle20Filled, Table20Regular, Table20Filled, TableDeleteColumn20Regular, TableDeleteColumn20Filled, TableDeleteRow20Regular, TableDeleteRow20Filled, TableDismiss20Regular, TableDismiss20Filled, TableInsertColumn20Regular, TableInsertColumn20Filled, TableInsertRow20Regular, TableInsertRow20Filled, TextAlignLeft20Regular, TextAlignLeft20Filled, TextBold20Regular, TextBold20Filled, TextBulletList20Regular, TextBulletList20Filled, TextBulletListSquare20Regular, TextBulletListSquare20Filled, TextItalic20Regular, TextItalic20Filled, TextNumberListLtr20Regular, TextNumberListLtr20Filled, TextQuote20Regular, TextQuote20Filled, TextStrikethrough20Regular, TextStrikethrough20Filled, TextUnderline20Regular, TextUnderline20Filled, Warning20Regular, Warning20Filled, WeatherSunny20Regular, WeatherSunny20Filled } from "@fluentui/react-icons";

/**
 * Fluent System Icons (Microsoft). Each name maps to its Regular and Filled form; Fluent fills the icon of a
 * selected item. Icons are decorative: controls always carry visible text or an aria-label.
 */
const icons = {
  home: [Home20Regular, Home20Filled],
  table: [Table20Regular, Table20Filled],
  tableRowAdd: [TableInsertRow20Regular, TableInsertRow20Filled],
  tableRowDelete: [TableDeleteRow20Regular, TableDeleteRow20Filled],
  tableColumnAdd: [TableInsertColumn20Regular, TableInsertColumn20Filled],
  tableColumnDelete: [TableDeleteColumn20Regular, TableDeleteColumn20Filled],
  tableDelete: [TableDismiss20Regular, TableDismiss20Filled],
  courses: [Book20Regular, Book20Filled],
  library: [Library20Regular, Library20Filled],
  help: [QuestionCircle20Regular, QuestionCircle20Filled],
  search: [Search20Regular, Search20Filled],
  user: [Person20Regular, Person20Filled],
  logout: [SignOut20Regular, SignOut20Filled],
  menu: [Navigation20Regular, Navigation20Filled],
  close: [Dismiss20Regular, Dismiss20Filled],
  back: [ArrowLeft20Regular, ArrowLeft20Filled],
  chevronDown: [ChevronDown20Regular, ChevronDown20Filled],
  chevronRight: [ChevronRight20Regular, ChevronRight20Filled],
  plus: [Add20Regular, Add20Filled],
  more: [MoreHorizontal20Regular, MoreHorizontal20Filled],
  check: [Checkmark20Regular, Checkmark20Filled],
  alert: [Warning20Regular, Warning20Filled],
  info: [Info20Regular, Info20Filled],
  file: [Document20Regular, Document20Filled],
  link: [Link20Regular, Link20Filled],
  text: [TextAlignLeft20Regular, TextAlignLeft20Filled],
  users: [People20Regular, People20Filled],
  calendar: [Calendar20Regular, Calendar20Filled],
  settings: [Settings20Regular, Settings20Filled],
  overview: [Board20Regular, Board20Filled],
  content: [TextBulletListSquare20Regular, TextBulletListSquare20Filled],
  eye: [Eye20Regular, Eye20Filled],
  up: [ArrowUp20Regular, ArrowUp20Filled],
  down: [ArrowDown20Regular, ArrowDown20Filled],
  copy: [Copy20Regular, Copy20Filled],
  archive: [Archive20Regular, Archive20Filled],
  edit: [Edit20Regular, Edit20Filled],
  question: [ChatHelp20Regular, ChatHelp20Filled],
  arrowRight: [ArrowRight20Regular, ArrowRight20Filled],
  arrowLeft: [ArrowLeft20Regular, ArrowLeft20Filled],
  upload: [ArrowUpload20Regular, ArrowUpload20Filled],
  download: [ArrowDownload20Regular, ArrowDownload20Filled],
  grid: [Grid20Regular, Grid20Filled],
  list: [List20Regular, List20Filled],
  clock: [Clock20Regular, Clock20Filled],
  spark: [Lightbulb20Regular, Lightbulb20Filled],
  shield: [Shield20Regular, Shield20Filled],
  bold: [TextBold20Regular, TextBold20Filled],
  italic: [TextItalic20Regular, TextItalic20Filled],
  underline: [TextUnderline20Regular, TextUnderline20Filled],
  strike: [TextStrikethrough20Regular, TextStrikethrough20Filled],
  listBullet: [TextBulletList20Regular, TextBulletList20Filled],
  listOrdered: [TextNumberListLtr20Regular, TextNumberListLtr20Filled],
  quote: [TextQuote20Regular, TextQuote20Filled],
  undo: [ArrowUndo20Regular, ArrowUndo20Filled],
  redo: [ArrowRedo20Regular, ArrowRedo20Filled],
  sparkles: [Sparkle20Regular, Sparkle20Filled],
  play: [Play20Regular, Play20Filled],
  present: [Presenter20Regular, Presenter20Filled],
  expand: [FullScreenMaximize20Regular, FullScreenMaximize20Filled],
  sun: [WeatherSunny20Regular, WeatherSunny20Filled],
} satisfies Record<string, [FluentIcon, FluentIcon]>;
export type IconName = keyof typeof icons;

export function Icon({ name, size = 20, filled = false, className, ...props }: { name: IconName; size?: number; filled?: boolean } & Omit<SVGProps<SVGSVGElement>, "ref">) {
  const Glyph = icons[name][filled ? 1 : 0];
  return <Glyph aria-hidden="true" focusable="false" width={size} height={size} className={`icon${className ? ` ${className}` : ""}`} {...props}/>;
}
