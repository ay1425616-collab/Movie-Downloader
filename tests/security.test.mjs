import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeURL,
  escapeXML,
  passwordHash,
  constantEqual,
} from "../apps/worker/src/security.mjs";
test("redirects require exact approved HTTPS host", () => {
  assert.equal(
    safeURL("https://files.example.org/movie.mp4", "files.example.org"),
    "https://files.example.org/movie.mp4",
  );
  for (const url of [
    "http://files.example.org/movie",
    "https://files.example.org.evil.test/movie",
    "https://files.example.org@evil.test/movie",
    "https://127.0.0.1/movie",
    "https://files.example.org:8443/movie",
    "javascript:alert(1)",
    "https://files.example.org/movie#bad",
  ])
    assert.equal(safeURL(url, "files.example.org"), null);
});
test("unconfigured storage fails closed", () =>
  assert.equal(safeURL("https://example.org/movie", ""), null));
test("XML escapes untrusted catalog fields", () =>
  assert.equal(escapeXML("<a&\"'"), "&lt;a&amp;&quot;&apos;"));
test("password hash is salted and verifiable", async () => {
  const a = await passwordHash("long-example-password", "salt-a");
  assert.equal(a.length, 64);
  assert.ok(
    constantEqual(a, await passwordHash("long-example-password", "salt-a")),
  );
  assert.ok(
    !constantEqual(a, await passwordHash("long-example-password", "salt-b")),
  );
  assert.ok(!constantEqual("abc", "abcd"));
});

test("private literal destinations remain denied when misconfigured", () => {
  for (const host of ["127.0.0.1", "169.254.169.254", "localhost", "[::1]"])
    assert.equal(safeURL("https://" + host + "/", host), null);
});
