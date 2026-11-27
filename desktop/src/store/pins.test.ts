import { beforeEach, describe, expect, it } from "vitest";

import { pinKey, usePins } from "./pins";

const pins = () => usePins.getState();

beforeEach(() => usePins.setState({ pins: [] }));

describe("rail pins", () => {
  it("toggles a pin on and off, keyed by kind and id", () => {
    pins().toggle({ kind: "project", id: "warpforge" });
    pins().toggle({ kind: "smith", id: "warpforge" });
    expect(pins().pins.map(pinKey)).toEqual(["project:warpforge", "smith:warpforge"]);
    pins().toggle({ kind: "project", id: "warpforge" });
    expect(pins().pins.map(pinKey)).toEqual(["smith:warpforge"]);
  });

  it("reorders and drops pins whose target is gone", () => {
    pins().toggle({ kind: "project", id: "a" });
    pins().toggle({ kind: "project", id: "b" });
    pins().toggle({ kind: "channel", id: "c", name: "c" });
    pins().move("channel:c", 0);
    expect(pins().pins.map(pinKey)).toEqual(["channel:c", "project:a", "project:b"]);
    pins().prune((pin) => pin.id !== "a");
    expect(pins().pins.map(pinKey)).toEqual(["channel:c", "project:b"]);
  });
});
