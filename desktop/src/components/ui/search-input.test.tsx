import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { cn } from "@/lib/utils";

import { SearchInput } from "./search-input";

it("renders a labelled pill search field", () => {
  render(<SearchInput aria-label="Search memories" inputClassName="h-7" />);

  const field = screen.getByRole("searchbox", { name: "Search memories" });
  expect(field.className).toContain("rounded-full");
  expect(field.className).toContain("h-7");
  expect(field.className).not.toContain("h-8");
});

it("lets a call site override the shared control radius", () => {
  expect(cn("rounded-control h-8", "rounded-full")).toBe("h-8 rounded-full");
});
