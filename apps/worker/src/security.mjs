export function safeURL(value, allowed) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      u.hostname !== "localhost" &&
      !u.hostname.endsWith(".localhost") &&
      !u.hostname.startsWith("[") &&
      !/^[0-9.]+$/.test(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      allowed
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .includes(u.hostname.toLowerCase())
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function escapeXML(v) {
  return String(v).replace(
    /[<>&"']/g,
    (x) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[x],
  );
}
export async function hash(value) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: new TextEncoder().encode(salt),
          iterations: 600000,
          hash: "SHA-256",
        },
        key,
        256,
      ),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export function constantEqual(a, b) {
  let n = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    n |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return n === 0;
}
