"use client";

import { useRef, useState } from "react";
import { upsertMemo } from "@/app/actions/memo";

interface MemoEditorProps {
  reportMonth: string;
  initialContent: string;
}

export function MemoEditor({ reportMonth, initialContent }: MemoEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    try {
      const data = new FormData(e.currentTarget);
      await upsertMemo(data);
      setIsEditing(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setPending(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="group relative">
        <p className="text-sm text-gray-700 whitespace-pre-wrap min-h-[2rem]">
          {initialContent || <span className="text-muted-foreground italic">メモなし</span>}
        </p>
        <button
          onClick={() => setIsEditing(true)}
          className="mt-2 text-xs text-primary hover:underline"
        >
          編集
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-2">
      <input type="hidden" name="reportMonth" value={reportMonth} />
      <textarea
        name="content"
        defaultValue={initialContent}
        rows={4}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        placeholder="メモを入力してください..."
        autoFocus
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {pending ? "保存中..." : "保存"}
        </button>
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
