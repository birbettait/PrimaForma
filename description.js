export function projectDescription(projects, { index = 0, count = 1, percentage = 100 } = {}) {
  const names = projects.split(/[,;\n]+/).map(name => name.trim()).filter(Boolean);
  if (!names.length) return "";
  const projectLabel = names.length === 1 ? `progetto ${names[0]}` : `progetti ${new Intl.ListFormat("it-IT", { style: "long", type: "conjunction" }).format(names)}`;
  const intro = `Prestazione professionale di consulenza e sviluppo software – ${projectLabel}.`;
  if (count === 1) return intro;
  const share = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(percentage);
  if (index === count - 1) return `${intro} La presente pro forma rappresenta il saldo, pari al ${share}% dell’importo complessivo concordato.`;
  return `${intro} La presente pro forma rappresenta la quota ${index + 1} di ${count}, pari al ${share}% dell’importo complessivo concordato.`;
}

export function projectLineDescription(name, { projectCount = 1, index = 0, count = 1, percentage = 100 } = {}) {
  const intro = `Prestazione professionale di consulenza e sviluppo software – progetto ${name.trim()}`;
  if (count === 1 && projectCount > 1) return intro;
  return projectDescription(name, { index, count, percentage });
}
