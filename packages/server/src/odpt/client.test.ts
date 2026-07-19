import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchOdptResource } from "./client.js"

describe("fetchOdptResource", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("builds the URL with params and the token, and returns parsed JSON", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [{ hello: "world" }],
    })
    vi.stubGlobal("fetch", mockFetch)

    const result = await fetchOdptResource<{ hello: string }>("TOKEN123", "odpt:Station", {
      "odpt:operator": "odpt.Operator:JR-East",
    })

    expect(result).toEqual([{ hello: "world" }])
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api-challenge.odpt.org/api/v4/odpt:Station?odpt:operator=odpt.Operator:JR-East&acl:consumerKey=TOKEN123",
    )
  })

  it("throws when the response is not ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => [],
    })
    vi.stubGlobal("fetch", mockFetch)

    await expect(fetchOdptResource("TOKEN123", "odpt:Train", {})).rejects.toThrow(
      "ODPT request failed: odpt:Train 500 Internal Server Error",
    )
  })
})
