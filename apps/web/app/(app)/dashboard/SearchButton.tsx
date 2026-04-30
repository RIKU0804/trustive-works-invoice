"use client";

export function SearchButton() {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
      }
      className="hidden md:inline-flex items-center gap-1.5 mr-3 rounded-md border bg-white px-2.5 py-1 text-xs text-muted-foreground hover:bg-gray-50"
    >
      検索 <kbd className="bg-gray-100 rounded px-1 py-0.5 border ml-1">Ctrl+K</kbd>
    </button>
  );
}
