import { describe, it, expect } from "vitest";
import {
  h264LevelFor,
  h264CodecCandidates,
  fitWithin,
  renderSizeCandidates,
} from "../h264.js";

describe("h264LevelFor", () => {
  it("uses Level 4.0 for 1080p30 (the long-standing default)", () => {
    expect(h264LevelFor(1920, 1080, 30)).toBe("28");
  });

  it("raises to Level 4.2 for 1080p60", () => {
    expect(h264LevelFor(1920, 1080, 60)).toBe("2a");
  });

  it("raises to Level 5.1 for 4K30 — the case that failed with 0x28", () => {
    // 3840x2160 has a coded area well above Level 4.0's ceiling; this must NOT
    // resolve to 4.0, which is exactly the bug users reported.
    expect(h264LevelFor(3840, 2160, 30)).toBe("33");
  });

  it("raises to Level 5.2 for 4K60 (and tall-portrait 4K60)", () => {
    expect(h264LevelFor(3840, 2160, 60)).toBe("34");
    expect(h264LevelFor(2160, 3840, 60)).toBe("34");
  });

  it("uses Level 3.1 for 720p30", () => {
    expect(h264LevelFor(1280, 720, 30)).toBe("1f");
  });
});

describe("h264CodecCandidates", () => {
  it("never offers a Level-4.0 string for a 4K frame", () => {
    const candidates = h264CodecCandidates(3840, 2160, 30);
    expect(candidates.every((c) => !c.endsWith("0028"))).toBe(true);
  });

  it("puts the correctly-leveled High-profile codec first", () => {
    expect(h264CodecCandidates(1920, 1080, 30)[0]).toBe("avc1.640028");
    expect(h264CodecCandidates(3840, 2160, 30)[0]).toBe("avc1.640033");
  });

  it("offers High, Main and Baseline for the needed level", () => {
    const c = h264CodecCandidates(1920, 1080, 30).slice(0, 3);
    expect(c).toEqual(["avc1.640028", "avc1.4d0028", "avc1.420028"]);
  });
});

describe("fitWithin", () => {
  it("leaves a frame that already fits unchanged (but even)", () => {
    expect(fitWithin(1920, 1080, 3840, 3840)).toEqual({ width: 1920, height: 1080 });
  });

  it("downscales 4K into a 1080 box preserving aspect and evenness", () => {
    expect(fitWithin(3840, 2160, 1920, 1920)).toEqual({ width: 1920, height: 1080 });
  });
});

describe("renderSizeCandidates", () => {
  it("offers 4K first then progressively smaller sizes", () => {
    const sizes = renderSizeCandidates(3840, 2160);
    expect(sizes[0]).toEqual({ width: 3840, height: 2160 });
    expect(sizes).toContainEqual({ width: 1920, height: 1080 });
    expect(sizes[sizes.length - 1].width).toBeLessThan(sizes[0].width);
  });

  it("caps above-4K sources down into the 4K box", () => {
    expect(renderSizeCandidates(7680, 4320)[0]).toEqual({ width: 3840, height: 2160 });
  });

  it("handles tall-portrait 4K", () => {
    const sizes = renderSizeCandidates(2160, 3840);
    expect(sizes[0]).toEqual({ width: 2160, height: 3840 });
  });
});
