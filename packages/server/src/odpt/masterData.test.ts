import { describe, it, expect, vi, afterEach } from "vitest"
import * as client from "./client.js"
import { loadMasterData } from "./masterData.js"
import type { OdptTrainType, OdptStation } from "./types.js"

describe("loadMasterData", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("builds trainType and station label maps keyed by owl:sameAs", async () => {
    vi.spyOn(client, "fetchOdptResource").mockImplementation(async (_token, resourceType) => {
      if (resourceType === "odpt:TrainType") {
        const trainTypes: OdptTrainType[] = [
          { "owl:sameAs": "odpt.TrainType:JR-East.Local", "dc:title": "普通" },
          { "owl:sameAs": "odpt.TrainType:JR-East.Rapid", "dc:title": "快速" },
        ]
        return trainTypes
      }
      if (resourceType === "odpt:Station") {
        const stations: OdptStation[] = [
          { "owl:sameAs": "odpt.Station:JR-East.Takasaki.Ueno", "dc:title": "上野" },
        ]
        return stations
      }
      throw new Error(`unexpected resourceType: ${resourceType}`)
    })

    const master = await loadMasterData("TOKEN123")

    expect(master.trainTypeLabels.get("odpt.TrainType:JR-East.Local")).toBe("普通")
    expect(master.trainTypeLabels.get("odpt.TrainType:JR-East.Rapid")).toBe("快速")
    expect(master.stationNames.get("odpt.Station:JR-East.Takasaki.Ueno")).toBe("上野")
  })
})
