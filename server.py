"""Server locale e archivio SQLite per i documenti pro forma."""

import json
import os
import sqlite3
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("PREFATTURA_DB_PATH", ROOT / "data" / "prefattura.sqlite3"))
PUBLIC_FILES = {"index.html", "app.js", "api.js", "calculations.js", "description.js", "styles.css", "default-logo.svg"}
MAX_BODY = 2 * 1024 * 1024
PROFILE_FIELDS = ("sellerName", "sellerStreet", "sellerCity", "sellerTax", "sellerVat", "accountHolder", "iban", "notes")
LOGO_EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def logo_mime(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def connect(db_path=DB_PATH):
    connection = sqlite3.connect(db_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db(db_path=DB_PATH):
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with connect(db_path) as db:
        db.execute("CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, payload TEXT NOT NULL)")
        db.execute("""CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY, year INTEGER NOT NULL, number INTEGER NOT NULL,
            payload TEXT NOT NULL, UNIQUE(year, number)
        )""")
        if not db.execute("SELECT 1 FROM schema_meta WHERE key = 'project_names_backfilled'").fetchone():
            for row in db.execute("SELECT payload FROM invoices"):
                for name in invoice_project_names(json.loads(row["payload"])):
                    insert_project_name(db, name)
            db.execute("INSERT INTO schema_meta (key, value) VALUES ('project_names_backfilled', '1')")


def invoice_project_names(record):
    fields = record.get("fields", {})
    if isinstance(fields.get("items"), list):
        names = [item.get("name", "") for item in fields["items"] if isinstance(item, dict)]
    else:
        names = str(fields.get("projects", "")).split(",")
    return [name.strip() for name in names if isinstance(name, str) and name.strip()]


def insert_project_name(db, name):
    project = {"id": str(uuid4()), "name": name}
    db.execute("INSERT OR IGNORE INTO projects (id, name, payload) VALUES (?, ?, ?)",
               (project["id"], name, json.dumps(project, ensure_ascii=False)))


def validate_uuid(value):
    if not isinstance(value, str):
        raise ValueError("ID non valido")
    try:
        UUID(value)
    except ValueError as exc:
        raise ValueError("ID non valido") from exc
    return value


def validate_record(kind, value):
    if not isinstance(value, dict):
        raise ValueError("Dati non validi")
    validate_uuid(value.get("id"))
    if kind == "clients":
        name = value.get("clientName") or value.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Nome cliente obbligatorio")
        return value["id"], None, None
    if kind == "projects":
        name = value.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 200:
            raise ValueError("Nome progetto non valido")
        return value["id"], None, None
    fields = value.get("fields")
    if not isinstance(fields, dict):
        raise ValueError("Dati della pro forma non validi")
    try:
        number, year = int(fields["number"]), int(fields["year"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Numero o anno non validi") from exc
    if number < 1 or not 2000 <= year <= 9999:
        raise ValueError("Numero o anno non validi")
    return value["id"], year, number


class Handler(SimpleHTTPRequestHandler):
    db_path = DB_PATH

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body_json(self):
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            raise ValueError("Content-Type application/json richiesto")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Dimensione richiesta non valida") from exc
        if length < 1 or length > MAX_BODY:
            raise ValueError("Dimensione richiesta non valida")
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as exc:
            raise ValueError("JSON non valido") from exc

    def api_route(self):
        parts = urlsplit(self.path).path.strip("/").split("/")
        if len(parts) < 2 or parts[0] != "api":
            return None, None
        return parts[1], parts[2] if len(parts) == 3 else None

    def logo_file(self):
        folder = Path(self.db_path).parent / "assets"
        for mime, extension in LOGO_EXTENSIONS.items():
            path = folder / f"logo{extension}"
            if path.is_file():
                return path, mime
        return None, None

    def send_logo(self):
        path, mime = self.logo_file()
        if path is None:
            self.respond(HTTPStatus.NOT_FOUND, {"error": "Logo personalizzato non presente"})
            return
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def save_logo(self):
        mime = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if mime not in LOGO_EXTENSIONS:
            raise ValueError("Carica un'immagine PNG, JPG o WebP")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Dimensione del logo non valida") from exc
        if length < 1 or length > MAX_BODY:
            raise ValueError("Il logo deve essere più piccolo di 2 MB")
        data = self.rfile.read(length)
        if logo_mime(data) != mime:
            raise ValueError("Formato del logo non valido")
        folder = Path(self.db_path).parent / "assets"
        folder.mkdir(parents=True, exist_ok=True)
        destination = folder / f"logo{LOGO_EXTENSIONS[mime]}"
        temporary = folder / f".logo-{uuid4().hex}"
        try:
            temporary.write_bytes(data)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        for extension in LOGO_EXTENSIONS.values():
            if extension != LOGO_EXTENSIONS[mime]:
                (folder / f"logo{extension}").unlink(missing_ok=True)
        self.respond(HTTPStatus.OK, {"custom": True})

    def do_GET(self):
        kind, record_id = self.api_route()
        if kind == "profile" and record_id is None:
            with connect(self.db_path) as db:
                row = db.execute("SELECT payload FROM settings WHERE key = 'profile'").fetchone()
            self.respond(HTTPStatus.OK, json.loads(row["payload"]) if row else {})
            return
        if kind == "logo" and record_id == "info":
            path, _ = self.logo_file()
            self.respond(HTTPStatus.OK, {"custom": path is not None})
            return
        if kind == "logo" and record_id is None:
            self.send_logo()
            return
        if kind in ("clients", "invoices", "projects") and record_id is None:
            with connect(self.db_path) as db:
                rows = db.execute(f"SELECT payload FROM {kind} ORDER BY rowid DESC").fetchall()
            self.respond(HTTPStatus.OK, [json.loads(row["payload"]) for row in rows])
            return
        if self.path.startswith("/api/"):
            self.respond(HTTPStatus.NOT_FOUND, {"error": "Risorsa non trovata"})
            return
        path = urlsplit(self.path).path.lstrip("/") or "index.html"
        if path not in PUBLIC_FILES:
            self.send_error(HTTPStatus.NOT_FOUND, "File non trovato")
            return
        self.path = "/" + path
        super().do_GET()

    def do_HEAD(self):
        path = urlsplit(self.path).path.lstrip("/") or "index.html"
        if path not in PUBLIC_FILES:
            self.send_error(HTTPStatus.NOT_FOUND, "File non trovato")
            return
        self.path = "/" + path
        super().do_HEAD()

    def do_POST(self):
        kind, record_id = self.api_route()
        try:
            if kind == "logo" and record_id is None:
                self.save_logo()
                return
            payload = self.body_json()
            if kind == "import" and record_id is None:
                self.import_data(payload)
                return
            if kind == "invoices" and record_id == "batch":
                self.save_invoice_batch(payload)
                return
            if kind not in ("clients", "invoices", "projects") or record_id is not None:
                self.respond(HTTPStatus.NOT_FOUND, {"error": "Risorsa non trovata"})
                return
            self.insert_record(kind, payload)
        except ValueError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except sqlite3.IntegrityError:
            self.respond(HTTPStatus.CONFLICT, {"error": "Nome progetto già salvato" if kind == "projects" else "Cliente o numero di pro forma già presente"})

    def do_PUT(self):
        kind, record_id = self.api_route()
        try:
            if kind == "profile" and record_id is None:
                payload = self.body_json()
                if not isinstance(payload, dict) or any(not isinstance(payload.get(key, ""), str) or len(payload.get(key, "")) > 5000 for key in PROFILE_FIELDS):
                    raise ValueError("Dati dell'intestazione non validi")
                profile = {key: payload.get(key, "").strip() for key in PROFILE_FIELDS}
                with connect(self.db_path) as db:
                    db.execute("INSERT INTO settings (key, payload) VALUES ('profile', ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload", (json.dumps(profile, ensure_ascii=False),))
                self.respond(HTTPStatus.OK, profile)
                return
            if kind not in ("clients", "invoices", "projects") or not record_id:
                self.respond(HTTPStatus.NOT_FOUND, {"error": "Risorsa non trovata"})
                return
            payload = self.body_json()
            object_id, year, number = validate_record(kind, payload)
            if object_id != record_id:
                raise ValueError("ID del documento non coerente")
            encoded = json.dumps(payload, ensure_ascii=False)
            with connect(self.db_path) as db:
                if kind == "clients":
                    cursor = db.execute("UPDATE clients SET payload = ? WHERE id = ?", (encoded, object_id))
                elif kind == "projects":
                    cursor = db.execute("UPDATE projects SET name = ?, payload = ? WHERE id = ?", (payload["name"].strip(), encoded, object_id))
                else:
                    cursor = db.execute("UPDATE invoices SET year = ?, number = ?, payload = ? WHERE id = ?", (year, number, encoded, object_id))
            if not cursor.rowcount:
                self.respond(HTTPStatus.NOT_FOUND, {"error": "Elemento non trovato"})
            else:
                self.respond(HTTPStatus.OK, payload)
        except ValueError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except sqlite3.IntegrityError:
            self.respond(HTTPStatus.CONFLICT, {"error": "Nome progetto già salvato" if kind == "projects" else "Numero di pro forma già presente"})

    def do_DELETE(self):
        kind, record_id = self.api_route()
        if kind == "logo" and record_id is None:
            folder = Path(self.db_path).parent / "assets"
            for extension in LOGO_EXTENSIONS.values():
                (folder / f"logo{extension}").unlink(missing_ok=True)
            self.respond(HTTPStatus.OK, {"custom": False})
            return
        if kind not in ("clients", "invoices", "projects") or not record_id:
            self.respond(HTTPStatus.NOT_FOUND, {"error": "Risorsa non trovata"})
            return
        try:
            validate_uuid(record_id)
        except ValueError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        with connect(self.db_path) as db:
            cursor = db.execute(f"DELETE FROM {kind} WHERE id = ?", (record_id,))
        if cursor.rowcount:
            self.respond(HTTPStatus.OK, {"deleted": record_id})
        else:
            self.respond(HTTPStatus.NOT_FOUND, {"error": "Elemento non trovato"})

    def insert_record(self, kind, payload):
        object_id, year, number = validate_record(kind, payload)
        encoded = json.dumps(payload, ensure_ascii=False)
        with connect(self.db_path) as db:
            if kind == "clients":
                db.execute("INSERT INTO clients (id, payload) VALUES (?, ?)", (object_id, encoded))
            elif kind == "projects":
                db.execute("INSERT INTO projects (id, name, payload) VALUES (?, ?, ?)", (object_id, payload["name"].strip(), encoded))
            else:
                db.execute("INSERT INTO invoices (id, year, number, payload) VALUES (?, ?, ?, ?)", (object_id, year, number, encoded))
                for name in invoice_project_names(payload):
                    insert_project_name(db, name)
        self.respond(HTTPStatus.CREATED, payload)

    def import_data(self, payload):
        if not isinstance(payload, dict) or not all(isinstance(payload.get(kind, []), list) for kind in ("clients", "invoices")):
            raise ValueError("Dati di importazione non validi")
        result = {"clients": 0, "invoices": 0}
        with connect(self.db_path) as db:
            for kind in ("clients", "invoices"):
                for record in payload.get(kind, []):
                    try:
                        object_id, year, number = validate_record(kind, record)
                    except ValueError:
                        continue
                    encoded = json.dumps(record, ensure_ascii=False)
                    if kind == "clients":
                        cursor = db.execute("INSERT OR IGNORE INTO clients (id, payload) VALUES (?, ?)", (object_id, encoded))
                    else:
                        cursor = db.execute("INSERT OR IGNORE INTO invoices (id, year, number, payload) VALUES (?, ?, ?, ?)", (object_id, year, number, encoded))
                        if cursor.rowcount:
                            for name in invoice_project_names(record):
                                insert_project_name(db, name)
                    result[kind] += cursor.rowcount
        self.respond(HTTPStatus.OK, result)

    def save_invoice_batch(self, payload):
        if not isinstance(payload, dict) or not isinstance(payload.get("records"), list) or not payload["records"]:
            raise ValueError("Pro forma non valide")
        records = payload["records"]
        if len(records) > 100:
            raise ValueError("Sono consentite al massimo 100 pro forma")
        validated = [validate_record("invoices", record) for record in records]
        replacement = payload.get("replaceId")
        if replacement is not None:
            validate_uuid(replacement)
            if replacement != validated[0][0]:
                raise ValueError("ID della pro forma da aggiornare non coerente")
        with connect(self.db_path) as db:
            for index, (record, (object_id, year, number)) in enumerate(zip(records, validated)):
                encoded = json.dumps(record, ensure_ascii=False)
                if index == 0 and replacement:
                    cursor = db.execute("UPDATE invoices SET year = ?, number = ?, payload = ? WHERE id = ?", (year, number, encoded, object_id))
                    if not cursor.rowcount:
                        raise ValueError("Pro forma da aggiornare non trovata")
                else:
                    db.execute("INSERT INTO invoices (id, year, number, payload) VALUES (?, ?, ?, ?)", (object_id, year, number, encoded))
                for name in invoice_project_names(record):
                    insert_project_name(db, name)
        self.respond(HTTPStatus.CREATED, records)


def main():
    init_db()
    port = int(os.environ.get("PREFATTURA_PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"PrimaForma: http://localhost:{port} | SQLite: {DB_PATH}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
