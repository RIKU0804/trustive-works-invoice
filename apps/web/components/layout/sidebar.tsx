"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  FileSpreadsheet,
  FileUp,
  NotebookText,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "ダッシュボード", icon: <BarChart3 className="w-4 h-4" /> },
  { href: "/properties", label: "邸一覧", icon: <Building2 className="w-4 h-4" /> },
  { href: "/upload", label: "アップロード", icon: <FileUp className="w-4 h-4" /> },
  { href: "/memos", label: "月次メモ", icon: <NotebookText className="w-4 h-4" /> },
  { href: "/export", label: "Excel出力", icon: <FileSpreadsheet className="w-4 h-4" /> },
];

const settingsItems: NavItem[] = [
  { href: "/settings/staff", label: "担当者マスタ", icon: <Users className="w-4 h-4" />, adminOnly: true },
  { href: "/settings/users", label: "ユーザー管理", icon: <Settings className="w-4 h-4" />, adminOnly: true },
];

type Props = { isAdmin?: boolean; unassignedCount?: number };

export function Sidebar({ isAdmin = false, unassignedCount = 0 }: Props) {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-border flex flex-col h-screen sticky top-0">
      <div className="px-4 py-5 border-b border-border">
        <div className="text-sm font-bold text-primary leading-tight">支払通知集計</div>
        <div className="text-xs text-muted-foreground mt-0.5">双建工業株式会社</div>
      </div>

      {unassignedCount > 0 && (
        <div className="mx-3 my-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs">
          <div className="text-amber-900 font-medium">⚠️ 未割当</div>
          <div className="text-amber-700 mt-0.5">
            <span className="text-base font-bold">{unassignedCount}</span> 邸
          </div>
        </div>
      )}

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}

        {isAdmin && (
          <>
            <div className="pt-3 pb-1 px-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">設定</span>
            </div>
            {settingsItems.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-gray-50 hover:text-foreground"
      )}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}
