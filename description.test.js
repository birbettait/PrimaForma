import test from "node:test";
import assert from "node:assert/strict";
import { projectDescription, projectLineDescription } from "./description.js";

test("una prestazione non divisa non parla di saldo", () => {
  assert.equal(projectDescription("Alfa"), "Prestazione professionale di consulenza e sviluppo software – progetto Alfa.");
});

test("descrive quote e saldo di una prestazione divisa", () => {
  assert.match(projectDescription("Alfa, Beta", { index: 0, count: 2, percentage: 50 }), /La presente pro forma rappresenta la quota 1 di 2, pari al 50%/);
  assert.match(projectDescription("Alfa", { index: 1, count: 2, percentage: 50 }), /La presente pro forma rappresenta il saldo, pari al 50%/);
  assert.match(projectDescription("Alfa", { index: 3, count: 4, percentage: 10 }), /saldo, pari al 10%/);
});

test("la fattura con più progetti ha una descrizione per riga", () => {
  assert.equal(projectLineDescription("Alfa", { projectCount: 2 }), "Prestazione professionale di consulenza e sviluppo software – progetto Alfa");
  assert.equal(projectLineDescription("Beta", { projectCount: 2 }), "Prestazione professionale di consulenza e sviluppo software – progetto Beta");
});
