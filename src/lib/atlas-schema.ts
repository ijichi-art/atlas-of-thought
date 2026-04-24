import { z } from "zod";
import type { SampleMap } from "@/types/atlas";

// Zod schemas mirroring src/types/atlas.ts. Used at API boundaries so bad
// data fails loudly instead of propagating into the renderer. Keep in lockstep
// with the TS types.

const Point = z.tuple([z.number(), z.number()]);

const ViewBox = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

const Sea = z.object({
  color: z.string(),
});

const Country = z.object({
  id: z.string(),
  name: z.string(),
  nameJa: z.string().optional(),
  theme: z.string().optional(),
  color: z.string(),
  polygon: z.array(Point).min(3),
});

const MountainRange = z.object({
  id: z.string(),
  label: z.string().optional(),
  betweenCountries: z.tuple([z.string(), z.string()]).optional(),
  spine: z.array(Point).min(1),
});

const River = z.object({
  id: z.string(),
  label: z.string().optional(),
  path: z.array(Point).min(2),
});

const MockMessage = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});

const City = z.object({
  id: z.string(),
  countryId: z.string(),
  rank: z.enum(["capital", "city", "town"]),
  label: z.string(),
  labelJa: z.string().optional(),
  position: Point,
  urbanDensity: z.number().min(0).max(10),
  summary: z.string().optional(),
  messages: z.array(MockMessage).optional(),
});

const Road = z.object({
  id: z.string(),
  fromCityId: z.string(),
  toCityId: z.string(),
  type: z.enum(["highway", "regular", "trail", "ferry"]),
  label: z.string().optional(),
  waypoints: z.array(Point).optional(),
});

export const SampleMapSchema = z.object({
  id: z.string(),
  title: z.string(),
  viewBox: ViewBox,
  sea: Sea,
  countries: z.array(Country).min(1),
  mountainRanges: z.array(MountainRange),
  rivers: z.array(River),
  cities: z.array(City),
  roads: z.array(Road),
});

// Compile-time assertion: the inferred shape matches our hand-written types.
export type ParsedSampleMap = z.infer<typeof SampleMapSchema>;
const _typeCheck: ParsedSampleMap = {} as SampleMap;
void _typeCheck;
