export async function apiRequest(method, path, body) {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Errore del server (${response.status})`);
  return data;
}

export async function migrateBrowserData() {
  const marker = "prefattura.sqlite.migrated.v1";
  let source;
  try {
    if (localStorage.getItem(marker)) return null;
    const clients = JSON.parse(localStorage.getItem("prefattura.clients.v1") || "[]");
    const invoices = JSON.parse(localStorage.getItem("prefattura.documents.v1") || "[]");
    source = { clients: Array.isArray(clients) ? clients : [], invoices: Array.isArray(invoices) ? invoices : [] };
  } catch { return null; }
  if (!source.clients.length && !source.invoices.length) return null;
  const imported = await apiRequest("POST", "import", source);
  try { localStorage.setItem(marker, "1"); } catch { /* SQLite resta disponibile. */ }
  return imported;
}
