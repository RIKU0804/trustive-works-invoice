"use client";

import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Building2,
  FileSpreadsheet,
  FileUp,
  NotebookText,
  Settings,
  Users,
  Calendar,
  Search,
} from "lucide-react";

export interface MonthEntry {
  value: string;
  label: string;
}

const FEATURES = [
  { value: "/dashboard", label: "ダッシュボード", icon: BarChart3 },
  { value: "/properties", label: "邸一覧", icon: Building2 },
  { value: "/upload", label: "PDFアップロード", icon: FileUp },
  { value: "/memos", label: "月次メモ", icon: NotebookText },
  { value: "/export", label: "Excel出力", icon: FileSpreadsheet },
  { value: "/settings/staff", label: "担当者マスタ", icon: Users },
  { value: "/settings/users", label: "ユーザー管理", icon: Settings },
];

export function CommandPalette({ months }: { months: MonthEntry[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/30 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white border shadow-2xl overflow-hidden"
      >
        <Command label="コマンドパレット" loop>
          <div className="flex items-center border-b px-3 gap-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Command.Input
              autoFocus
              placeholder="月や機能を検索（例: 2025-08、エクセル、担当者）"
              className="flex-1 py-3 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            />
            <kbd className="text-[10px] text-muted-foreground bg-gray-100 rounded px-1.5 py-0.5 border">
              Esc
            </kbd>
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              一致する項目がありません
            </Command.Empty>

            {months.length > 0 && (
              <Command.Group heading="月を開く" className="mb-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide px-2 py-1">
                  月詳細にジャンプ
                </div>
                {months.map((m) => (
                  <Command.Item
                    key={m.value}
                    value={`月 ${m.label} ${m.value}`}
                    onSelect={() => go(`/month/${m.value}`)}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer aria-selected:bg-primary/10 aria-selected:text-primary"
                  >
                    <Calendar className="w-4 h-4" />
                    {m.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="機能">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide px-2 py-1 mt-2">
                機能
              </div>
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <Command.Item
                    key={f.value}
                    value={`機能 ${f.label} ${f.value}`}
                    onSelect={() => go(f.value)}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer aria-selected:bg-primary/10 aria-selected:text-primary"
                  >
                    <Icon className="w-4 h-4" />
                    {f.label}
                  </Command.Item>
                );
              })}
            </Command.Group>
          </Command.List>
          <div className="border-t px-3 py-2 text-[11px] text-muted-foreground flex items-center justify-between">
            <span>↑↓ 移動 / Enter 選択 / Esc 閉じる</span>
            <span>
              <kbd className="bg-gray-100 rounded px-1 py-0.5 border">Ctrl/⌘</kbd>+
              <kbd className="bg-gray-100 rounded px-1 py-0.5 border ml-0.5">K</kbd>
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
