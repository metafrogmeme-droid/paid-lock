// Written with AI help.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkProbeUrl, isLoopbackHost, ProbeUrlError } from "./url-policy.ts";

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "127.255.0.9", "[::1]", "localhost", "LOCALHOST"])("treats %s as loopback", (h) => {
    expect(isLoopbackHost(h)).toBe(true);
  });
  it.each(["128.0.0.1", "example.com", "localhost.example.com", "[::2]", "0.0.0.0", "10.0.0.1"])(
    "treats %s as not loopback",
    (h) => {
      expect(isLoopbackHost(h)).toBe(false);
    },
  );
});

describe("checkProbeUrl", () => {
  it("accepts https on any host", () => {
    expect(checkProbeUrl("https://api.example.com/v1/x?q=1").href).toBe("https://api.example.com/v1/x?q=1");
  });

  it("accepts plain http only on loopback", () => {
    expect(checkProbeUrl("http://127.0.0.1:4021/paid").port).toBe("4021");
    expect(checkProbeUrl("http://[::1]:4021/paid").hostname).toBe("[::1]");
  });

  it("rejects plain http on a public host", () => {
    expect(() => checkProbeUrl("http://api.example.com/")).toThrow(ProbeUrlError);
  });

  it.each(["ftp://example.com/", "file:///etc/passwd", "data:text/plain,hi", "javascript:alert(1)"])(
    "rejects scheme of %s",
    (u) => {
      expect(() => checkProbeUrl(u)).toThrow(/https/);
    },
  );

  it("rejects credentials in the URL (they would leak into logs and the lock)", () => {
    expect(() => checkProbeUrl("https://user:pw@example.com/")).toThrow(/credentials/);
    expect(() => checkProbeUrl("https://user@example.com/")).toThrow(/credentials/);
  });

  it("rejects text that is not a URL", () => {
    expect(() => checkProbeUrl("not a url")).toThrow(ProbeUrlError);
  });

  it("drops the fragment (never sent over HTTP)", () => {
    expect(checkProbeUrl("https://example.com/a#frag").href).toBe("https://example.com/a");
  });

  it("property: any http URL on a non-loopback IPv4 address is rejected", () => {
    fc.assert(
      fc.property(
        fc.ipV4().filter((ip) => !ip.startsWith("127.")),
        (ip) => {
          expect(() => checkProbeUrl(`http://${ip}/`)).toThrow(ProbeUrlError);
        },
      ),
    );
  });
});
