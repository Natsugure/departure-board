import { describe, it, expect } from "vitest"
import { todaysCalendarType } from "./calendar.js"

describe("todaysCalendarType", () => {
  it("returns Weekday for an ordinary Tuesday", () => {
    // 2026-07-14 is a Tuesday, not a Japanese public holiday
    expect(todaysCalendarType(new Date("2026-07-14T10:00:00+09:00"))).toBe("Weekday")
  })

  it("returns SaturdayHoliday for a Saturday", () => {
    // 2026-07-18 is a Saturday
    expect(todaysCalendarType(new Date("2026-07-18T10:00:00+09:00"))).toBe("SaturdayHoliday")
  })

  it("returns SaturdayHoliday for a Sunday", () => {
    // 2026-07-19 is a Sunday
    expect(todaysCalendarType(new Date("2026-07-19T10:00:00+09:00"))).toBe("SaturdayHoliday")
  })

  it("returns SaturdayHoliday for a weekday public holiday (Marine Day)", () => {
    // 2026-07-20 is Marine Day (海の日), a Monday
    expect(todaysCalendarType(new Date("2026-07-20T10:00:00+09:00"))).toBe("SaturdayHoliday")
  })
})
