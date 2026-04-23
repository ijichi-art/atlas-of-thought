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

export type SampleMap = {
  id: string;
  title: string;
  viewBox: ViewBox;
  sea: SeaConfig;
  countries: CountryData[];
  mountainRanges: MountainRangeData[];
  rivers: RiverData[];
};
