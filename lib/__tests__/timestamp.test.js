import { describe, it, expect } from "vitest";
import { parseTimestampName } from "../timestamp.js";

describe("parseTimestampName", () => {
  it("parses mm-ss with dash", () => {
    expect(parseTimestampName("0-03.png")).toBe(3);
    expect(parseTimestampName("1-20.jpg")).toBe(80);
  });
  it("parses mm_ss with underscore", () => {
    expect(parseTimestampName("2_05.webp")).toBe(125);
  });
  it("parses hh-mm-ss", () => {
    expect(parseTimestampName("1-02-05.png")).toBe(3725);
  });
  it("parses mm-ss-mmm with millisecond precision", () => {
    expect(parseTimestampName("00-04-289.png")).toBeCloseTo(4.289, 3);
    expect(parseTimestampName("0-04-289.jpg")).toBeCloseTo(4.289, 3);
    expect(parseTimestampName("1-20-500.webp")).toBeCloseTo(80.5, 3);
    expect(parseTimestampName("00-00-000.png")).toBe(0);
    expect(parseTimestampName("2_05_125.png")).toBeCloseTo(125.125, 3);
  });
  it("parses hh-mm-ss-mmm with millisecond precision", () => {
    expect(parseTimestampName("1-02-05-289.png")).toBeCloseTo(3725.289, 3);
  });
  it("keeps 1-2 digit third part as hh-mm-ss (not ms)", () => {
    expect(parseTimestampName("1-02-05.png")).toBe(3725);
    expect(parseTimestampName("0-04-28.png")).toBe(268); // h:m:s, unchanged
  });
  it("parses ms even with a Flow download datetime stamp appended", () => {
    expect(parseTimestampName("00-04-289_202608272310.png")).toBeCloseTo(4.289, 3);
  });
  it("parses 4-digit mmss", () => {
    expect(parseTimestampName("0003.png")).toBe(3);
    expect(parseTimestampName("0120.png")).toBe(80);
  });
  it("parses 3-digit mmss", () => {
    expect(parseTimestampName("120.png")).toBe(80);
  });
  it("parses 1-2 digit plain seconds", () => {
    expect(parseTimestampName("3.png")).toBe(3);
    expect(parseTimestampName("45.png")).toBe(45);
  });
  it("strips directories", () => {
    expect(parseTimestampName("imgs/0-09.png")).toBe(9);
  });
  it("reads a leading timecode through stacked/embedded extensions", () => {
    expect(parseTimestampName("0-00.png_213412342134.jpeg.mp4")).toBe(0);
    expect(parseTimestampName("1-33.png_202608280131.jpeg")).toBe(93);
    expect(parseTimestampName("0-05.jpg.mp4")).toBe(5);
  });
  it("strips Flow download datetime stamp after the timecode", () => {
    expect(parseTimestampName("10-24_202608272310.png")).toBe(624);
    expect(parseTimestampName("0-03_202608272310.jpg")).toBe(3);
    expect(parseTimestampName("1-02-05_20260827231059.png")).toBe(3725);
    expect(parseTimestampName("2_05-202608272310.webp")).toBe(125);
  });
  it("returns null for unparseable names", () => {
    expect(parseTimestampName("hero.png")).toBeNull();
    expect(parseTimestampName("scene_a.png")).toBeNull();
    expect(parseTimestampName("")).toBeNull();
  });
});
