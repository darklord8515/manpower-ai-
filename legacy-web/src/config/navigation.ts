import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  BarChart3,
  Building2,
  CalendarRange,
  ClipboardCheck,
  Database,
  FileText,
  LayoutDashboard,
  Lightbulb,
  LogIn,
  LogOut,
  Settings,
  TrendingUp,
  UsersRound,
  Users,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** True only for screens that exist. Everything else reports that it isn't built. */
  built?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navigation: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { id: 'executive', label: 'Executive dashboard', icon: LayoutDashboard, built: true },
      { id: 'projects', label: 'Projects', icon: Building2 },
      { id: 'employees', label: 'Employees', icon: Users },
      { id: 'approvals', label: 'Approvals', icon: ClipboardCheck },
      { id: 'mobilization', label: 'Mobilization', icon: LogIn },
      { id: 'demobilization', label: 'Demobilization', icon: LogOut },
      { id: 'allocation', label: 'Allocation', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Planning',
    items: [
      { id: 'forecast', label: 'Workforce forecast', icon: TrendingUp },
      { id: 'resources', label: 'Resource planning', icon: UsersRound },
      { id: 'schedule', label: 'Project schedule', icon: CalendarRange },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'insights', label: 'Insights', icon: Lightbulb },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'documents', label: 'Documents', icon: FileText },
      { id: 'master-data', label: 'Master data', icon: Database },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];
