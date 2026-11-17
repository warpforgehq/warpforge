import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PrForm } from "./PrForm";

const noop = () => {};

function renderForm(error: string | null) {
  render(
    <PrForm
      info={null}
      needsPush={false}
      prTitle=""
      setPrTitle={noop}
      prBody=""
      setPrBody={noop}
      prBase=""
      setPrBase={noop}
      generatingPr={false}
      textGenAgentId="claude"
      error={error}
      onGenerate={noop}
    />,
  );
}

describe("PrForm", () => {
  it("shows a failed generate instead of swallowing it", () => {
    renderForm("no commits on this branch to describe");

    expect(screen.getByRole("alert")).toHaveTextContent("no commits on this branch to describe");
  });

  it("shows no alert without an error", () => {
    renderForm(null);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
