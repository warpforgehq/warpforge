import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "./tabs";

function renderTriggers(props: { variant?: "pill" } = {}) {
  render(
    <Tabs defaultValue="one">
      <TabsList aria-label="Sections">
        <TabsTrigger value="one" {...props}>
          One
        </TabsTrigger>
        <TabsTrigger value="two" {...props}>
          Two
        </TabsTrigger>
      </TabsList>
    </Tabs>,
  );
  return screen.getAllByRole("tab");
}

describe("TabsTrigger", () => {
  it("defaults to the underline treatment", () => {
    const [first] = renderTriggers();
    expect(first.className).toContain("border-b-2");
    expect(first.className).toContain("data-[state=active]:border-primary");
    expect(first.className).not.toContain("shadow-sm");
  });

  it("keeps the pill as an explicit variant", () => {
    const [first] = renderTriggers({ variant: "pill" });
    expect(first.className).toContain("rounded-md");
    expect(first.className).toContain("data-[state=active]:shadow-sm");
    expect(first.className).not.toContain("border-b-2");
  });

  it("carries the standalone focus ring in both shapes", () => {
    for (const trigger of renderTriggers()) {
      expect(trigger.className).toContain("focus-visible:ring-2");
      expect(trigger.className).toContain("focus-visible:ring-offset-1");
    }
  });
});
