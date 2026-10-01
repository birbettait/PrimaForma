import { parseEuro, splitAmount, splitProjects, calculateInvoice, euro } from "./calculations.js";
import { projectLineDescription } from "./description.js";
import { apiRequest, migrateBrowserData } from "./api.js";

const form = document.querySelector("#invoiceForm");
const itemContainer = document.querySelector("#projectItems");
const preview = document.querySelector("#preview");
const savedList = document.querySelector("#savedInvoices");
const archiveSummary = document.querySelector("#archiveSummary");
const savedPrintRoot = document.createElement("div");
savedPrintRoot.className = "saved-print-root";
preview.after(savedPrintRoot);
const clientSelect = document.querySelector("#savedClient");
const logoInput = document.querySelector("#logoInput");
const removeLogoButton = document.querySelector("#removeLogo");
const saveProfileButton = document.querySelector("#saveProfile");
const saveButton = document.querySelector("#saveInvoices");
const printButton = document.querySelector("#printButton");
const error = document.querySelector("#formError");
const message = document.querySelector("#formMessage");
const fields = ["number", "year", "date", "dueDate", "clientName", "clientStreet", "clientCity", "clientVat", "sellerName", "sellerStreet", "sellerCity", "sellerTax", "sellerVat", "accountHolder", "iban", "notes"];
const checks = ["stamp", "contribution"];
const clientFields = ["clientName", "clientStreet", "clientCity", "clientVat"];
const profileFields = ["sellerName", "sellerStreet", "sellerCity", "sellerTax", "sellerVat", "accountHolder", "iban", "notes"];
const today = new Date();
const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
form.elements.year.value = today.getFullYear();
form.elements.date.value = localToday;
form.elements.dueDate.value = localToday;

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const formatDate = value => { const [year, month, day] = String(value || "").split("-"); return year && month && day ? `${day}/${month}/${year}` : ""; };
const field = name => form.elements[name].value.trim();
const line = value => value ? `<div>${escapeHtml(value)}</div>` : "";
const showMessage = (value, isError = false) => { message.textContent = value; message.hidden = !value; message.classList.toggle("message-error", isError); };
const moneyInput = cents => (cents / 100).toFixed(2).replace(".", ",");
const pageTitle = document.title;
const legacyNotes = "Regime forfettario: operazione in franchigia IVA e senza ritenuta d'acconto Art.1 c.54-89 L.190/2014";
const defaultNotes = "Operazione senza applicazione dell’IVA ai sensi dell’art. 1, commi 54-89, L. 190/2014.\nCompenso non soggetto a ritenuta d’acconto ai sensi dell’art. 1, comma 67, L. 190/2014.";
const currentNotes = value => String(value ?? "").trim() === legacyNotes ? defaultNotes : String(value ?? "");
function printTitle(data, count = 1, index = 0) {
  const first = Number(data.number) + index;
  const last = first + count - 1;
  const number = count > 1 ? `${first}-${last}-${data.year}` : `${first}-${data.year}`;
  const date = formatDate(data.date).replaceAll("/", "-");
  return `Pro forma ${number}${date ? ` - ${date}` : ""}`;
}
function printDocument(title) {
  document.title = title;
  window.print();
}
const blankItem = () => ({ id: crypto.randomUUID(), name: "", description: "", amount: "", auto: true, split: false, percentage: "50", allocation: null });

let items = [blankItem()];
let clients = [];
let saved = [];
const selectedSavedIds = new Set();
let projects = [];
let editingId = null;
let ready = false;
let logoSrc = "default-logo.svg";

function applyLogo(custom) {
  logoSrc = custom ? `/api/logo?v=${Date.now()}` : "default-logo.svg";
  document.querySelector("#brandLogo").src = logoSrc;
  document.querySelector("#logoPreview").src = logoSrc;
  document.querySelector("#logoStatus").textContent = custom ? "Logo personale caricato." : "Logo standard in uso.";
  removeLogoButton.disabled = !custom;
  update();
}

function storedItems(data) {
  if (Array.isArray(data.items) && data.items.length) return data.items.map(item => ({
    id: crypto.randomUUID(), name: item.name || "", description: item.description || "", amount: item.amount || "", auto: Boolean(item.auto), split: Boolean(item.split), percentage: item.percentage || "50", allocation: item.allocation || null
  }));
  // I documenti creati prima delle righe separate restano modificabili.
  return [{ id: crypto.randomUUID(), name: data.projects || "Prestazione", description: data.description || "", amount: data.amount || "", auto: false, split: false, percentage: "50", allocation: data.allocation || null }];
}

function renderItems() {
  itemContainer.innerHTML = items.map((item, index) => `<div class="project-card" data-id="${item.id}">
    <div class="project-card-head"><strong>Progetto ${index + 1}</strong><button type="button" class="text-button danger-text remove-project" ${items.length === 1 ? "disabled" : ""}>Rimuovi</button></div>
    <label for="name-${item.id}">Nome progetto</label><input id="name-${item.id}" data-field="name" list="savedProjectNames" value="${escapeHtml(item.name)}" placeholder="Es. Portale Demo">
    <button type="button" class="text-button save-project-name" ${ready ? "" : "disabled"}>Salva nome progetto</button>
    <label for="description-${item.id}">Descrizione della prestazione</label><textarea id="description-${item.id}" data-field="description" rows="3" placeholder="Prestazione professionale di consulenza e sviluppo software…">${escapeHtml(item.description)}</textarea>
    <button type="button" class="text-button generate-line">Rigenera descrizione</button>
    <label for="amount-${item.id}">Importo del progetto</label><div class="input-suffix"><input id="amount-${item.id}" data-field="amount" inputmode="decimal" autocomplete="off" value="${escapeHtml(item.amount)}" placeholder="153,00"><span>€</span></div>
    <div class="project-split-heading">Suddivisione</div><label class="check-row project-split-toggle"><input type="checkbox" data-field="split" ${item.split ? "checked" : ""}><span><strong>Dividi questo progetto in più pro forma</strong><small>Una quota per documento, fino al saldo</small></span></label>
    <div class="project-split-fields" ${item.split ? "" : "hidden"}><label for="percentage-${item.id}">Percentuale per quota</label><div class="input-suffix"><input id="percentage-${item.id}" data-field="percentage" inputmode="decimal" value="${escapeHtml(item.percentage)}"><span>%</span></div></div>
  </div>`).join("");
}

function itemDescription(item, invoiceIndex, invoiceCount, allocatedCents, projectCount) {
  if (!item.auto || !item.name.trim()) return item.description.trim();
  const allocation = invoiceCount === 1 && item.allocation ? item.allocation : null;
  const index = allocation ? allocation.index : invoiceIndex;
  const count = allocation ? allocation.count : invoiceCount;
  const original = allocation ? allocation.originalCents : parseEuro(item.amount);
  return projectLineDescription(item.name, { projectCount, index, count, percentage: original ? allocatedCents / original * 100 : 100 });
}

function calculateDraft() {
  let problem = "";
  const cents = items.map(item => parseEuro(item.amount));
  if (items.some(item => item.amount.trim() && parseEuro(item.amount) === null)) problem = "Ogni progetto deve avere un importo positivo con al massimo due decimali.";
  if (items.some(item => item.amount.trim() && !item.name.trim())) problem = "Inserisci il nome di ogni progetto.";
  const number = Number(field("number"));
  const year = Number(field("year"));
  if (!Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(year) || year < 2000 || year > 9999) problem = "Controlla il numero e l’anno del documento.";
  const percentages = items.map(item => item.split ? Number(item.percentage.replace(",", ".")) : null);
  if (items.some((item, index) => item.split && (!item.percentage.trim() || !Number.isFinite(percentages[index]) || percentages[index] <= 0 || percentages[index] >= 100))) problem = "La percentuale di ogni progetto diviso deve essere maggiore di 0 e minore di 100.";
  let invoices = [];
  if (!problem && cents.every(Boolean)) {
    try {
      const total = cents.reduce((sum, value) => sum + value, 0);
      if (!Number.isSafeInteger(total)) throw new Error("Il totale dei progetti è troppo elevato.");
      const matrix = splitProjects(cents, percentages);
      const shareCounts = cents.map((value, index) => percentages[index] == null ? 1 : splitAmount(value, percentages[index]).length);
      invoices = matrix.map((parts, invoiceIndex) => ({
        amounts: calculateInvoice(parts.reduce((sum, value) => sum + value, 0), form.elements.stamp.checked, form.elements.contribution.checked),
        rows: parts.map((amountCents, itemIndex) => ({
          item: items[itemIndex], amountCents, shareIndex: invoiceIndex, shareCount: shareCounts[itemIndex],
          description: itemDescription(items[itemIndex], invoiceIndex, shareCounts[itemIndex], amountCents, items.length)
        })).filter(row => row.amountCents > 0)
      }));
    } catch (caught) { problem = caught.message; }
  }
  if (invoices.some(invoice => invoice.rows.some(row => !row.description))) problem = "Inserisci la descrizione di ogni progetto.";
  const valid = Boolean(invoices.length && !problem && field("clientName") && field("date") && field("dueDate"));
  return { invoices, problem, valid };
}

function refreshAutoDescriptions() {
  items.forEach(item => {
    if (!item.auto) return;
    const amount = parseEuro(item.amount);
    let shares = amount ? [amount] : [];
    if (amount && item.split) {
      try { shares = splitAmount(amount, Number(item.percentage.replace(",", "."))); }
      catch { shares = [amount]; }
    }
    item.description = item.name.trim() ? itemDescription(item, 0, shares.length || 1, shares[0] || 0, items.length) : "";
    const textarea = itemContainer.querySelector(`[data-id="${item.id}"] [data-field="description"]`);
    if (textarea) textarea.value = item.description;
  });
}

function formattedDescription(description, projectName) {
  const name = String(projectName || "").trim();
  const label = name ? `progetto ${name}` : "";
  const index = label ? description.toLowerCase().indexOf(label.toLowerCase()) : -1;
  if (index < 0) return escapeHtml(description).replace(/\n/g, "<br>");
  return `${escapeHtml(description.slice(0, index))}<strong>${escapeHtml(description.slice(index, index + label.length))}</strong>${escapeHtml(description.slice(index + label.length))}`.replace(/\n/g, "<br>");
}

function documentHtml(invoice, index, count, data = null) {
  const get = data ? name => String(data[name] ?? "").trim() : field;
  const item = invoice.amounts;
  const number = Number(get("number")) + index;
  const serviceRows = invoice.rows.map(row => `<div class="service-row"><div>${formattedDescription(row.description, row.item?.name ?? row.name)}</div><div>${euro(row.amountCents)}</div></div>`).join("");
  return `<article class="invoice-page" aria-label="Pro forma n. ${number}/${escapeHtml(get("year"))}">
    <div class="invoice-top"><img class="invoice-logo" src="${escapeHtml(logoSrc)}" alt="Logo"><div class="invoice-meta"><div><strong>Pro forma n. ${number}/${escapeHtml(get("year"))}</strong></div><div>${escapeHtml(formatDate(get("date")))}</div></div></div>
    <div class="invoice-status"><div>Documento privo di valenza fiscale</div></div>
    <div class="parties"><div class="seller"><h3>${escapeHtml(get("sellerName"))}</h3>${line(get("sellerStreet"))}${line(get("sellerCity"))}${get("sellerTax") ? line(`C.F.: ${get("sellerTax")}`) : ""}${get("sellerVat") ? line(`P.IVA: ${get("sellerVat")}`) : ""}</div><div class="recipient"><div class="recipient-label">Destinatario:</div><h3>${escapeHtml(get("clientName"))}</h3>${line(get("clientStreet"))}${line(get("clientCity"))}${get("clientVat") ? line(`P.IVA / C.F.: ${get("clientVat")}`) : ""}</div></div>
    <div class="invoice-table"><div class="table-head"><strong>Descrizione</strong><strong>Importo</strong></div>${serviceRows}<div class="total-services"><span>Totale prestazioni:</span><span>${euro(item.serviceCents)}</span></div>${item.stampCents ? `<div class="table-row"><span>Marca da bollo</span><span>${euro(item.stampCents)}</span></div>` : ""}${item.contributionCents ? `<div class="table-row"><span>Rivalsa 4% GS INPS su ${euro(item.contributionBaseCents)}</span><span>${euro(item.contributionCents)}</span></div>` : ""}</div>
    <div class="invoice-total">Totale: <strong>${euro(item.totalCents)}</strong></div>
    <div class="invoice-footer"><div><h4>Modalità di pagamento</h4><p>Bonifico<br>Intestato a: ${escapeHtml(get("accountHolder"))}<br>IBAN: ${escapeHtml(get("iban"))}</p><p>Da saldare entro il ${escapeHtml(formatDate(get("dueDate")))}</p></div><div><h4>Note</h4><p>${escapeHtml(currentNotes(get("notes"))).replace(/\n/g, "<br>")}</p></div></div>
  </article>`;
}

function update() {
  const result = calculateDraft();
  error.textContent = result.problem;
  error.hidden = !result.problem;
  const { invoices } = result;
  document.querySelector("#previewHeading").textContent = invoices.length > 1 ? `${invoices.length} documenti pro forma` : "Pro forma";
  document.querySelector("#previewSummary").textContent = invoices.length ? `Totale complessivo ${euro(invoices.reduce((total, invoice) => total + invoice.amounts.totalCents, 0))}` : "";
  preview.innerHTML = invoices.length ? invoices.map((invoice, index) => `<div class="invoice-wrapper">${invoices.length > 1 ? `<div class="invoice-action"><span>Documento ${index + 1} di ${invoices.length}</span><button type="button" class="single-print">Salva questo PDF</button></div>` : ""}${documentHtml(invoice, index, invoices.length)}</div>`).join("") : `<div class="empty-preview"><div class="empty-icon">€</div><h3>La tua anteprima apparirà qui</h3><p>Inserisci i progetti e i rispettivi importi per iniziare.</p></div>`;
  printButton.disabled = !result.valid;
  saveButton.disabled = !result.valid || !ready;
  saveButton.textContent = editingId ? "Aggiorna pro forma" : invoices.length > 1 ? `Salva ${invoices.length} pro forma` : "Salva pro forma";
  document.querySelector("#editorMode").textContent = editingId ? "Modifica documento" : "Nuovo documento";
  return result;
}

function renderClients(selected = clientSelect.value) {
  clientSelect.innerHTML = `<option value="">Seleziona un cliente</option>${clients.slice().sort((a, b) => a.name.localeCompare(b.name, "it")).map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`).join("")}`;
  clientSelect.value = clients.some(client => client.id === selected) ? selected : "";
  document.querySelector("#deleteClient").disabled = !ready || !clientSelect.value;
  document.querySelector("#saveClient").disabled = !ready;
  clientSelect.disabled = !ready;
}

function renderProjectCatalog() {
  const names = projects.slice().sort((a, b) => a.name.localeCompare(b.name, "it"));
  document.querySelector("#savedProjectNames").innerHTML = names.map(project => `<option value="${escapeHtml(project.name)}"></option>`).join("");
  document.querySelector("#projectCatalog").innerHTML = names.length ? names.map(project => `<div class="project-chip"><button type="button" class="use-saved-project" data-id="${escapeHtml(project.id)}" title="Aggiungi ${escapeHtml(project.name)}">${escapeHtml(project.name)}</button><button type="button" class="delete-saved-project" data-id="${escapeHtml(project.id)}" aria-label="Rimuovi ${escapeHtml(project.name)} dai nomi salvati">×</button></div>`).join("") : `<span class="field-hint">Nessun nome salvato.</span>`;
  itemContainer.querySelectorAll(".save-project-name").forEach(button => { button.disabled = !ready; });
}

function recordAmounts(record) {
  const amounts = storedItems(record.fields).map(item => parseEuro(item.amount));
  if (amounts.some(value => !value)) return null;
  return calculateInvoice(amounts.reduce((a, b) => a + b, 0), record.fields.stamp, record.fields.contribution);
}
function renderArchiveSummary() {
  const selected = saved.filter(record => selectedSavedIds.has(record.id));
  archiveSummary.classList.toggle("is-empty", !selected.length);
  if (!selected.length) {
    archiveSummary.innerHTML = `<h3>Riepilogo selezione</h3><p>Seleziona le pro forma da sommare.</p>`;
    return;
  }
  const totals = { serviceCents: 0, stampCents: 0, contributionCents: 0, totalCents: 0 };
  const rows = selected.map(record => {
    const amounts = recordAmounts(record);
    if (amounts) for (const key of Object.keys(totals)) totals[key] += amounts[key];
    return `<div class="summary-row"><span>Pro forma n. ${escapeHtml(record.fields.number)}/${escapeHtml(record.fields.year)}</span><strong>${amounts ? euro(amounts.totalCents) : "Importo non valido"}</strong></div>`;
  }).join("");
  archiveSummary.innerHTML = `<div class="archive-summary-head"><h3>Riepilogo selezione</h3><span>${selected.length} document${selected.length === 1 ? "o" : "i"}</span></div><div class="summary-documents">${rows}</div><div class="summary-totals"><div class="summary-row"><span>Totale prestazioni</span><strong>${euro(totals.serviceCents)}</strong></div><div class="summary-row"><span>Totale marche da bollo</span><strong>${euro(totals.stampCents)}</strong></div><div class="summary-row"><span>Totale rivalsa</span><strong>${euro(totals.contributionCents)}</strong></div><div class="summary-row summary-grand"><span>Totale complessivo</span><strong>${euro(totals.totalCents)}</strong></div></div>`;
}
function renderSaved() {
  for (const id of selectedSavedIds) if (!saved.some(record => record.id === id)) selectedSavedIds.delete(id);
  document.querySelector("#archiveCount").textContent = `${saved.length} document${saved.length === 1 ? "o" : "i"}`;
  savedList.innerHTML = saved.length ? saved.map(record => {
    const data = record.fields;
    const projectRows = storedItems(data).map(item => {
      const amount = parseEuro(item.amount);
      return `<div class="saved-project">${escapeHtml(item.name || "Prestazione")} <b class="saved-project-amount">${amount ? euro(amount) : "—"}</b></div>`;
    }).join("");
    const amounts = recordAmounts(record);
    return `<div class="saved-card"><div class="saved-card-details"><div class="saved-card-heading"><input type="checkbox" class="select-record" data-id="${escapeHtml(record.id)}" aria-label="Includi pro forma ${escapeHtml(data.number)}/${escapeHtml(data.year)} nel riepilogo" ${selectedSavedIds.has(record.id) ? "checked" : ""}><strong>Pro forma n. ${escapeHtml(data.number)}/${escapeHtml(data.year)}</strong></div><span>${escapeHtml(data.clientName)} · ${escapeHtml(formatDate(data.date))}</span><div class="saved-projects">${projectRows}</div></div><div class="saved-card-right"><strong>${amounts ? euro(amounts.totalCents) : "—"}</strong><div class="saved-card-actions"><button type="button" class="text-button download-record" data-id="${escapeHtml(record.id)}">Scarica PDF</button><button type="button" class="text-button edit-record" data-id="${escapeHtml(record.id)}">Modifica</button><button type="button" class="text-button danger-text delete-record" data-id="${escapeHtml(record.id)}">Elimina</button></div></div></div>`;
  }).join("") : `<p class="archive-empty">Nessuna pro forma salvata. I documenti compariranno qui dopo il salvataggio.</p>`;
  renderArchiveSummary();
}
function nextNumber() {
  const year = field("year") || String(today.getFullYear());
  return Math.max(0, ...saved.filter(record => record.fields.year === year).map(record => Number(record.fields.number) || 0)) + 1;
}
function newInvoice() {
  editingId = null;
  items = [blankItem()];
  renderItems();
  form.elements.number.value = nextNumber();
  form.elements.date.value = localToday;
  form.elements.dueDate.value = localToday;
  update();
}
async function saveInvoices() {
  const { invoices, valid } = update();
  if (!valid) { showMessage("Completa i progetti, gli importi, il destinatario e le date prima di salvare.", true); return; }
  const base = { ...Object.fromEntries(fields.map(name => [name, name === "notes" ? currentNotes(field(name)) : field(name)])), ...Object.fromEntries(checks.map(name => [name, form.elements[name].checked])) };
  const batch = invoices.map((invoice, index) => ({
    id: editingId && index === 0 ? editingId : crypto.randomUUID(),
    fields: { ...base, number: String(Number(base.number) + index), items: invoice.rows.map(row => ({
      name: row.item.name, description: row.description, amount: moneyInput(row.amountCents), auto: row.item.auto, split: false, percentage: row.item.percentage,
      allocation: row.shareCount > 1 ? { index: row.shareIndex, count: row.shareCount, originalCents: parseEuro(row.item.amount) } : row.item.allocation
    })) }
  }));
  const collision = batch.find(record => saved.some(existing => existing.id !== record.id && existing.fields.number === record.fields.number && existing.fields.year === record.fields.year));
  if (collision) { showMessage(`La pro forma n. ${collision.fields.number}/${collision.fields.year} è già salvata. Cambia il numero iniziale.`, true); return; }
  ready = false; update();
  try {
    await apiRequest("POST", "invoices/batch", { records: batch, replaceId: editingId });
    [saved, projects] = await Promise.all([apiRequest("GET", "invoices"), apiRequest("GET", "projects")]);
    renderSaved(); renderProjectCatalog();
    newInvoice();
    showMessage(batch.length === 1 ? "Pro forma salvata in SQLite." : `${batch.length} pro forma salvate in SQLite.`);
  } catch (caught) { showMessage(caught.message, true); }
  finally { ready = true; renderProjectCatalog(); update(); }
}

itemContainer.addEventListener("input", event => {
  const card = event.target.closest(".project-card");
  if (!card) return;
  const item = items.find(candidate => candidate.id === card.dataset.id);
  const key = event.target.dataset.field;
  if (!item || !key) return;
  item[key] = key === "split" ? event.target.checked : event.target.value;
  if (key === "description") item.auto = false;
  else if (["name", "amount", "split", "percentage"].includes(key)) refreshAutoDescriptions();
  if (key === "split") card.querySelector(".project-split-fields").hidden = !item.split;
  showMessage("");
  update();
});
itemContainer.addEventListener("click", async event => {
  const card = event.target.closest(".project-card");
  if (!card) return;
  const item = items.find(candidate => candidate.id === card.dataset.id);
  if (event.target.closest(".remove-project") && items.length > 1) {
    items = items.filter(candidate => candidate.id !== item.id);
    renderItems(); refreshAutoDescriptions(); update();
  } else if (event.target.closest(".generate-line")) {
    item.auto = true;
    refreshAutoDescriptions(); update();
  } else if (event.target.closest(".save-project-name")) {
    const name = item.name.trim();
    if (!name) { showMessage("Inserisci il nome del progetto prima di salvarlo.", true); return; }
    if (projects.some(project => project.name.toLocaleLowerCase("it") === name.toLocaleLowerCase("it"))) { showMessage("Nome progetto già salvato."); return; }
    try {
      await apiRequest("POST", "projects", { id: crypto.randomUUID(), name });
      projects = await apiRequest("GET", "projects");
      renderProjectCatalog();
      showMessage("Nome progetto salvato in SQLite.");
    } catch (caught) { showMessage(caught.message, true); }
  }
});
document.querySelector("#addProject").addEventListener("click", () => {
  items.push(blankItem());
  renderItems(); refreshAutoDescriptions(); update();
  itemContainer.querySelector(".project-card:last-child [data-field=name]").focus();
});
form.addEventListener("input", () => { showMessage(""); update(); });
form.addEventListener("change", update);

document.querySelector("#projectCatalog").addEventListener("click", async event => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const project = projects.find(entry => entry.id === button.dataset.id);
  if (!project) return;
  if (button.classList.contains("delete-saved-project")) {
    if (!confirm(`Rimuovere “${project.name}” dai nomi salvati? Le pro forma esistenti non cambieranno.`)) return;
    try {
      await apiRequest("DELETE", `projects/${project.id}`);
      projects = await apiRequest("GET", "projects");
      renderProjectCatalog();
      showMessage("Nome progetto rimosso dall’elenco.");
    } catch (caught) { showMessage(caught.message, true); }
    return;
  }
  let item = items.find(entry => !entry.name.trim() && !entry.amount.trim());
  if (!item) { item = blankItem(); items.push(item); }
  item.name = project.name;
  renderItems(); refreshAutoDescriptions(); update();
});
form.addEventListener("submit", event => event.preventDefault());
document.querySelector("#newInvoice").addEventListener("click", () => { newInvoice(); showMessage(""); });
saveButton.addEventListener("click", saveInvoices);
saveProfileButton.addEventListener("click", async () => {
  const profile = Object.fromEntries(profileFields.map(name => [name, field(name)]));
  saveProfileButton.disabled = true;
  try {
    await apiRequest("PUT", "profile", profile);
    showMessage("Intestazione e pagamento salvati nell’archivio locale.");
  } catch (caught) { showMessage(caught.message, true); }
  finally { saveProfileButton.disabled = false; }
});
logoInput.addEventListener("change", async () => {
  const file = logoInput.files?.[0];
  if (!file) return;
  logoInput.disabled = true;
  try {
    const response = await fetch("/api/logo", { method: "POST", headers: { "Content-Type": file.type }, body: file });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Impossibile salvare il logo");
    applyLogo(true);
    showMessage("Logo salvato nell’archivio locale.");
  } catch (caught) { showMessage(caught.message, true); }
  finally { logoInput.disabled = false; logoInput.value = ""; }
});
removeLogoButton.addEventListener("click", async () => {
  removeLogoButton.disabled = true;
  try {
    await apiRequest("DELETE", "logo");
    applyLogo(false);
    showMessage("Logo standard ripristinato.");
  } catch (caught) { removeLogoButton.disabled = false; showMessage(caught.message, true); }
});
printButton.addEventListener("click", () => {
  const draft = update();
  if (draft.valid) printDocument(printTitle({ number: field("number"), year: field("year"), date: field("date") }, draft.invoices.length));
});
preview.addEventListener("click", event => {
  const button = event.target.closest(".single-print");
  if (!button) return;
  const index = Array.from(preview.querySelectorAll(".single-print")).indexOf(button);
  if (!update().valid) return;
  preview.querySelectorAll(".invoice-wrapper")[index]?.classList.add("print-selected");
  document.body.classList.add("printing-one");
  printDocument(printTitle({ number: field("number"), year: field("year"), date: field("date") }, 1, index));
});
window.addEventListener("afterprint", () => { document.title = pageTitle; document.body.classList.remove("printing-one", "printing-saved"); document.querySelector(".print-selected")?.classList.remove("print-selected"); savedPrintRoot.innerHTML = ""; });
clientSelect.addEventListener("change", () => {
  const client = clients.find(item => item.id === clientSelect.value);
  if (client) for (const name of clientFields) form.elements[name].value = client[name] || "";
  document.querySelector("#deleteClient").disabled = !ready || !client;
  update();
});
document.querySelector("#newClient").addEventListener("click", () => {
  clientSelect.value = "";
  for (const name of clientFields) form.elements[name].value = "";
  document.querySelector("#deleteClient").disabled = true;
  form.elements.clientName.focus(); update();
});
document.querySelector("#saveClient").addEventListener("click", async () => {
  if (!field("clientName")) { showMessage("Inserisci il nome del cliente prima di salvarlo.", true); return; }
  const client = { id: clientSelect.value || crypto.randomUUID(), name: field("clientName"), ...Object.fromEntries(clientFields.map(name => [name, field(name)])) };
  const updating = Boolean(clientSelect.value);
  ready = false; renderClients(client.id); update();
  try {
    await apiRequest(updating ? "PUT" : "POST", updating ? `clients/${client.id}` : "clients", client);
    clients = await apiRequest("GET", "clients");
    showMessage("Cliente salvato in SQLite.");
  } catch (caught) { showMessage(caught.message, true); }
  finally { ready = true; renderClients(client.id); update(); }
});
document.querySelector("#deleteClient").addEventListener("click", async () => {
  const client = clients.find(item => item.id === clientSelect.value);
  if (!client || !confirm(`Eliminare il cliente “${client.name}”? Le pro forma già salvate resteranno disponibili.`)) return;
  ready = false; renderClients(client.id); update();
  try {
    await apiRequest("DELETE", `clients/${client.id}`);
    clients = await apiRequest("GET", "clients");
    showMessage("Cliente eliminato dall’archivio.");
  } catch (caught) { showMessage(caught.message, true); }
  finally { ready = true; renderClients(""); update(); }
});
savedList.addEventListener("change", event => {
  const checkbox = event.target.closest(".select-record");
  if (!checkbox) return;
  if (checkbox.checked) selectedSavedIds.add(checkbox.dataset.id);
  else selectedSavedIds.delete(checkbox.dataset.id);
  renderArchiveSummary();
});
savedList.addEventListener("click", async event => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const record = saved.find(item => item.id === button.dataset.id);
  if (!record) return;
  if (button.classList.contains("download-record")) {
    const recordItems = storedItems(record.fields);
    const amounts = recordItems.map(item => parseEuro(item.amount));
    if (amounts.some(amount => !amount)) { showMessage("La pro forma salvata ha un importo non valido.", true); return; }
    const invoice = {
      amounts: calculateInvoice(amounts.reduce((sum, amount) => sum + amount, 0), record.fields.stamp, record.fields.contribution),
      rows: recordItems.map((item, index) => ({
        name: item.name,
        description: item.auto && item.name.trim() ? itemDescription(item, 0, 1, amounts[index], recordItems.length) : item.description,
        amountCents: amounts[index]
      }))
    };
    savedPrintRoot.innerHTML = `<div class="invoice-wrapper">${documentHtml(invoice, 0, 1, record.fields)}</div>`;
    document.body.classList.add("printing-saved");
    printDocument(printTitle(record.fields));
    return;
  }
  if (button.classList.contains("delete-record")) {
    if (!confirm(`Eliminare la pro forma n. ${record.fields.number}/${record.fields.year}?`)) return;
    ready = false; update();
    try {
      await apiRequest("DELETE", `invoices/${record.id}`);
      saved = await apiRequest("GET", "invoices");
      if (editingId === record.id) newInvoice();
      renderSaved(); showMessage("Pro forma eliminata dall’archivio.");
    } catch (caught) { showMessage(caught.message, true); }
    finally { ready = true; update(); }
    return;
  }
  editingId = record.id;
  for (const name of fields) form.elements[name].value = name === "notes" ? currentNotes(record.fields[name]) : record.fields[name] ?? "";
  for (const name of checks) form.elements[name].checked = Boolean(record.fields[name]);
  items = storedItems(record.fields);
  renderItems(); refreshAutoDescriptions();
  clientSelect.value = "";
  document.querySelector("#deleteClient").disabled = true;
  update();
  showMessage(`Stai modificando la pro forma n. ${record.fields.number}/${record.fields.year}.`);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
});

async function bootstrap() {
  renderItems(); renderClients(); renderSaved(); update();
  logoInput.disabled = true;
  saveProfileButton.disabled = true;
  try {
    const imported = await migrateBrowserData();
    const [loadedClients, loadedSaved, loadedProjects, profile, logo] = await Promise.all([
      apiRequest("GET", "clients"), apiRequest("GET", "invoices"), apiRequest("GET", "projects"),
      apiRequest("GET", "profile"), apiRequest("GET", "logo/info")
    ]);
    clients = loadedClients; saved = loadedSaved; projects = loadedProjects;
    for (const name of profileFields) if (name in profile) form.elements[name].value = name === "notes" ? currentNotes(profile[name]) : profile[name];
    ready = true;
    logoInput.disabled = false;
    saveProfileButton.disabled = false;
    applyLogo(logo.custom);
    renderClients(); renderSaved(); renderProjectCatalog(); update();
    if (imported && (imported.clients || imported.invoices)) showMessage(`Archivio precedente importato: ${imported.clients} clienti e ${imported.invoices} pro forma.`);
  } catch (caught) { showMessage(`Archivio SQLite non disponibile: ${caught.message}`, true); }
}
bootstrap();
