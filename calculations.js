export function parseEuro(value) {
  const raw = String(value).trim().replace(/\s|€/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "") : raw;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function splitAmount(totalCents, percentage) {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error("Importo non valido");
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) throw new Error("Percentuale non valida");
  const part = Math.round(totalCents * percentage / 100);
  if (part < 1) throw new Error("La percentuale produce una quota inferiore a un centesimo");
  const pieces = [];
  let remaining = totalCents;
  while (remaining > part) {
    pieces.push(part);
    remaining -= part;
    if (pieces.length >= 100) throw new Error("Sono consentite al massimo 100 pre-fatture");
  }
  if (remaining > 0) pieces.push(remaining);
  return pieces;
}

export function splitProjects(projectCents, percentages) {
  if (!Array.isArray(projectCents) || !projectCents.length || projectCents.length !== percentages.length) {
    throw new Error("Progetti non validi");
  }
  const shares = projectCents.map((cents, index) => percentages[index] == null ? [cents] : splitAmount(cents, percentages[index]));
  const count = Math.max(...shares.map(parts => parts.length));
  return Array.from({ length: count }, (_, invoiceIndex) => shares.map(parts => parts[invoiceIndex] || 0));
}

export function calculateInvoice(serviceCents, withStamp, withContribution) {
  const stampCents = withStamp ? 200 : 0;
  const contributionBaseCents = serviceCents + stampCents;
  const contributionCents = withContribution ? Math.round(contributionBaseCents * 0.04) : 0;
  return {
    serviceCents,
    stampCents,
    contributionBaseCents,
    contributionCents,
    totalCents: contributionBaseCents + contributionCents
  };
}

export const euro = cents => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(cents / 100);
