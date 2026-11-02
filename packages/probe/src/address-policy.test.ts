// Written with AI help.
import { describe, expect, it } from "vitest";
import { checkResolved, classifyAddress, hostLiteral } from "./address-policy.ts";

describe("classifyAddress: IPv4", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["10.0.0.1", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "link-local"],
    ["100.64.0.1", "private"],
    ["0.0.0.0", "reserved"],
    ["192.0.2.1", "reserved"],
    ["198.18.0.1", "reserved"],
    ["224.0.0.1", "reserved"],
    ["255.255.255.255", "reserved"],
  ])("refuses %s (%s)", (ip, category) => {
    expect(classifyAddress(ip)).toEqual({ allowed: false, category });
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.128.0.1", "169.255.0.1"])(
    "allows public %s",
    (ip) => {
      expect(classifyAddress(ip)).toEqual({ allowed: true });
    },
  );
});

describe("classifyAddress: IPv6", () => {
  it.each([
    ["::1", "loopback"],
    ["::", "reserved"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local"],
    ["fc00::1", "private"],
    ["fd12:3456::1", "private"],
    ["ff02::1", "reserved"],
    ["2001:db8::1", "reserved"],
    // IPv4 hidden inside IPv6: mapped, NAT64 and 6to4 forms are judged by the IPv4 address.
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:c0a8:1", "private"],
    ["64:ff9b::a9fe:a9fe", "link-local"],
    ["2002:0a00:0001::1", "private"],
  ])("refuses %s (%s)", (ip, category) => {
    expect(classifyAddress(ip)).toEqual({ allowed: false, category });
  });

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "64:ff9b::808:808", "2002:0808:0808::1"])(
    "allows public %s",
    (ip) => {
      expect(classifyAddress(ip)).toEqual({ allowed: true });
    },
  );

  it("refuses text that is not an IP address", () => {
    expect(classifyAddress("example.com")).toEqual({ allowed: false, category: "reserved" });
  });
});

describe("hostLiteral", () => {
  it("strips IPv6 brackets and recognises IP literals", () => {
    expect(hostLiteral("[::1]")).toBe("::1");
    expect(hostLiteral("127.0.0.1")).toBe("127.0.0.1");
    expect(hostLiteral("api.example.com")).toBeUndefined();
  });
});

describe("checkResolved (every resolved address must pass)", () => {
  it("passes when every address is public", () => {
    expect(checkResolved([{ address: "93.184.216.34", family: 4 }], false)).toEqual({
      ok: true,
      address: { address: "93.184.216.34", family: 4 },
    });
  });

  it("refuses when any address is private (one bad record is enough)", () => {
    const r = checkResolved(
      [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.7", family: 4 },
      ],
      false,
    );
    expect(r).toEqual({ ok: false, reason: "resolves to a private address" });
  });

  it("allows private addresses only with the opt-in", () => {
    expect(checkResolved([{ address: "127.0.0.1", family: 4 }], true).ok).toBe(true);
  });

  it("refuses an empty answer", () => {
    expect(checkResolved([], true)).toEqual({ ok: false, reason: "resolves to no address" });
  });
});
