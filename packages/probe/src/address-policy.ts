// Which addresses the probe may connect to (owner decision, 2 Nov 2026): private, link-local,
// loopback and other special-purpose ranges are refused unless the lock entry opts in with
// policy.allowPrivateNetwork. Every DNS answer is checked, and the probe connects only to the
// address it checked (see probe.ts), so a second DNS answer cannot redirect it (DNS rebinding).
// Ranges: IANA IPv4 / IPv6 Special-Purpose Address Registries (RFC 6890 and updates).
import { BlockList, isIP } from "node:net";

export type Category = "loopback" | "private" | "link-local" | "reserved";
export type Classification = { allowed: true } | { allowed: false; category: Category };
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

const RANGES: readonly [Category, string, number, "ipv4" | "ipv6"][] = [
  ["loopback", "127.0.0.0", 8, "ipv4"],
  ["private", "10.0.0.0", 8, "ipv4"],
  ["private", "172.16.0.0", 12, "ipv4"],
  ["private", "192.168.0.0", 16, "ipv4"],
  ["private", "100.64.0.0", 10, "ipv4"], // shared address space (carrier-grade NAT)
  ["link-local", "169.254.0.0", 16, "ipv4"], // includes cloud metadata services
  ["reserved", "0.0.0.0", 8, "ipv4"],
  ["reserved", "192.0.0.0", 24, "ipv4"],
  ["reserved", "192.0.2.0", 24, "ipv4"],
  ["reserved", "198.18.0.0", 15, "ipv4"],
  ["reserved", "198.51.100.0", 24, "ipv4"],
  ["reserved", "203.0.113.0", 24, "ipv4"],
  ["reserved", "224.0.0.0", 4, "ipv4"],
  ["reserved", "240.0.0.0", 4, "ipv4"],
  ["loopback", "::1", 128, "ipv6"],
  ["reserved", "::", 128, "ipv6"],
  ["link-local", "fe80::", 10, "ipv6"],
  ["private", "fc00::", 7, "ipv6"],
  ["reserved", "ff00::", 8, "ipv6"],
  ["reserved", "2001:db8::", 32, "ipv6"],
  ["reserved", "100::", 64, "ipv6"],
  ["reserved", "64:ff9b:1::", 48, "ipv6"],
];

const LISTS = new Map<Category, BlockList>();
for (const [category, network, prefix, type] of RANGES) {
  const list = LISTS.get(category) ?? new BlockList();
  list.addSubnet(network, prefix, type);
  LISTS.set(category, list);
}

/** Expand an IPv6 address to its 8 groups (input already validated by isIP). */
function groups(ip: string): number[] {
  const [head = "", tail = ""] = ip.includes("::") ? ip.split("::") : [ip, ""];
  const parse = (part: string): number[] => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (g.includes(".")) {
        const [a = 0, b = 0, c = 0, d = 0] = g.split(".").map(Number);
        out.push((a << 8) | b, (c << 8) | d);
      } else out.push(parseInt(g, 16));
    }
    return out;
  };
  const h = parse(head);
  const t = parse(tail);
  return [...h, ...Array<number>(8 - h.length - t.length).fill(0), ...t];
}

function v4(hi: number, lo: number): string {
  return `${String(hi >> 8)}.${String(hi & 255)}.${String(lo >> 8)}.${String(lo & 255)}`;
}

/** An IPv4 address carried inside a NAT64 (64:ff9b::/96) or 6to4 (2002::/16) IPv6 address. */
function embeddedV4(ip: string): string | undefined {
  const g = groups(ip);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4(g[6] ?? 0, g[7] ?? 0);
  if (g[0] === 0x2002) return v4(g[1] ?? 0, g[2] ?? 0);
  return undefined;
}

export function classifyAddress(ip: string): Classification {
  const family = isIP(ip);
  if (family === 0) return { allowed: false, category: "reserved" };
  const type = family === 4 ? "ipv4" : "ipv6";
  for (const [category, list] of LISTS) if (list.check(ip, type)) return { allowed: false, category };
  const inner = family === 6 ? embeddedV4(ip) : undefined;
  return inner === undefined ? { allowed: true } : classifyAddress(inner);
}

/** The IP address a URL hostname spells literally (brackets removed), or undefined for a DNS name. */
export function hostLiteral(hostname: string): string | undefined {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return isIP(bare) === 0 ? undefined : bare;
}

export type Checked = { ok: true; address: ResolvedAddress } | { ok: false; reason: string };

/** All resolved addresses must be allowed; the first one is the address the probe then connects to. */
export function checkResolved(addresses: readonly ResolvedAddress[], allowPrivateNetwork: boolean): Checked {
  const [first] = addresses;
  if (first === undefined) return { ok: false, reason: "resolves to no address" };
  if (!allowPrivateNetwork) {
    for (const a of addresses) {
      const c = classifyAddress(a.address);
      if (!c.allowed) return { ok: false, reason: `resolves to a ${c.category} address` };
    }
  }
  return { ok: true, address: first };
}
