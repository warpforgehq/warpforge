import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RowGutter } from "./RowGutter";

const connector = (container: HTMLElement) =>
  container.querySelector('[data-rail-level="0"]') as HTMLElement;

describe("RowGutter", () => {
  it("lights the open task's own connector all the way to its text", () => {
    const { container } = render(
      <RowGutter depth={1} ancestorLines={[false]} isLast={false} activeLane={0} onActivePath />,
    );
    const lit = connector(container).querySelectorAll<HTMLElement>(".bg-primary");
    expect(lit).toHaveLength(2);
    expect(lit[0].className).toContain("h-1/2");
  });

  it("keeps a passed sibling's horizontal neutral while the branch runs beside it", () => {
    const { container } = render(
      <RowGutter depth={1} ancestorLines={[false]} isLast={false} activeLane={0} />,
    );
    const lit = connector(container).querySelectorAll(".bg-primary");
    expect(lit).toHaveLength(1);
    expect((lit[0] as HTMLElement).className).toContain("inset-y-0");
  });
});
