import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ItemList } from "./ItemList";
import type { Item } from "@/lib/api/items";

const items: Item[] = [
  { id: "1", name: "First", description: "One" },
  { id: "2", name: "Second", description: "Two" },
];

describe("ItemList", () => {
  it("renders every item", () => {
    render(<ItemList items={items} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("renders an empty state", () => {
    render(<ItemList items={[]} />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("reports the opened item id", async () => {
    const onOpen = vi.fn();
    render(<ItemList items={items} onOpen={onOpen} />);

    await userEvent.click(screen.getAllByRole("button", { name: "Open" })[1]);

    expect(onOpen).toHaveBeenCalledWith("2");
  });
});
