import { afterEach, describe, expect, it } from "vitest";
import { rejectUntrustedRequest } from "./request-security";

const originalNetworkSetting = process.env.ATLAS_ALLOW_NETWORK;

afterEach(() => {
  if (originalNetworkSetting === undefined) {
    delete process.env.ATLAS_ALLOW_NETWORK;
  } else {
    process.env.ATLAS_ALLOW_NETWORK = originalNetworkSetting;
  }
});

function request(
  url: string,
  init: { method?: string; origin?: string; fetchSite?: string; host?: string } = {},
): Request {
  const headers = new Headers();
  if (init.origin) headers.set("Origin", init.origin);
  if (init.fetchSite) headers.set("Sec-Fetch-Site", init.fetchSite);
  if (init.host) headers.set("Host", init.host);
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
  });
}

describe("rejectUntrustedRequest", () => {
  it("allows loopback reads", () => {
    expect(rejectUntrustedRequest(request("http://localhost:3002/api/maps"))).toBeNull();
    expect(rejectUntrustedRequest(request("http://127.0.0.1:3892/api/maps"))).toBeNull();
  });

  it("blocks non-loopback Host headers in Solo mode", () => {
    const nonLoopbackUrl = rejectUntrustedRequest(request("http://attacker.example:3002/api/maps"));
    const forgedHost = rejectUntrustedRequest(
      request("http://localhost:3002/api/maps", { host: "attacker.example:3002" }),
    );
    expect(nonLoopbackUrl?.status).toBe(421);
    expect(forgedHost?.status).toBe(421);
  });

  it("allows same-origin mutations", () => {
    const response = rejectUntrustedRequest(
      request("http://localhost:3002/api/maps", {
        method: "POST",
        origin: "http://localhost:3002",
        fetchSite: "same-origin",
      }),
    );
    expect(response).toBeNull();
  });

  it("blocks cross-origin and cross-site mutations", () => {
    const wrongOrigin = rejectUntrustedRequest(
      request("http://localhost:3002/api/maps", {
        method: "POST",
        origin: "https://attacker.example",
      }),
    );
    const crossSite = rejectUntrustedRequest(
      request("http://localhost:3002/api/maps", {
        method: "POST",
        fetchSite: "cross-site",
      }),
    );
    expect(wrongOrigin?.status).toBe(403);
    expect(crossSite?.status).toBe(403);
  });

  it("allows an explicitly acknowledged network deployment", () => {
    process.env.ATLAS_ALLOW_NETWORK = "1";
    const response = rejectUntrustedRequest(
      request("https://atlas.example/api/maps", {
        method: "POST",
        origin: "https://atlas.example",
        fetchSite: "same-origin",
      }),
    );
    expect(response).toBeNull();
  });
});
