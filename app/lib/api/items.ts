/**
 * Data access lives behind this module, never inside components.
 *
 * Today it resolves from a local fixture so the scaffold has no network
 * dependency. Swapping in `fetch(`${config.apiUrl}/items`)` is a change to this
 * file alone, and these functions become server `loader`s unchanged if the app
 * later moves to SSR.
 */
export type Item = {
  id: string;
  name: string;
  description: string;
};

const items: Item[] = [
  { id: "1", name: "First item", description: "Fetched through app/lib/api." },
  { id: "2", name: "Second item", description: "Components never call fetch directly." },
  { id: "3", name: "Third item", description: "Swap the fixture for a real API here." },
];

export async function listItems(): Promise<Item[]> {
  return items;
}

export async function getItem(id: string): Promise<Item | null> {
  return items.find((item) => item.id === id) ?? null;
}
