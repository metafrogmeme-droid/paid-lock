// Written with AI help.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./url.ts";

const ok = (input: string): string => {
  const r = normalizeUrl(input);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe("normalizeUrl (owner decision #10: minimal normalisation only)", () => {
  it("lowercases scheme and host", () => {
    expect(ok("HTTPS://API.Example.COM/V1/Forecast")).toBe("https://api.example.com/V1/Forecast");
  });

  it("drops the default port only", () => {
    expect(ok("https://a.example:443/x")).toBe("https://a.example/x");
    expect(ok("http://a.example:80/x")).toBe("http://a.example/x");
    expect(ok("https://a.example:8443/x")).toBe("https://a.example:8443/x");
    expect(ok("http://a.example:443/x")).toBe("http://a.example:443/x");
  });

  it("does not add, remove or rewrite slashes, dot segments, encoding or the query", () => {
    expect(ok("https://a.example")).toBe("https://a.example");
    expect(ok("https://a.example/")).toBe("https://a.example/");
    expect(ok("https://a.example/v1/")).toBe("https://a.example/v1/");
    expect(ok("https://a.example/a/../b")).toBe("https://a.example/a/../b");
    expect(ok("https://a.example/%7Euser")).toBe("https://a.example/%7Euser");
    expect(ok("https://a.example/x?b=2&a=1")).toBe("https://a.example/x?b=2&a=1");
    expect(ok("https://a.example?q")).toBe("https://a.example?q");
  });

  it("drops the fragment (never sent over HTTP)", () => {
    expect(ok("https://a.example/x?q=1#frag")).toBe("https://a.example/x?q=1");
  });

  it("keeps IPv6 hosts in brackets", () => {
    expect(ok("http://[::1]:4021/paid")).toBe("http://[::1]:4021/paid");
  });

  it.each([
    ["a relative URL", "/v1/forecast"],
    ["another scheme", "ftp://a.example/x"],
    ["credentials", "https://user:pw@a.example/x"],
    ["a backslash (parsers disagree on it)", "https://a.example\\evil.example/x"],
    ["whitespace", "https://a.example/a b"],
    ["leading whitespace", " https://a.example/"],
    ["a control character", "https://a.example/\u0000"],
    ["no host", "https:///x"],
  ])("refuses %s", (_name, input) => {
    expect(normalizeUrl(input).ok).toBe(false);
  });

  it("property: idempotent", () => {
    fc.assert(
      fc.property(fc.webUrl({ withQueryParameters: true, withFragments: true }), (u) => {
        const r = normalizeUrl(u);
        if (r.ok) expect(normalizeUrl(r.value)).toEqual(r);
      }),
    );
  });

  it("property: a different path or query is a different URL", () => {
    fc.assert(
      fc.property(fc.webPath(), fc.webPath(), (a, b) => {
        fc.pre(a !== b);
        const x = normalizeUrl(`https://a.example${a}`);
        const y = normalizeUrl(`https://a.example${b}`);
        if (x.ok && y.ok) expect(x.value).not.toBe(y.value);
      }),
    );
  });
});
