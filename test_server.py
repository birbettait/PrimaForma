import base64
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from server import Handler, init_db


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        db_path = Path(self.temp.name) / "prefattura.sqlite3"
        init_db(db_path)
        handler = type("TestHandler", (Handler,), {"db_path": db_path})
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, method, path, data=None):
        body = json.dumps(data).encode() if data is not None else None
        request = Request(self.base + path, data=body, method=method, headers={"Content-Type": "application/json"} if body else {})
        try:
            with urlopen(request) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            if error.headers.get_content_type() == "application/json":
                return error.code, json.load(error)
            return error.code, error.read().decode()

    def test_clients_are_persistent_and_editable(self):
        client = {"id": str(uuid4()), "name": "Cliente Demo", "clientName": "Cliente Demo", "clientVat": "00000000000"}
        self.assertEqual(self.request("POST", "/api/clients", client)[0], 201)
        self.assertEqual(self.request("GET", "/api/clients")[1][0]["clientVat"], "00000000000")
        client["clientVat"] = "11111111111"
        self.assertEqual(self.request("PUT", f"/api/clients/{client['id']}", client)[0], 200)
        self.assertEqual(self.request("GET", "/api/clients")[1][0]["clientVat"], "11111111111")
        self.assertEqual(self.request("DELETE", f"/api/clients/{client['id']}")[0], 200)
        self.assertEqual(self.request("GET", "/api/clients")[1], [])

    def test_batch_is_atomic_and_numbers_are_unique(self):
        first = {"id": str(uuid4()), "fields": {"year": "2026", "number": "17", "items": [{"name": "Alfa", "amount": "120,00"}]}}
        second = {"id": str(uuid4()), "fields": {"year": "2026", "number": "18", "items": [{"name": "Beta", "amount": "80,00"}]}}
        self.assertEqual(self.request("POST", "/api/invoices/batch", {"records": [first, second]})[0], 201)
        duplicate = {"id": str(uuid4()), "fields": {"year": "2026", "number": "18"}}
        extra = {"id": str(uuid4()), "fields": {"year": "2026", "number": "19"}}
        self.assertEqual(self.request("POST", "/api/invoices/batch", {"records": [extra, duplicate]})[0], 409)
        self.assertEqual(len(self.request("GET", "/api/invoices")[1]), 2)
        first["fields"]["number"] = "20"
        self.assertEqual(self.request("POST", "/api/invoices/batch", {"records": [first], "replaceId": first["id"]})[0], 201)
        self.assertEqual(self.request("DELETE", f"/api/invoices/{second['id']}")[0], 200)
        self.assertEqual(self.request("GET", "/api/invoices")[1][0]["fields"]["number"], "20")

    def test_database_file_is_not_served(self):
        self.assertEqual(self.request("GET", "/data/prefattura.sqlite3")[0], 404)

    def test_imports_previous_browser_data_once(self):
        client = {"id": str(uuid4()), "name": "Cliente Demo", "clientName": "Cliente Demo"}
        invoice = {"id": str(uuid4()), "fields": {"year": "2026", "number": "17", "amount": "1.139,00"}}
        payload = {"clients": [client], "invoices": [invoice]}
        self.assertEqual(self.request("POST", "/api/import", payload)[1], {"clients": 1, "invoices": 1})
        self.assertEqual(self.request("POST", "/api/import", payload)[1], {"clients": 0, "invoices": 0})
        self.assertEqual(self.request("GET", "/api/invoices")[1][0]["fields"]["amount"], "1.139,00")

    def test_project_names_are_saved_and_can_be_removed(self):
        project = {"id": str(uuid4()), "name": "Alfa"}
        self.assertEqual(self.request("POST", "/api/projects", project)[0], 201)
        self.assertEqual(self.request("GET", "/api/projects")[1][0]["name"], "Alfa")
        invoice = {"id": str(uuid4()), "fields": {"year": "2026", "number": "17", "items": [{"name": "Beta", "amount": "80,00"}]}}
        self.assertEqual(self.request("POST", "/api/invoices/batch", {"records": [invoice]})[0], 201)
        self.assertEqual({item["name"] for item in self.request("GET", "/api/projects")[1]}, {"Alfa", "Beta"})
        self.assertEqual(self.request("DELETE", f"/api/projects/{project['id']}")[0], 200)
        init_db(self.server.RequestHandlerClass.db_path)
        self.assertEqual([item["name"] for item in self.request("GET", "/api/projects")[1]], ["Beta"])

    def test_local_profile_and_logo_are_persistent(self):
        profile = {"sellerName": "Studio Demo", "iban": "DEMO"}
        self.assertEqual(self.request("PUT", "/api/profile", profile)[0], 200)
        self.assertEqual(self.request("GET", "/api/profile")[1]["sellerName"], "Studio Demo")
        image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9KkZQAAAAASUVORK5CYII=")
        request = Request(self.base + "/api/logo", data=image, method="POST", headers={"Content-Type": "image/png"})
        with urlopen(request) as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(self.request("GET", "/api/logo/info")[1], {"custom": True})
        with urlopen(self.base + "/api/logo") as response:
            self.assertEqual(response.headers.get_content_type(), "image/png")
            self.assertEqual(response.read(), image)
        init_db(self.server.RequestHandlerClass.db_path)
        self.assertEqual(self.request("GET", "/api/profile")[1]["iban"], "DEMO")
        self.assertEqual(self.request("DELETE", "/api/logo")[1], {"custom": False})
        self.assertEqual(self.request("GET", "/api/logo/info")[1], {"custom": False})


if __name__ == "__main__":
    unittest.main()
