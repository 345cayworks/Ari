import type { WeightCategory } from "./weighting";

// Starting points for weighting targets. They are copied into a poll when
// chosen and can be edited there; check them against the source before
// publishing results.

export interface TargetPreset {
  key: string;
  label: string;
  description: string;
  source: string;
  categories: WeightCategory[];
}

// Electoral districts and common place names, grouped by the six areas.
const AREA_ALIASES: Record<string, string[]> = {
  "George Town": [
    "GT", "Georgetown", "George Town Central", "George Town East", "George Town North",
    "George Town South", "George Town West", "Prospect", "Red Bay", "South Sound", "Camana Bay",
  ],
  "West Bay": ["WB", "West Bay Central", "West Bay North", "West Bay South", "West Bay West"],
  "Bodden Town": [
    "BT", "Bodden Town East", "Bodden Town West", "Newlands", "Savannah", "Lower Valley", "Breakers",
  ],
  "North Side": ["NS", "Northside", "Rum Point"],
  "East End": ["EE", "Eastend"],
  "Sister Islands": [
    "Cayman Brac", "Brac", "Little Cayman", "Cayman Brac East", "Cayman Brac West",
    "Cayman Brac West and Little Cayman", "Cayman Brac and Little Cayman",
  ],
};

function areas(counts: Record<string, number>): WeightCategory[] {
  return Object.entries(counts).map(([name, target]) => ({
    name,
    target,
    aliases: AREA_ALIASES[name] ?? [],
  }));
}

export const TARGET_PRESETS: TargetPreset[] = [
  {
    key: "electors_by_area",
    label: "Registered electors by area",
    description:
      "For polls of voters. Electoral districts grouped into the six areas. Bodden Town is the " +
      "register total minus the other areas.",
    source: "Cayman Islands Elections Office, Register of Electors effective 1 October 2026 (25,590 electors)",
    categories: areas({
      "George Town": 9979,
      "West Bay": 5842,
      "Bodden Town": 6775,
      "North Side": 1001,
      "East End": 891,
      "Sister Islands": 1102,
    }),
  },
  {
    key: "residents_by_area_2021",
    label: "All residents by district (2021 Census)",
    description:
      "For polls of all residents, Caymanian or not. Sister Islands is the tabular total minus the " +
      "Grand Cayman districts.",
    source: "ESO, 2021 Census Report, Section 1.2 (tabular population 68,811)",
    categories: areas({
      "George Town": 33898,
      "West Bay": 14784,
      "Bodden Town": 14398,
      "North Side": 1857,
      "East End": 1758,
      "Sister Islands": 2116,
    }),
  },
];
