import { describe, it, expect, vi, afterEach } from "vitest"
import * as client from "../odpt/client.js"
import { fetchTrainStatuses } from "./trainStatusPoller.js"
import type { OdptTrain } from "../odpt/types.js"

describe("fetchTrainStatuses", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keys statuses by trainNumber, filtered to the given railways", async () => {
    const trains: OdptTrain[] = [
      {
        "odpt:trainNumber": "851M",
        "odpt:railway": "odpt.Railway:JR-East.Takasaki",
        "odpt:delay": 120,
        "odpt:carComposition": 15,
      },
      {
        "odpt:trainNumber": "454M",
        "odpt:railway": "odpt.Railway:JR-East.JobanRapid",
        "odpt:delay": 0,
        "odpt:carComposition": 10,
      },
    ]
    vi.spyOn(client, "fetchOdptResource").mockResolvedValue(trains)

    const result = await fetchTrainStatuses("TOKEN123", [
      "odpt.Railway:JR-East.Takasaki",
      "odpt.Railway:JR-East.Utsunomiya",
    ])

    expect(result.get("851M")).toEqual({ delaySeconds: 120, carComposition: 15 })
    expect(result.has("454M")).toBe(false)
  })
})
