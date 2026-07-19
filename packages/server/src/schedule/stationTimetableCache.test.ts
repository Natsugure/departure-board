import { describe, it, expect, vi, afterEach } from "vitest"
import * as client from "../odpt/client.js"
import { fetchTodaysDepartures } from "./stationTimetableCache.js"
import type { TrackConfig } from "../config/track.js"
import type { OdptStationTimetable } from "../odpt/types.js"

const testConfig: TrackConfig = {
  stationIds: ["odpt.Station:JR-East.Takasaki.Akabane", "odpt.Station:JR-East.Utsunomiya.Akabane"],
  railwayIds: ["odpt.Railway:JR-East.Takasaki", "odpt.Railway:JR-East.Utsunomiya"],
  direction: "Inbound",
  platformLabel: "3",
  lineLabel: "上野東京ライン",
  lineBadge: "JU",
  destinationArea: "上野・東京・横浜方面",
}

describe("fetchTodaysDepartures", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("merges and sorts departures from both stations for the matching direction/calendar", async () => {
    vi.spyOn(client, "fetchOdptResource").mockImplementation(async (_token, _resourceType, params) => {
      const stationId = params?.["odpt:station"]
      if (stationId === "odpt.Station:JR-East.Takasaki.Akabane") {
        const timetables: OdptStationTimetable[] = [
          {
            "owl:sameAs": "odpt.StationTimetable:JR-East.Takasaki.Akabane.Inbound.Weekday",
            "odpt:railDirection": "odpt.RailDirection:Inbound",
            "odpt:calendar": "odpt.Calendar:Weekday",
            "odpt:stationTimetableObject": [
              {
                "odpt:trainNumber": "851M",
                "odpt:trainType": "odpt.TrainType:JR-East.Local",
                "odpt:departureTime": "19:15",
                "odpt:destinationStation": ["odpt.Station:JR-East.Takasaki.Ueno"],
              },
            ],
          },
        ]
        return timetables
      }
      if (stationId === "odpt.Station:JR-East.Utsunomiya.Akabane") {
        const timetables: OdptStationTimetable[] = [
          {
            "owl:sameAs": "odpt.StationTimetable:JR-East.Utsunomiya.Akabane.Inbound.Weekday",
            "odpt:railDirection": "odpt.RailDirection:Inbound",
            "odpt:calendar": "odpt.Calendar:Weekday",
            "odpt:stationTimetableObject": [
              {
                "odpt:trainNumber": "441M",
                "odpt:trainType": "odpt.TrainType:JR-East.Local",
                "odpt:departureTime": "19:08",
                "odpt:destinationStation": ["odpt.Station:JR-East.Tokaido.Odawara"],
              },
            ],
          },
        ]
        return timetables
      }
      throw new Error(`unexpected station: ${stationId}`)
    })

    const result = await fetchTodaysDepartures("TOKEN123", testConfig, "Weekday")

    expect(result).toEqual([
      {
        trainNumber: "441M",
        trainTypeId: "odpt.TrainType:JR-East.Local",
        departureTime: "19:08",
        destinationStationId: "odpt.Station:JR-East.Tokaido.Odawara",
      },
      {
        trainNumber: "851M",
        trainTypeId: "odpt.TrainType:JR-East.Local",
        departureTime: "19:15",
        destinationStationId: "odpt.Station:JR-East.Takasaki.Ueno",
      },
    ])
  })

  it("throws if no matching direction/calendar timetable is found for a station", async () => {
    vi.spyOn(client, "fetchOdptResource").mockResolvedValue([])

    await expect(fetchTodaysDepartures("TOKEN123", testConfig, "Weekday")).rejects.toThrow(
      "No StationTimetable found for odpt.Station:JR-East.Takasaki.Akabane",
    )
  })
})
