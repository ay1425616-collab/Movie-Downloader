import { writeFileSync } from "node:fs";
import { passwordHash } from "../apps/worker/src/security.mjs";
const password = crypto.randomUUID() + crypto.randomUUID(),
  salt = crypto.randomUUID(),
  email = "integration-test@example.invalid";
writeFileSync(
  "/tmp/cinewave-test-credentials.json",
  JSON.stringify({ email, password }),
  { mode: 0o600 },
);
writeFileSync(
  "/tmp/cinewave-test-admin.sql",
  `INSERT OR REPLACE INTO admins(id,email,password_hash,salt,role) VALUES ('integration-test','${email}','${await passwordHash(password, salt)}','${salt}','owner');`,
  { mode: 0o600 },
);

// Local test helper only: editor shares this generated ephemeral test password.
writeFileSync(
  "/tmp/cinewave-test-admin.sql",
  `DELETE FROM auth_attempts; INSERT OR REPLACE INTO admins(id,email,password_hash,salt,role) VALUES ('integration-editor','integration-editor@example.invalid','${await passwordHash(password, salt)}','${salt}','editor');`,
  { flag: "a", mode: 0o600 },
);
