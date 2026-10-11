import { hashPassword } from "../utils/password";

const password = process.argv[2];
if (!password) {
  console.error("用法: node packages/server/dist/scripts/hash-password.js <password>");
  process.exit(1);
}

console.log(hashPassword(password));
