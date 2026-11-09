"""HR emails a worker: worded here, delivered by n8n, and every send is logged."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx2 as httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.routes.worker_mail import mail_transport
from tests.support import CEO, HR_MANAGER, sign_in

CODE = "EMP-0088"  # Sanjeev Rana: his residency visa ends in 7 days on the demo date
KEY = "k" * 40


class Desk:
    def __init__(self, make_client: Callable[..., TestClient], engine: Engine) -> None:
        self.engine = engine
        self.manager = make_client(n8n_hmac_secret=KEY)
        self.ceo = make_client(n8n_hmac_secret=KEY)
        self.bare = make_client(n8n_hmac_secret="")
        sign_in(self.manager, HR_MANAGER)
        sign_in(self.ceo, CEO)
        sign_in(self.bare, HR_MANAGER)
        self.calls: list[httpx.Request] = []
        self.answer = 200

    def n8n(self, answer: int | Exception = 200) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.calls.append(request)
            if isinstance(answer, Exception):
                raise answer
            return httpx.Response(answer, json={"ok": answer < 400})

        transport = httpx.MockTransport(handler)
        for client in (self.manager, self.ceo, self.bare):
            app: FastAPI = client.app  # type: ignore[assignment]
            app.dependency_overrides[mail_transport] = lambda: transport

    def give_email(self, address: str = "worker@example.test") -> None:
        response = self.manager.patch(f"/workers/{CODE}", json={"email": address})
        assert response.status_code == 200, response.text

    def one(self, sql: str, **params: Any) -> Any:
        with self.engine.connect() as c:
            return c.execute(text(sql), params).scalar_one()


@pytest.fixture
def desk(make_client: Callable[..., TestClient], migrated_db: Engine) -> Desk:
    return Desk(make_client, migrated_db)


RENEWAL = {"template": "document_renewal"}


def test_the_email_is_saved_on_the_worker_and_checked(desk: Desk) -> None:
    assert desk.manager.patch(f"/workers/{CODE}", json={"email": "not an email"}).status_code == 422
    done = desk.manager.patch(f"/workers/{CODE}", json={"email": " Worker@Example.TEST "})
    assert done.status_code == 200 and done.json()["email"] == "worker@example.test"
    cleared = desk.manager.patch(f"/workers/{CODE}", json={"email": None})
    assert cleared.json()["email"] is None


def test_the_preview_is_the_exact_message_and_sends_nothing(desk: Desk) -> None:
    desk.n8n()
    desk.give_email()
    shown = desk.manager.post(f"/workers/{CODE}/email/preview", json=RENEWAL)
    assert shown.status_code == 200, shown.text
    mail = shown.json()
    assert mail["to"] == "worker@example.test"
    assert mail["subject"] == "Please renew your document"
    assert "Hello Sanjeev," in mail["body"]
    assert "Residency visa: 12 Nov 2026 (expires in 7 days)" in mail["body"]
    assert "Mr Imtiyaz" in mail["body"]  # signed by whoever sends it
    assert desk.calls == []


def test_sending_hands_the_finished_message_to_n8n_with_the_key_and_logs_it(desk: Desk) -> None:
    desk.n8n()
    desk.give_email()
    sent = desk.manager.post(f"/workers/{CODE}/email", json=RENEWAL)
    assert sent.status_code == 200 and sent.json()["sent"] is True
    (call,) = desk.calls
    assert call.url.path == "/webhook/hamra-send-email"
    assert call.headers["x-hamra-key"] == KEY
    body = json.loads(call.content)
    assert body["to"] == "worker@example.test" and body["subject"] == "Please renew your document"
    assert "Residency visa" in body["text"] and body["sent_by"] == "Mr Imtiyaz"
    assert KEY not in sent.text
    row = desk.one(
        "SELECT event || ':' || delivered::text FROM notifications ORDER BY created_at DESC LIMIT 1"
    )
    assert row == "document.renewal_request:true"
    assert desk.one("SELECT count(*) FROM audit_log WHERE action = 'worker.emailed'") == 1


def test_a_custom_message_needs_a_subject_and_words(desk: Desk) -> None:
    desk.n8n()
    desk.give_email()
    bad = desk.manager.post(f"/workers/{CODE}/email", json={"template": "custom", "message": "Hi"})
    assert bad.status_code == 422 and "subject" in bad.text.lower()
    good = desk.manager.post(
        f"/workers/{CODE}/email",
        json={"template": "custom", "subject": "Site meeting", "message": "Please come at 7."},
    )
    assert good.status_code == 200
    assert "Please come at 7." in json.loads(desk.calls[0].content)["text"]


def test_a_worker_without_an_address_is_told_how_to_add_one(desk: Desk) -> None:
    desk.n8n()
    desk.manager.patch(f"/workers/{CODE}", json={"email": None})  # the demo gives some workers one
    refused = desk.manager.post(f"/workers/{CODE}/email", json=RENEWAL)
    assert refused.status_code == 422 and "Edit details" in refused.text
    assert desk.calls == []


def test_nothing_to_renew_points_to_a_custom_message(desk: Desk) -> None:
    desk.n8n()
    desk.give_email()
    with desk.engine.begin() as c:
        c.execute(
            text(
                """UPDATE employee_documents SET expiry_date = '2030-01-01'
                   WHERE employee_id = (SELECT id FROM employees WHERE employee_code = :c)"""
            ),
            {"c": CODE},
        )
    refused = desk.manager.post(f"/workers/{CODE}/email", json=RENEWAL)
    assert refused.status_code == 422 and "own message" in refused.text


@pytest.mark.parametrize(
    ("answer", "words"),
    [
        (httpx.ConnectError("down"), "could not be reached"),
        (403, "refused the key"),
        (404, "not active"),
        (500, "n8n answered 500"),
    ],
)
def test_when_n8n_cannot_send_the_reason_is_plain_and_the_failure_is_logged(
    desk: Desk, answer: int | Exception, words: str
) -> None:
    desk.n8n(answer)
    desk.give_email()
    failed = desk.manager.post(f"/workers/{CODE}/email", json=RENEWAL)
    assert failed.status_code == 502 and words in failed.text
    assert KEY not in failed.text
    assert desk.one("SELECT delivered FROM notifications ORDER BY created_at DESC LIMIT 1") is False


def test_without_a_key_the_server_says_email_is_not_set_up(desk: Desk) -> None:
    desk.n8n()
    desk.give_email()
    failed = desk.bare.post(f"/workers/{CODE}/email", json=RENEWAL)
    assert failed.status_code == 502 and "not set up" in failed.text


def test_the_md_cannot_email_workers_and_strangers_get_nothing(desk: Desk) -> None:
    desk.n8n()
    assert desk.ceo.post(f"/workers/{CODE}/email", json=RENEWAL).status_code == 403
    assert desk.manager.post("/workers/EMP-9999/email", json=RENEWAL).status_code == 404
