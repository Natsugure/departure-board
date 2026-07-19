import { describe, it, expect, vi } from "vitest"
import { DepartureBoardState } from "./departureBoardState.js"
import { AKABANE_TRACK_3 } from "../config/track.js"

function buildDeps() {
  return {
    loadMasterData: vi.fn().mockResolvedValue({
      trainTypeLabels: new Map([["odpt.TrainType:JR-East.Local", "普通"]]),
      stationNames: new Map([["odpt.Station:JR-East.Takasaki.Ueno", "上野"]]),
    }),
    fetchTodaysDepartures: vi.fn().mockResolvedValue([
      {
        trainNumber: "851M",
        trainTypeId: "odpt.TrainType:JR-East.Local",
        departureTime: "19:08",
        destinationStationId: "odpt.Station:JR-East.Takasaki.Ueno",
      },
    ]),
    fetchTrainStatuses: vi.fn().mockResolvedValue(new Map([["851M", { delaySeconds: 60, carComposition: 15 }]])),
  }
}

describe("DepartureBoardState", () => {
  it("throws from getDepartures before refreshMasterData has run", () => {
    const state = new DepartureBoardState("TOKEN123", AKABANE_TRACK_3, buildDeps())
    expect(() => state.getDepartures(new Date(), 0)).toThrow("Master data not loaded yet")
  })

  it("composes departures once all caches are refreshed", async () => {
    const deps = buildDeps()
    const state = new DepartureBoardState("TOKEN123", AKABANE_TRACK_3, deps)

    const now = new Date("2026-07-18T19:00:00+09:00")
    await state.refreshMasterData()
    await state.refreshTodaysDepartures(now)
    await state.refreshTrainStatuses()

    expect(deps.fetchTodaysDepartures).toHaveBeenCalledWith("TOKEN123", AKABANE_TRACK_3, "SaturdayHoliday")
    expect(deps.fetchTrainStatuses).toHaveBeenCalledWith("TOKEN123", AKABANE_TRACK_3.railwayIds)

    const result = state.getDepartures(now, 0)
    expect(result).toEqual([
      { trainType: "普通", destination: "上野", carComposition: 15, scheduledTime: "19:08", delaySeconds: 60 },
    ])
  })

  it("reports whether a daily refresh is needed based on the calendar date", async () => {
    const deps = buildDeps()
    const state = new DepartureBoardState("TOKEN123", AKABANE_TRACK_3, deps)
    const day1 = new Date("2026-07-18T19:00:00+09:00")
    const day2 = new Date("2026-07-19T08:00:00+09:00")

    expect(state.needsDailyRefresh(day1)).toBe(true) // nothing fetched yet

    await state.refreshTodaysDepartures(day1)
    expect(state.needsDailyRefresh(day1)).toBe(false)
    expect(state.needsDailyRefresh(day2)).toBe(true)
  })
})
