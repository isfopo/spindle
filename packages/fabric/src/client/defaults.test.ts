import { afterEach, describe, expect, it, vi } from "vitest";
import { startDefaults } from "./defaults";

describe("startDefaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts the hello default by default", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    startDefaults();

    expect(log).toHaveBeenCalledWith("[spindlework] hello world");
  });

  it("supports disabling a default by name", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    startDefaults({ hello: false });

    expect(log).not.toHaveBeenCalled();
  });
});
