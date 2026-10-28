import { describe, it, expect } from "vitest";
import {
  movieSchema,
  fileSchema,
  mirrorSchema,
} from "../apps/worker/src/index";
describe("catalog input validation", () => {
  it("defaults new movies to draft", () =>
    expect(
      movieSchema.parse({
        title: "A Movie",
        slug: "a-movie",
        release_year: 2026,
      }).status,
    ).toBe("draft"));
  it("rejects unsafe slug and non-HTTPS poster", () => {
    expect(
      movieSchema.safeParse({
        title: "A",
        slug: "../admin",
        release_year: 2026,
      }).success,
    ).toBe(false);
    expect(
      movieSchema.safeParse({
        title: "A",
        slug: "a",
        release_year: 2026,
        poster: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });
  it("requires actual file size and supported resolution", () => {
    const f = {
      movie_id: "m",
      resolution: "720p",
      codec: "HEVC",
      bytes: 1024,
      audio: "English",
      format: "mp4",
    };
    expect(fileSchema.safeParse(f).success).toBe(true);
    expect(fileSchema.safeParse({ ...f, bytes: 0 }).success).toBe(false);
    expect(fileSchema.safeParse({ ...f, resolution: "unknown" }).success).toBe(
      false,
    );
  });
  it("requires a complete SHA-256 when supplied", () =>
    expect(
      fileSchema.safeParse({
        movie_id: "m",
        resolution: "720p",
        codec: "HEVC",
        bytes: 1024,
        audio: "English",
        format: "mp4",
        checksum: "fake",
      }).success,
    ).toBe(false));
  it("new mirrors default to disabled", () =>
    expect(
      mirrorSchema.parse({
        file_id: "f",
        label: "Authorized host",
        url: "https://example.org/file",
      }).enabled,
    ).toBe(0));
});
