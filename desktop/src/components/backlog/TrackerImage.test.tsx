import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";

import { TrackerImage } from "./TrackerImage";

function renderImage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TrackerImage src="https://github.test/a" alt="broken chart" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TrackerImage", () => {
  it("reserves the image's box while the bytes arrive, and never a sentence", () => {
    vi.spyOn(daemon, "trackerAttachment").mockReturnValue(new Promise<never>(() => {}));
    const { container } = renderImage();
    const block = screen.getByTestId("tracker-image-skeleton");

    expect(block).toHaveAttribute("aria-busy", "true");
    // The alt is the announcement the text placeholder used to carry.
    expect(block).toHaveAttribute("role", "status");
    expect(block).toHaveAttribute("aria-label", "broken chart");
    expect(block.className).toContain("aspect-video");
    expect(block.className).toContain("max-w-sm");
    expect(block.className).toContain("rounded-md");
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
  });

  it("keeps the bytes for the session, so reopening never re-shows the placeholder", async () => {
    vi.useFakeTimers();
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      vi.spyOn(daemon, "trackerAttachment").mockResolvedValue({
        contentType: "image/png",
        dataBase64: "AAAA",
      });
      const { unmount } = render(
        <QueryClientProvider client={client}>
          <TrackerImage src="https://github.test/a" alt="chart" />
        </QueryClientProvider>,
      );
      await act(async () => {
        await Promise.resolve();
      });
      const key = ["trackerAttachment", "https://github.test/a"];
      expect(client.getQueryData(key)).toBeDefined();

      unmount();
      // The old one-minute gc window evicted the bytes here; the session-long
      // one keeps them, so a reopen renders straight from cache.
      await act(async () => {
        vi.advanceTimersByTime(10 * 60_000);
        await Promise.resolve();
      });
      expect(client.getQueryData(key)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
