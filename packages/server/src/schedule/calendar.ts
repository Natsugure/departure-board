import { createRequire } from "node:module"

// @holiday-jp/holiday_jpはexportsマップを持たないCJSパッケージのため、
// named importではなくcreateRequire経由で読み込む（Phase 0のgtfs-realtime-bindingsと同じ対応）。
const require = createRequire(import.meta.url)
const holidayJp = require("@holiday-jp/holiday_jp") as { isHoliday(date: Date): boolean }

export type CalendarType = "Weekday" | "SaturdayHoliday"

/**
 * 指定された日付のJR時刻表カレンダー種別を返す。
 * TZ=Asia/Tokyoで実行されている前提でgetDay()を利用するため、
 * ホストマシンのタイムゾーン設定に関わらずJSTの曜日として判定する。
 */
export function todaysCalendarType(date: Date): CalendarType {
  const day = date.getDay() // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6 || holidayJp.isHoliday(date)) {
    return "SaturdayHoliday"
  }
  return "Weekday"
}
