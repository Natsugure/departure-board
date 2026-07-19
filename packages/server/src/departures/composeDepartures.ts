import type { TimetableEntry } from "../schedule/stationTimetableCache.js"
import type { TrainStatus } from "../realtime/trainStatusPoller.js"

export interface DepartureView {
  trainType: string
  destination: string
  carComposition?: number
  scheduledTime: string
  delaySeconds: number
}

export interface ComposeDeparturesParams {
  now: Date
  offsetMinutes: number
  todaysDepartures: TimetableEntry[]
  trainStatusByNumber: Map<string, TrainStatus>
  trainTypeLabels: Map<string, string>
  stationNames: Map<string, string>
  limit?: number
}

/**
 * 本日分の時刻表とリアルタイム遅延・編成情報をマージし、
 * 実効現在時刻（now + offsetMinutes）以降の直近limit件の発車情報を返す。
 * ODPTの発車時刻はJST壁時計文字列のため、TZ=Asia/Tokyoでの実行を前提に
 * now.getHours()/getMinutes()を利用する。
 */
export function composeDepartures(params: ComposeDeparturesParams): DepartureView[] {
  const { now, offsetMinutes, todaysDepartures, trainStatusByNumber, trainTypeLabels, stationNames } = params
  const limit = params.limit ?? 2

  const targetMinutes = now.getHours() * 60 + now.getMinutes() + offsetMinutes

  const upcoming = todaysDepartures
    .filter((entry) => toMinutes(entry.departureTime) >= targetMinutes)
    .sort((a, b) => toMinutes(a.departureTime) - toMinutes(b.departureTime))
    .slice(0, limit)

  return upcoming.map((entry) => {
    const status = trainStatusByNumber.get(entry.trainNumber)
    return {
      trainType: trainTypeLabels.get(entry.trainTypeId) ?? entry.trainTypeId,
      destination: entry.destinationStationId
        ? (stationNames.get(entry.destinationStationId) ?? entry.destinationStationId)
        : "",
      carComposition: status?.carComposition,
      scheduledTime: entry.departureTime,
      delaySeconds: status?.delaySeconds ?? 0,
    }
  })
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number)
  return hours * 60 + minutes
}
