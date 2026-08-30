import { describe, expect, it } from "vitest";
import {
  contributionLevel,
  headingScore,
  linkPath,
  propertyLinks,
  safeFileName,
  stageForScore,
  wikiLink
} from "../src/model";
import { DEFAULT_THRESHOLDS } from "../src/model";

describe("growth model", () => {
  it("scores only H1 and H2 headings", () => {
    expect(headingScore([{ level: 1 }, { level: 2 }, { level: 2 }, { level: 3 }], 1, 0.5)).toBe(2);
  });

  it("uses stable stage boundaries", () => {
    expect(stageForScore(0, DEFAULT_THRESHOLDS)).toBe("seed");
    expect(stageForScore(0.5, DEFAULT_THRESHOLDS)).toBe("sprout");
    expect(stageForScore(5, DEFAULT_THRESHOLDS)).toBe("seedling");
    expect(stageForScore(15, DEFAULT_THRESHOLDS)).toBe("young-tree");
    expect(stageForScore(40, DEFAULT_THRESHOLDS)).toBe("mature-tree");
  });
});

describe("portable properties", () => {
  it("normalizes scalar and array properties", () => {
    expect(propertyLinks("[[DDS]]")).toEqual(["[[DDS]]"]);
    expect(propertyLinks([" [[DDS]] ", null, 3, ""])).toEqual(["[[DDS]]"]);
  });

  it("extracts link paths and writes wikilinks", () => {
    expect(linkPath("[[Knowledge Forests/Seeds/DDS|DDS]]")).toBe("Knowledge Forests/Seeds/DDS");
    expect(linkPath("DDS#QoS")).toBe("DDS");
    expect(wikiLink("Knowledge Forests/Seeds/DDS.md")).toBe("[[Knowledge Forests/Seeds/DDS]]");
  });

  it("sanitizes filesystem-hostile names", () => {
    expect(safeFileName("  DDS: QoS / Notes  ")).toBe("DDS- QoS - Notes");
  });
});

describe("contribution levels", () => {
  it("maps counts to five visual levels", () => {
    expect(contributionLevel(0, 8)).toBe(0);
    expect(contributionLevel(1, 8)).toBe(1);
    expect(contributionLevel(4, 8)).toBe(2);
    expect(contributionLevel(8, 8)).toBe(4);
  });
});
