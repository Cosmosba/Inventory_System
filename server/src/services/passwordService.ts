import { hash, verify, argon2id } from "argon2";
import type { HashOptions } from "argon2";

const ARGON2_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  plaintext: string
): Promise<boolean> {
  return verify(storedHash, plaintext);
}
