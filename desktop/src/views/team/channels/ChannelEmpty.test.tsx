import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChannelEmpty } from "./ChannelEmpty";

describe("ChannelEmpty", () => {
  it("invites a first post with three starts", async () => {
    const onPrefill = vi.fn<(text: string) => void>();
    const onStartSession = vi.fn<() => void>();
    render(
      <ul>
        <ChannelEmpty
          name="ci"
          general={false}
          smithName="Ada"
          onPrefill={onPrefill}
          onStartSession={onStartSession}
        />
      </ul>,
    );
    expect(screen.getByRole("heading", { name: "Start #ci" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Ada/ }));
    expect(onPrefill).toHaveBeenCalledWith("@Ada ");
    await userEvent.click(screen.getByRole("button", { name: /Post an update/ }));
    expect(onPrefill).toHaveBeenCalledWith("Update: ");
    await userEvent.click(screen.getByRole("button", { name: /Start a session/ }));
    expect(onStartSession).toHaveBeenCalled();
  });
});
