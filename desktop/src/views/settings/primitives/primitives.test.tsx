import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { SegmentedControl, SettingsPage, SettingsRow, SettingsSection, Toggle } from ".";

it("renders a row's title, description and control", () => {
  render(
    <SettingsSection title="Alerts">
      <SettingsRow
        id="alert-row"
        title="Task-finished toast"
        description="Show an in-app alert."
        control={<Toggle id="t" label="Task-finished toast" checked onChange={() => {}} />}
      />
    </SettingsSection>,
  );

  const heading = screen.getByRole("heading", { name: "Task-finished toast" });
  expect(heading.closest("#alert-row")).not.toBeNull();
  expect(screen.getByText("Show an in-app alert.")).toBeVisible();
  expect(screen.getByRole("switch", { name: "Task-finished toast" })).toBeChecked();
  expect(screen.getByRole("heading", { name: "Alerts", level: 2 })).toBeVisible();
});

it("titles a page from the settings nav and shows its actions", () => {
  render(
    <SettingsPage page="notifications" actions={<button type="button">Restore defaults</button>}>
      <p>body</p>
    </SettingsPage>,
  );

  expect(screen.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  expect(screen.getByText("Choose which events interrupt you, and how.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Restore defaults" })).toBeVisible();
});

it("reports a new segmented choice and ignores the current one", async () => {
  const onChange = vi.fn<(value: string) => void>();
  render(
    <SegmentedControl
      label="Storage"
      value="a"
      options={[
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ]}
      onChange={onChange}
    />,
  );

  await userEvent.click(screen.getByRole("radio", { name: "A" }));
  expect(onChange).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("radio", { name: "B" }));
  expect(onChange).toHaveBeenCalledWith("b");
  expect(screen.getByRole("radiogroup", { name: "Storage" })).toBeVisible();
});
