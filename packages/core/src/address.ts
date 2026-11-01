// Written with AI help.
// Address normalisation (CLAUDE.md §3 item 1): EVM addresses on eip155 networks are compared
// case-insensitively and stored EIP-55 checksummed (https://eips.ethereum.org/EIPS/eip-55);
// everything else (non-EVM addresses, role constants, ISO 4217 codes) is kept and compared exactly.
import { keccak_256 } from "@noble/hashes/sha3.js";

export type Normalized = { ok: true; value: string } | { ok: false; reason: string };

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const PRINTABLE_NO_SPACE = /^[\x21-\x7e]+$/;

export function toChecksumAddress(address: string): string {
  const hex = address.slice(2).toLowerCase();
  const hash = Array.from(keccak_256(new TextEncoder().encode(hex)), (b) => b.toString(16).padStart(2, "0")).join("");
  let out = "0x";
  for (let i = 0; i < 40; i += 1) {
    out += parseInt(hash.charAt(i), 16) >= 8 ? hex.charAt(i).toUpperCase() : hex.charAt(i);
  }
  return out;
}

export function normalizeAddress(network: string, value: string): Normalized {
  if (!PRINTABLE_NO_SPACE.test(value))
    return { ok: false, reason: "address is empty or has spaces or control characters" };
  if (!network.startsWith("eip155:") || !EVM_ADDRESS.test(value)) return { ok: true, value };
  const body = value.slice(2);
  const checksummed = toChecksumAddress(`0x${body}`);
  const mixedCase = body !== body.toLowerCase() && body !== body.toUpperCase();
  if (mixedCase && `0x${body}` !== checksummed)
    return { ok: false, reason: "EVM address has an invalid EIP-55 checksum" };
  return { ok: true, value: checksummed };
}
