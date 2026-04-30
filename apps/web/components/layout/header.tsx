"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";

type Props = { email?: string };

export function Header({ email }: Props) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header className="h-12 border-b border-border bg-white flex items-center justify-end px-4 gap-3">
      {email && (
        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
          <User className="w-3.5 h-3.5" />
          {email}
        </span>
      )}
      <button
        onClick={handleLogout}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <LogOut className="w-3.5 h-3.5" />
        ログアウト
      </button>
    </header>
  );
}
