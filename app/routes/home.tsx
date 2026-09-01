import { useNavigate } from "react-router";

import type { Route } from "./+types/home";
import { ItemList } from "@/features/items/ItemList";
import { listItems } from "@/lib/api/items";
import { config } from "@/lib/config";
import { seo } from "@/lib/seo";

export function meta() {
  return seo({ title: config.appName, path: "/" });
}

// Runs in Node at build time, so the prerendered HTML ships with the items
// already in it. The trade: this data is frozen until the next deploy. Use
// clientLoader instead for anything user-specific or that must be live.
export async function loader() {
  return { items: await listItems() };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{config.appName}</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Rendered at build time, hydrated as a SPA.
      </p>
      <div className="mt-6">
        <ItemList items={loaderData.items} onOpen={(id) => navigate(`/items/${id}`)} />
      </div>
    </main>
  );
}
