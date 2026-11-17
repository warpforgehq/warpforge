import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { HistoryListSkeleton } from "./HistoryListSkeleton";

it("reserves three compact history rows while commits load", () => {
  render(<HistoryListSkeleton />);
  expect(screen.getByRole("status", { name: "Reading commits" })).toBeInTheDocument();
  expect(screen.getAllByTestId("history-list-skeleton-row")).toHaveLength(3);
});
