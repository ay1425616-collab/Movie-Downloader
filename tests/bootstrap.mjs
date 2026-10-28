import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const config = JSON.parse(
  readFileSync("/tmp/cinewave-bootstrap-test.json", "utf8"),
);
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8787";
async function post(token) {
  return fetch(base + "/api/v1/admin/bootstrap", {
    method: "POST",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
}
assert.equal((await post("wrong-token")).status, 403);
assert.equal((await post(config.token)).status, 201);
assert.equal((await post(config.token)).status, 409);
const login = await fetch(base + "/api/v1/admin/login", {
  method: "POST",
  headers: { Origin: base, "Content-Type": "application/json" },
  body: JSON.stringify({ email: config.email, password: config.password }),
});
assert.equal(login.status, 200);
console.log("4 bootstrap HTTP assertions passed");
