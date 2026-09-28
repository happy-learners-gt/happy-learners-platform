import { expect, it } from "vitest";
import { organizationInput } from "../packages/domain/src/index";
it("accepts only minimal valid organization settings", () => {
  expect(organizationInput({ name: " Jardín de Colores ", timezone: "America/Guatemala", childName: "discarded" })).toEqual({ name: "Jardín de Colores", timezone: "America/Guatemala" });
  for (const value of [null, {}, { name: "ab", timezone: "America/Guatemala" }, { name: "<script>", timezone: "America/Guatemala" }, { name: "Nombre", timezone: "Europe/Invalid" }]) expect(organizationInput(value)).toBeNull();
});
