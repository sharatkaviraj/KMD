import {
  Activity, Archive, ArrowLeftRight, ArrowRight, ArrowUp, Award, Bell, BookOpen, Briefcase,
  Building2, Bus, Cake, Calendar, CalendarCheck, CalendarMinus, Camera, ChartColumn, ChartPie,
  Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsLeft,
  ChevronsRight, CircleCheck, CircleHelp, ClipboardList, Clock, Cloud, Coffee, Copy, Database,
  Delete, DoorOpen, Download, Ellipsis, Eye, EyeOff, File, FileText, Filter, Flag, FlaskConical,
  Gift, Globe, GraduationCap, Hash, Heart, History, House, Image, Inbox, IndianRupee, Info, Key,
  Keyboard, Landmark, Layers, LayoutGrid, Link, List, Lock, LogOut, Mail, MapPin, Megaphone,
  MessageCircle, Mic, Minus, Moon, NotebookPen, PenLine, Percent, Phone, Pin, Plus, Printer,
  Receipt, RefreshCw, Search, Send, Settings, Shield, SlidersVertical, Smile, Star, Sun, Table,
  Tag, Trash2, TrendingUp, TriangleAlert, Type, Undo2, Upload, User, UserPlus, Users, WifiOff, X,
  Zap, createLucideIcon, type LucideIcon,
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
  rupee: IndianRupee, receipt: Receipt, file: File, fileText: FileText, calCheck: CalendarCheck,
  calendar: Calendar, clock: Clock, swap: ArrowLeftRight, phone: Phone, message: MessageCircle,
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
  calMinus: CalendarMinus, eyeRole: Eye,
  // The design's own note mark (AcadHome's "Notes needing action"): a pen and two short lines.
  notePen: createLucideIcon("note-pen", [["path", { d: "M12 20h9", key: "a" }], ["path", { d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z", key: "b" }], ["path", { d: "M4 4h8M4 8h5", key: "c" }]]),
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
