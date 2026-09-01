import { ItemCard } from "./ItemCard";
import type { Item } from "@/lib/api/items";

export function ItemList({ items, onOpen }: { items: Item[]; onOpen?: (id: string) => void }) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing here yet.</p>;
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.id}>
          <ItemCard item={item} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}
