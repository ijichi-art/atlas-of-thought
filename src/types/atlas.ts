export type Point = [number, number];

export type ViewBox = {
  width: number;
  height: number;
};

export type SeaConfig = {
  color: string;
};

export type CountryData = {
  id: string;
  name: string;
  nameJa?: string;
  theme?: string;
  color: string;
  polygon: Point[];
};

export type MountainRangeData = {
  id: string;
  label?: string;
  betweenCountries?: [string, string];
  spine: Point[];
};

export type RiverData = {
  id: string;
  label?: string;
  path: Point[];
};

export type CityRank = "capital" | "city" | "town";

export type RoadType = "highway" | "regular" | "trail" | "ferry";

export type RoadData = {
  id: string;
  fromCityId: string;
  toCityId: string;
  type: RoadType;
  label?: string;
  // Optional intermediate path points; if present, the road renders as a
  // smooth curve (Catmull-Rom) through fromCity → waypoints → toCity.
  waypoints?: Point[];
};

export type MockMessage = {
  role: "user" | "assistant";
  text: string;
};

export type CityData = {
  id: string;
  countryId: string;
  rank: CityRank;
  label: string;
  labelJa?: string;
  // District (sub-cluster within country, e.g. "Auth Quarter"). Used for
  // mid-zoom labels and to group cities visually inside a country.
  district?: string;
  districtJa?: string;
  position: Point;
  // 0 = no buildings, 10 = dense cluster
  urbanDensity: number;
  // Optional one-paragraph summary of what this city represents.
  summary?: string;
  // Optional mock conversation preview shown in the detail panel.
  // In Phase 4 this will come from imported data; for the demo we hard-code.
  messages?: MockMessage[];
};

export type SampleMap = {
  id: string;
  title: string;
  viewBox: ViewBox;
  sea: SeaConfig;
  countries: CountryData[];
  mountainRanges: MountainRangeData[];
  rivers: RiverData[];
  cities: CityData[];
  roads: RoadData[];
};
