import type { TrackConfig } from "../config/track.js"
import type { MasterData } from "../odpt/masterData.js"
import type { TimetableEntry } from "../schedule/stationTimetableCache.js"
import type { TrainStatus } from "../realtime/trainStatusPoller.js"
import type { CalendarType } from "../schedule/calendar.js"
import { todaysCalendarType } from "../schedule/calendar.js"
import { composeDepartures, type DepartureView } from "../departures/composeDepartures.js"

export interface DepartureBoardDeps {
  loadMasterData: (token: string) => Promise<MasterData>
  fetchTodaysDepartures: (token: string, config: TrackConfig, calendarType: CalendarType) => Promise<TimetableEntry[]>
  fetchTrainStatuses: (token: string, railwayIds: string[]) => Promise<Map<string, TrainStatus>>
}

/**
 * マスターデータ・本日分時刻表・リアルタイム遅延情報のキャッシュライフサイクルを保持し、
 * composeDeparturesへ橋渡しするオーケストレータ。依存はコンストラクタ注入とし、
 * モジュールモックなしでテスト可能にする。
 */
export class DepartureBoardState {
  private masterData?: MasterData
  private todaysDepartures: TimetableEntry[] = []
  private trainStatusByNumber: Map<string, TrainStatus> = new Map()
  private lastRefreshedDate: string | null = null

  constructor(
    private readonly token: string,
    private readonly config: TrackConfig,
    private readonly deps: DepartureBoardDeps,
  ) {}

  async refreshMasterData(): Promise<void> {
    this.masterData = await this.deps.loadMasterData(this.token)
  }

  async refreshTodaysDepartures(now: Date): Promise<void> {
    const calendarType = todaysCalendarType(now)
    this.todaysDepartures = await this.deps.fetchTodaysDepartures(this.token, this.config, calendarType)
    this.lastRefreshedDate = dateKey(now)
  }

  async refreshTrainStatuses(): Promise<void> {
    this.trainStatusByNumber = await this.deps.fetchTrainStatuses(this.token, this.config.railwayIds)
  }

  needsDailyRefresh(now: Date): boolean {
    return this.lastRefreshedDate !== dateKey(now)
  }

  getDepartures(now: Date, offsetMinutes: number): DepartureView[] {
    if (!this.masterData) {
      throw new Error("Master data not loaded yet")
    }
    return composeDepartures({
      now,
      offsetMinutes,
      todaysDepartures: this.todaysDepartures,
      trainStatusByNumber: this.trainStatusByNumber,
      trainTypeLabels: this.masterData.trainTypeLabels,
      stationNames: this.masterData.stationNames,
    })
  }
}

/**
 * サービス日の境界はJST深夜0時。TZ=Asia/Tokyoでの実行を前提に
 * getFullYear/getMonth/getDateを利用する（toISOString()は常にUTCのため
 * JST 0〜9時台の日付を前日と誤判定してしまい使用不可）。
 */
function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
