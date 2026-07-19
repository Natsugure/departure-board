import { describe, it, expect } from "vitest"
import { composeDepartures } from "./composeDepartures.js"
import type { TimetableEntry } from "../schedule/stationTimetableCache.js"
import type { TrainStatus } from "../realtime/trainStatusPoller.js"

const departures: TimetableEntry[] = [
  {
    trainNumber: "441M",
    trainTypeId: "odpt.TrainType:JR-East.Local",
    departureTime: "19:00",
    destinationStationId: "odpt.Station:JR-East.Tokaido.Odawara",
  },
  {
    trainNumber: "851M",
    trainTypeId: "odpt.TrainType:JR-East.Local",
    departureTime: "19:08",
    destinationStationId: "odpt.Station:JR-East.Takasaki.Ueno",
  },
  {
    trainNumber: "453M",
    trainTypeId: "odpt.TrainType:JR-East.Rapid",
    departureTime: "19:15",
    destinationStationId: "odpt.Station:JR-East.Tokaido.Odawara",
  },
]

const trainTypeLabels = new Map([
  ["odpt.TrainType:JR-East.Local", "普通"],
  ["odpt.TrainType:JR-East.Rapid", "快速"],
])

const stationNames = new Map([
  ["odpt.Station:JR-East.Tokaido.Odawara", "小田原"],
  ["odpt.Station:JR-East.Takasaki.Ueno", "上野"],
])

describe("composeDepartures", () => {
  it("returns the next 2 departures at/after now, sorted", () => {
    const result = composeDepartures({
      now: new Date("2026-07-18T19:01:00+09:00"),
      offsetMinutes: 0,
      todaysDepartures: departures,
      trainStatusByNumber: new Map(),
      trainTypeLabels,
      stationNames,
    })

    expect(result).toEqual([
      { trainType: "普通", destination: "上野", carComposition: undefined, scheduledTime: "19:08", delaySeconds: 0 },
      { trainType: "快速", destination: "小田原", carComposition: undefined, scheduledTime: "19:15", delaySeconds: 0 },
    ])
  })

  it('shifts the effective "now" forward by offsetMinutes', () => {
    const result = composeDepartures({
      now: new Date("2026-07-18T19:01:00+09:00"),
      offsetMinutes: 10, // effective now = 19:11, so 19:08 train is gone
      todaysDepartures: departures,
      trainStatusByNumber: new Map(),
      trainTypeLabels,
      stationNames,
    })

    expect(result).toEqual([
      { trainType: "快速", destination: "小田原", carComposition: undefined, scheduledTime: "19:15", delaySeconds: 0 },
    ])
  })

  it("applies real-time delay and car composition when the train number matches", () => {
    const trainStatusByNumber = new Map<string, TrainStatus>([
      ["851M", { delaySeconds: 120, carComposition: 15 }],
    ])

    const result = composeDepartures({
      now: new Date("2026-07-18T19:01:00+09:00"),
      offsetMinutes: 0,
      todaysDepartures: departures,
      trainStatusByNumber,
      trainTypeLabels,
      stationNames,
    })

    expect(result[0]).toEqual({
      trainType: "普通",
      destination: "上野",
      carComposition: 15,
      scheduledTime: "19:08",
      delaySeconds: 120,
    })
  })

  it("defaults delaySeconds to 0 and carComposition to undefined with no real-time match", () => {
    const result = composeDepartures({
      now: new Date("2026-07-18T19:01:00+09:00"),
      offsetMinutes: 0,
      todaysDepartures: departures,
      trainStatusByNumber: new Map(),
      trainTypeLabels,
      stationNames,
    })

    expect(result[0].delaySeconds).toBe(0)
    expect(result[0].carComposition).toBeUndefined()
  })

  it("falls back to the raw ID when a label is missing from the master data maps", () => {
    const result = composeDepartures({
      now: new Date("2026-07-18T19:01:00+09:00"),
      offsetMinutes: 0,
      todaysDepartures: [departures[1]],
      trainStatusByNumber: new Map(),
      trainTypeLabels: new Map(), // empty — no label known
      stationNames: new Map(), // empty — no name known
    })

    expect(result[0].trainType).toBe("odpt.TrainType:JR-East.Local")
    expect(result[0].destination).toBe("odpt.Station:JR-East.Takasaki.Ueno")
  })

  it("respects a custom limit", () => {
    const result = composeDepartures({
      now: new Date("2026-07-18T19:01:00+09:00"),
      offsetMinutes: 0,
      todaysDepartures: departures,
      trainStatusByNumber: new Map(),
      trainTypeLabels,
      stationNames,
      limit: 1,
    })

    expect(result).toHaveLength(1)
  })
})
