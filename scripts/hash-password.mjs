// Prints an scrypt hash for LORE_ADMIN_USERS / LORE_ADMIN_PASSWORD, so plain
// passwords need not sit in compose files:  node scripts/hash-password.mjs 's3cret'
import { randomBytes, scryptSync } from "node:crypto";

const pw = process.argv[2];
if (!pw) {
  console.error("usage: node scripts/hash-password.mjs <password>");
  process.exit(2);
}
const salt = randomBytes(16);
console.log(`scrypt$${salt.toString("hex")}$${scryptSync(pw, salt, 32).toString("hex")}`);
