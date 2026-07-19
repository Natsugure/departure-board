import { fetchOdptResource } from "../odpt/client.js"
import type { OdptStationTimetable } from "../odpt/types.js"
import type { TrackConfig } from "../config/track.js"
import type { CalendarType } from "./calendar.js"

export interface TimetableEntry {
  trainNumber: string
  trainTypeId: string
  departureTime: string
  destinationStationId?: string
}

/**
 * 対象TrackConfigの各駅について、指定された方向・カレンダー種別に一致する
 * 本日分のStationTimetableを取得し、発車時刻順にマージして返す。
 */
export async function fetchTodaysDepartures(
  token: string,
  config: TrackConfig,
  calendarType: CalendarType,
): Promise<TimetableEntry[]> {
  const entries: TimetableEntry[] = []

  for (const stationId of config.stationIds) {
    const timetables = await fetchOdptResource<OdptStationTimetable>(token, "odpt:StationTimetable", {
      "odpt:station": stationId,
    })

    const match = timetables.find(
      (t) =>
        t["odpt:railDirection"] === `odpt.RailDirection:${config.direction}` &&
        t["odpt:calendar"] === `odpt.Calendar:${calendarType}`,
    )
    if (!match) {
      throw new Error(
        `No StationTimetable found for ${stationId} direction=${config.direction} calendar=${calendarType}`,
      )
    }

    for (const obj of match["odpt:stationTimetableObject"]) {
      entries.push({
        trainNumber: obj["odpt:trainNumber"],
        trainTypeId: obj["odpt:trainType"],
        departureTime: obj["odpt:departureTime"],
        destinationStationId: obj["odpt:destinationStation"]?.[0],
      })
    }
  }

  entries.sort((a, b) => toMinutes(a.departureTime) - toMinutes(b.departureTime))
  return entries
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number)
  return hours * 60 + minutes
}
