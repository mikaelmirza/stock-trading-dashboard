import { describe, expect, it } from "vitest";
import { connectionBannerContent } from "./connection-banner-utils";

describe("connectionBannerContent", () => {
  it("shows nothing once connected", () => {
    expect(connectionBannerContent("connected")).toBeNull();
  });

  it("shows a warning-severity Reconnecting… banner while reconnecting", () => {
    expect(connectionBannerContent("reconnecting")).toEqual({
      message: "Reconnecting…",
      severity: "warning",
    });
  });

  it("shows an info-severity connecting banner for the initial connect", () => {
    expect(connectionBannerContent("connecting")).toEqual({
      message: "Connecting to live data…",
      severity: "info",
    });
  });

  it("shows the same connecting banner while disconnected", () => {
    expect(connectionBannerContent("disconnected")).toEqual({
      message: "Connecting to live data…",
      severity: "info",
    });
  });
});
