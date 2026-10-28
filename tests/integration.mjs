import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8787";
let cookie = "";
let checks = 0;
async function request(path, method = "GET", body, expected = 200) {
  const r = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(
    r.status,
    expected,
    method + " " + path + " " + (await r.clone().text()),
  );
  checks++;
  return r;
}
await request("/api/v1/admin/me", "GET", undefined, 401);
await request(
  "/api/v1/admin/login",
  "POST",
  { email: "wrong@example.invalid", password: "wrong-password-long" },
  401,
);
const credentials = JSON.parse(
  readFileSync("/tmp/cinewave-test-credentials.json", "utf8"),
);
const login = await request("/api/v1/admin/login", "POST", credentials);
cookie = login.headers.get("set-cookie").split(";")[0];
assert.match(login.headers.get("set-cookie"), /HttpOnly/);
assert.match(login.headers.get("set-cookie"), /Secure/);
await request("/api/v1/admin/me");
const m = {
  title: "Integration Fixture",
  slug: "integration-" + Date.now(),
  release_year: 2026,
  status: "draft",
  synopsis: "Test fixture, no authorized media supplied.",
};
const movie = (
  await (await request("/api/v1/admin/movies", "POST", m, 201)).json()
).id;
await request("/api/v1/movies/" + m.slug, "GET", undefined, 404);
await request("/api/v1/admin/movies/" + movie, "PUT", {
  ...m,
  status: "published",
});
await request("/api/v1/movies/" + m.slug);
await request("/" + m.slug + ".html");
const file = (
  await (
    await request(
      "/api/v1/admin/files",
      "POST",
      {
        movie_id: movie,
        resolution: "720p",
        codec: "HEVC",
        bytes: 1024,
        audio: "English",
        format: "mp4",
        enabled: 1,
      },
      201,
    )
  ).json()
).id;
await request("/api/v1/downloads/" + file, "GET", undefined, 404);
await request(
  "/api/v1/admin/mirrors",
  "POST",
  {
    file_id: file,
    label: "Unsafe fixture",
    url: "http://127.0.0.1/private",
    enabled: 1,
  },
  400,
);
await request("/api/v1/admin/movies/" + movie + "/rights", "PUT", {
  status: "verified",
  license: "Fictional integration fixture; no media file.",
  evidence_url: "https://example.org/fixture",
});
const detail = await (await request("/api/v1/movies/" + m.slug)).json();
assert.equal(detail.data.files.length, 1);
await request("/api/v1/downloads/" + file, "GET", undefined, 404);
await request("/api/v1/admin/files/" + file, "PUT", {
  movie_id: movie,
  resolution: "1080p",
  codec: "HEVC",
  bytes: 2048,
  audio: "English",
  format: "mp4",
  enabled: 0,
});
await request("/api/v1/downloads/" + file, "GET", undefined, 404);
await request("/api/v1/search?q=Integration");
await request("/api/v1/categories");
await request("/sitemap.xml");
const csrf = await fetch(base + "/api/v1/admin/logout", {
  method: "POST",
  headers: { Origin: "https://evil.invalid", Cookie: cookie },
});
assert.equal(csrf.status, 403);
checks++;
// Fixture host must be allowlisted only for this local test; no file is fetched.
await request("/api/v1/admin/files/" + file, "PUT", {
  movie_id: movie,
  resolution: "720p",
  codec: "HEVC",
  bytes: 1024,
  audio: "English",
  format: "mp4",
  enabled: 1,
});
const mirror = (
  await (
    await request(
      "/api/v1/admin/mirrors",
      "POST",
      {
        file_id: file,
        label: "Integration fixture only",
        url: "https://downloads.example.invalid/fixture",
        enabled: 0,
      },
      201,
    )
  ).json()
).id;
await request("/api/v1/downloads/" + file, "GET", undefined, 404);
await request("/api/v1/admin/mirrors/" + mirror, "PUT", {
  file_id: file,
  label: "Expired fixture",
  url: "https://downloads.example.invalid/fixture",
  enabled: 1,
  expires_at: 1,
});
await request("/api/v1/downloads/" + file, "GET", undefined, 404);
await request("/api/v1/admin/mirrors/" + mirror, "PUT", {
  file_id: file,
  label: "Fixture",
  url: "https://downloads.example.invalid/fixture",
  enabled: 1,
  expires_at: null,
});
const redirect = await request(
  "/api/v1/downloads/" + file,
  "GET",
  undefined,
  302,
);
assert.equal(
  redirect.headers.get("Location"),
  "https://downloads.example.invalid/fixture",
);
assert.equal(redirect.headers.get("Cache-Control"), "no-store");
const dashboard = await (await request("/api/v1/admin/dashboard")).json();
assert.ok(dashboard.data.download_events >= 1);
await request("/api/v1/admin/movies/" + movie + "/rights", "PUT", {
  status: "revoked",
  license: "Fixture revoked",
  evidence_url: "https://example.org/fixture",
});
await request("/api/v1/downloads/" + file, "GET", undefined, 404);
await request("/api/v1/admin/mirrors/" + mirror, "DELETE");
const editorLogin = await request("/api/v1/admin/login", "POST", {
  ...credentials,
  email: "integration-editor@example.invalid",
});
const ownerCookie = cookie;
cookie = editorLogin.headers.get("set-cookie").split(";")[0];
await request(
  "/api/v1/admin/movies/" + movie + "/rights",
  "PUT",
  {
    status: "verified",
    license: "Not permitted",
    evidence_url: "https://example.org/fixture",
  },
  403,
);
await request("/api/v1/admin/ads/homepage-banner", "PUT", { enabled: 1 }, 403);
await request("/api/v1/admin/logout", "POST", {});
cookie = ownerCookie;
await request("/category/hollywood");
await request("/api/v1/search?q=Integra");
await request("/api/v1/admin/files/" + file, "DELETE");
await request("/api/v1/admin/movies/" + movie, "DELETE");
await request("/api/v1/movies/" + m.slug, "GET", undefined, 404);
await request("/api/v1/admin/logout", "POST", {});
await request("/api/v1/admin/me", "GET", undefined, 401);
console.log(`${checks} HTTP integration assertions passed`);
