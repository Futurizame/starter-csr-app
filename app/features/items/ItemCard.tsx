import { Card } from "@/components/ui/Card";
import type { Item } from "@/lib/api/items";

/**
 * Takes the navigation callback as a prop rather than importing the router,
 * which is what keeps this component portable. See eslint.config.js.
 */
export function ItemCard({ item, onOpen }: { item: Item; onOpen?: (id: string) => void }) {
  return (
    <Card>
      <h2 className="font-medium">{item.name}</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{item.description}</p>
      {onOpen && (
        <button
          className="mt-3 text-sm underline underline-offset-4"
          onClick={() => onOpen(item.id)}
        >
          Open
        </button>
      )}
    </Card>
  );
}
