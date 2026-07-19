import { describe, it, expect } from "vitest"
import { createDeparturesRoute, type DeparturesSource } from "./departuresRoute.js"
import { AKABANE_TRACK_3 } from "../config/track.js"
import type { DepartureView } from "../departures/composeDepartures.js"

function stubSource(trains: DepartureView[], shouldThrow = false): DeparturesSource {
  return {
    getDepartures: () => {
      if (shouldThrow) throw new Error("Master data not loaded yet")
      return trains
    },
  }
}

describe("GET /departures", () => {
  it("returns the composed trains with platform metadata", async () => {
    const trains: DepartureView[] = [
      { trainType: "普通", destination: "上野", carComposition: 15, scheduledTime: "19:08", delaySeconds: 0 },
    ]
    const route = createDeparturesRoute(stubSource(trains), AKABANE_TRACK_3)

    const res = await route.request("/departures?offset=5")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.trains).toEqual(trains)
    expect(body.platform).toEqual({
      label: "3",
      lineLabel: "上野東京ライン",
      lineBadge: "JU",
      destinationArea: "上野・東京・横浜方面",
    })
  })

  it("defaults offset to 0 when not provided", async () => {
    const route = createDeparturesRoute(stubSource([]), AKABANE_TRACK_3)
    const res = await route.request("/departures")
    expect(res.status).toBe(200)
  })

  it("rejects an offset outside 0-30", async () => {
    const route = createDeparturesRoute(stubSource([]), AKABANE_TRACK_3)
    const res = await route.request("/departures?offset=31")
    expect(res.status).toBe(400)
  })

  it("returns 503 when the source is not ready yet", async () => {
    const route = createDeparturesRoute(stubSource([], true), AKABANE_TRACK_3)
    const res = await route.request("/departures")
    expect(res.status).toBe(503)
  })
})
