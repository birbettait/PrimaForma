import test from "node:test";
import assert from "node:assert/strict";
import { parseEuro, splitAmount, splitProjects, calculateInvoice } from "./calculations.js";

test("legge importi italiani e con punto decimale", () => {
  assert.equal(parseEuro("1.234,56"), 123456);
  assert.equal(parseEuro("1234.56"), 123456);
  assert.equal(parseEuro("1.234"), 123400);
  assert.equal(parseEuro("1,234"), null);
});

test("calcola bollo e rivalsa su un importo dimostrativo", () => {
  assert.deepEqual(calculateInvoice(100000, true, true), {
    serviceCents: 100000, stampCents: 200, contributionBaseCents: 100200,
    contributionCents: 4008, totalCents: 104208
  });
});

test("somma due progetti e applica un solo bollo e rivalsa", () => {
  const serviceCents = 12000 + 8000;
  assert.deepEqual(calculateInvoice(serviceCents, true, true), {
    serviceCents: 20000, stampCents: 200, contributionBaseCents: 20200,
    contributionCents: 808, totalCents: 21008
  });
});

test("divide una prestazione al centesimo senza perderne", () => {
  const halves = splitAmount(10001, 50);
  assert.deepEqual(halves, [5001, 5000]);
  assert.equal(halves.reduce((a, b) => a + b), 10001);
  assert.deepEqual(splitAmount(10000, 30), [3000, 3000, 3000, 1000]);
  assert.equal(splitAmount(10000, 30).map(v => calculateInvoice(v, true, true).stampCents).reduce((a, b) => a + b), 800);
});

test("divide ogni progetto secondo la propria percentuale", () => {
  assert.deepEqual(splitProjects([12000, 8000], [null, 50]), [[12000, 4000], [0, 4000]]);
  assert.deepEqual(splitProjects([10001, 9000], [50, 30]), [[5001, 2700], [5000, 2700], [0, 2700], [0, 900]]);
  const rows = splitProjects([12001, 8000], [50, null]);
  assert.deepEqual(rows.map(row => row.reduce((a, b) => a + b, 0)), [14001, 6000]);
  assert.deepEqual([0, 1].map(i => rows.reduce((sum, row) => sum + row[i], 0)), [12001, 8000]);
});
