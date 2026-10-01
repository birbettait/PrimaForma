# PrimaForma

App locale per creare, suddividere e archiviare documenti pro forma in PDF.

## Avvio

Serve Python 3 con SQLite, incluso nella libreria standard. Dalla cartella del progetto:

```bash
python3 server.py
```

Apri <http://localhost:8000>. Il server ascolta solo sul computer locale. Puoi anche usare `npm start` se hai Node.js installato.

## Funzioni

- Aggiungi più progetti a un documento, ciascuno con descrizione e importo propri. La descrizione può essere generata dal nome del progetto e poi modificata.
- Dividi ogni progetto in quote percentuali su più documenti. Le descrizioni automatiche indicano quota e saldo solo per i progetti divisi.
- Attiva separatamente marca da bollo da 2,00 € e rivalsa GS INPS del 4%. Sono calcolate una volta per documento sul totale dei progetti; la rivalsa include l’eventuale bollo nella base.
- Salva, modifica ed elimina pro forma, clienti e nomi progetto. Seleziona i documenti nell’archivio per vedere il riepilogo dei loro importi.
- Stampa o salva in PDF l’anteprima intera, un singolo documento oppure una pro forma archiviata. Il PDF mostra “Pro forma n. …” e “Documento privo di valenza fiscale”.

## Dati locali e personalizzazione

L’archivio è in `data/prefattura.sqlite3`. Da **Intestazione e pagamento** puoi salvare i dati dell’emittente e caricare un logo PNG, JPG o WebP; il logo viene conservato in `data/assets/`. Senza un logo caricato, l’app usa `default-logo.svg`.

Il codice contiene solo campi vuoti con esempi fittizi. La cartella `data/`, i PDF e i file di lavoro del browser sono esclusi da Git. Le pro forma salvate conservano una copia dei dati del cliente e dell’emittente usati al momento del salvataggio.

## Test

Con Node.js disponibile:

```bash
npm test
```
