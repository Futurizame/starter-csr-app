import type { ReactNode } from "react";

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">{children}</div>
  );
}
