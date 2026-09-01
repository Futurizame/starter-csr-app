import { afterEach, describe, expect, it, vi } from "vitest";

import { readStored, removeStored, writeStored } from "./storage";

const codec = {
  parse: (raw: unknown) => (typeof raw === "string" ? raw : null),
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("storage", () => {
  it("round-trips a value", () => {
    writeStored("key", "value");
    expect(readStored("key", codec, "fallback")).toBe("value");
  });

  it("falls back when the key is missing", () => {
    expect(readStored("missing", codec, "fallback")).toBe("fallback");
  });

  it("falls back when the stored value fails to parse", () => {
    localStorage.setItem("key", "{not json");
    expect(readStored("key", codec, "fallback")).toBe("fallback");
  });

  it("falls back when the stored value has the wrong shape", () => {
    writeStored("key", 42);
    expect(readStored("key", codec, "fallback")).toBe("fallback");
  });

  it("does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeStored("key", "value")).not.toThrow();
    expect(() => removeStored("key")).not.toThrow();
  });
});
