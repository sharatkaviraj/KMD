import {
  Activity, Archive, ArrowDown, ArrowRight, ArrowUp, Award, Bell, BookOpen, Briefcase,
  Building2, Bus, Cake, Calendar, CalendarCheck, CalendarMinus, Camera, ChartColumn, ChartPie,
  Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsLeft,
  ChevronsRight, CircleCheck, CircleHelp, ClipboardList, Clock, Cloud, Coffee, Copy, Database,
  Delete, DoorOpen, Download, Ellipsis, Eye, EyeOff, File, FileText, Filter, Flag, FlaskConical,
  Gift, Globe, GraduationCap, Hash, Heart, History, House, Image, Inbox, IndianRupee, Info, Key,
  Keyboard, Landmark, Layers, LayoutGrid, Link, List, Lock, LogOut, Mail, MapPin, Megaphone,
  MessageCircle, Mic, Minus, Moon, NotebookPen, PenLine, Percent, Phone, Pin, Plus, Printer,
  Repeat, RefreshCw, Search, Send, Settings, Shield, SlidersVertical, Smile, Star, Sun, Table,
  Tag, Trash2, TrendingUp, TriangleAlert, Type, Undo2, Upload, User, UserPlus, Users, WifiOff, X,
  Zap, type LucideIcon,
} from "lucide-react";

/**
 * The design's icon names (`design/shared/icons.js`, `IC.<name>`) mapped to
 * lucide-react, exactly as DESIGN-SYSTEM.md §6 lists them. Screens name icons
 * by these strings, which — unlike a component reference — can cross from a
 * Server Component into a Client Component.
 */
export const ICONS = {
  search: Search, chevRight: ChevronRight, chevLeft: ChevronLeft, chevDown: ChevronDown,
  chevUp: ChevronUp, chevsLeft: ChevronsLeft, chevsRight: ChevronsRight, arrowUp: ArrowUp,
  arrowRight: ArrowRight, x: X, plus: Plus, minus: Minus, check: Check, checkCircle: CircleCheck,
  home: House, users: Users, user: User, userPlus: UserPlus, inbox: Inbox, grid: LayoutGrid,
  // The design draws a receipt as a document and a swap as two looped arrows.
  rupee: IndianRupee, receipt: FileText, file: File, fileText: FileText, calCheck: CalendarCheck,
  calendar: Calendar, clock: Clock, swap: Repeat, phone: Phone, message: MessageCircle,
  megaphone: Megaphone, send: Send, bell: Bell, edit: PenLine, trash: Trash2, more: Ellipsis,
  alert: TriangleAlert, info: Info, help: CircleHelp, shield: Shield, lock: Lock, key: Key,
  eye: Eye, eyeOff: EyeOff, mail: Mail, printer: Printer, download: Download, upload: Upload,
  copy: Copy, link: Link, image: Image, filter: Filter, sliders: SlidersVertical,
  settings: Settings, chart: ChartColumn, pie: ChartPie, trend: TrendingUp, bus: Bus,
  book: BookOpen, grad: GraduationCap, clipboard: ClipboardList, archive: Archive,
  database: Database, activity: Activity, globe: Globe, moon: Moon, sun: Sun, logout: LogOut,
  undo: Undo2, refresh: RefreshCw, cloud: Cloud, wifiOff: WifiOff, layers: Layers, list: List,
  table: Table, zap: Zap, award: Award, percent: Percent, tag: Tag, mapPin: MapPin,
  briefcase: Briefcase, star: Star, flag: Flag, hash: Hash, pin: Pin, del: Delete, mic: Mic,
  note: NotebookPen, cake: Cake, bank: Landmark, ticks: CheckCheck, door: DoorOpen,
  camera: Camera, history: History, gift: Gift, building: Building2, text: Type, type: Type,
  flask: FlaskConical, coffee: Coffee, heart: Heart, smile: Smile, keyboard: Keyboard,
  calMinus: CalendarMinus, eyeRole: Eye, arrowDown: ArrowDown,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Ic({
  n,
  size = 18,
  stroke = 2,
  className,
  style,
}: {
  n: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Cmp = ICONS[n] ?? LayoutGrid;
  return (
    <Cmp
      aria-hidden="true"
      width={size}
      height={size}
      strokeWidth={stroke}
      className={className}
      style={{ flex: "none", ...style }}
    />
  );
}
