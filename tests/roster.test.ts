import { describe, expect, it } from "vitest";
import { rosterNames } from "../apps/web/src/model";
import { dayList } from "../apps/web/src/pages/course/Timetable";

describe("adding students by pasting a list", () => {
  it("takes one name per line, without list numbers, bullets, blank lines or repeats", () => {
    expect(rosterNames("1. Ana L.\n2) Beto  M.\n\n- Carla R.\n• Dani S.\nana l.\n", [])).toEqual({ fresh: ["Ana L.", "Beto M.", "Carla R.", "Dani S."], repeated: [] });
  });
  it("sets apart the names already on the roster, ignoring case and accents", () => {
    expect(rosterNames("Sofía T.\nSOFIA T.\nZoe Q.", ["Sofia T."])).toEqual({ fresh: ["Zoe Q."], repeated: ["Sofía T."] });
  });
  it("keeps codes that start with a number", () => {
    expect(rosterNames("3A-07\n12", [])).toEqual({ fresh: ["3A-07", "12"], repeated: [] });
  });
});

describe("class days in a sentence", () => {
  it("joins the days in week order and lowercases all but the first", () => {
    expect(dayList([4, 2, 5])).toBe("Martes, jueves y viernes");
    expect(dayList([0, 1])).toBe("Lunes y domingo");
    expect(dayList([3], "short")).toBe("Mié");
    expect(dayList([])).toBe("");
  });
});
