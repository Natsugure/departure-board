export interface OdptTrainType {
  "owl:sameAs": string
  "dc:title": string
}

export interface OdptStation {
  "owl:sameAs": string
  "dc:title": string
}

export interface OdptStationTimetableObject {
  "odpt:trainNumber": string
  "odpt:trainType": string
  "odpt:departureTime": string
  "odpt:destinationStation"?: string[]
}

export interface OdptStationTimetable {
  "owl:sameAs": string
  "odpt:railDirection": string
  "odpt:calendar": string
  "odpt:stationTimetableObject": OdptStationTimetableObject[]
}

export interface OdptTrain {
  "odpt:trainNumber": string
  "odpt:railway": string
  "odpt:delay": number
  "odpt:carComposition"?: number
}
