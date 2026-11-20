import asyncio
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from signaldeck_quant.api import create_app
from signaldeck_quant.data import MarketData
from signaldeck_quant.longbridge import LongbridgeService, QuoteStreamResponse
from test_data import Provider
from test_longbridge import FakeSDK


def app_for(service):
    return create_app(MarketData(Provider()), longbridge=service)


def test_unconfigured_status_never_creates_sdk_and_stream_is_unavailable():
    service = LongbridgeService(credentials={})
    with TestClient(app_for(service)) as client:
        assert client.get("/longbridge/status").json() == {
            "configured": False, "available": False, "source": "longbridge", "error": "not_configured",
        }
        response = client.get("/longbridge/stream", params={"symbols": "AAPL.US"})
        assert response.status_code == 503
        assert response.json() == {"error": "not_configured"}
        assert client.get("/health").status_code == 200


@pytest.mark.parametrize("symbols", [
    "", "AAPL", "600000", "430047.BJ", "700.SZ", "600000.HK", "AAPL.HK", "0.HK",
    "700.HK,,AAPL.US", "AAPL.US\n", "AAPL.US?token=secret", ",".join(["AAPL.US"] * 21),
])
def test_symbol_validation_precedes_sdk_creation(symbols):
    def forbidden():
        raise AssertionError("must not create SDK")

    with TestClient(app_for(LongbridgeService(factory=forbidden))) as client:
        response = client.get("/longbridge/stream", params={"symbols": symbols})
        assert response.status_code == 422
        assert response.json() == {"error": "invalid_symbols"}


def test_missing_sdk_and_factory_failure_do_not_expose_credentials(monkeypatch):
    monkeypatch.setattr("signaldeck_quant.longbridge.sdk_available", lambda: False)
    service = LongbridgeService(credentials={
        "LONGPORT_APP_KEY": "secret-key", "LONGPORT_APP_SECRET": "secret-secret",
        "LONGPORT_ACCESS_TOKEN": "secret-token",
    })
    with TestClient(app_for(service)) as client:
        assert client.get("/longbridge/status").json() == {
            "configured": True, "available": False, "source": "longbridge", "error": "sdk_unavailable",
        }
        assert client.get("/longbridge/stream?symbols=AAPL.US").status_code == 503

    def failed():
        raise RuntimeError("secret-key secret-secret secret-token")

    with TestClient(app_for(LongbridgeService(factory=failed))) as client:
        assert client.get("/longbridge/status").json()["available"] is True
        response = client.get("/longbridge/stream?symbols=AAPL.US")
        assert response.status_code == 502
        assert response.json() == {"error": "connection_failed"}
        assert client.get("/longbridge/status").json()["available"] is False
        assert client.get("/longbridge/status").json()["error"] == "connection_failed"


def test_sse_ready_quote_heartbeat_and_disconnect_cleanup():
    async def scenario():
        sdk = FakeSDK()
        service = LongbridgeService(factory=lambda: sdk, heartbeat=0.01)
        app = app_for(service)
        messages = []
        disconnected = asyncio.Event()

        async def receive():
            await disconnected.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)
            body = message.get("body", b"").decode()
            if "event: ready" in body:
                sdk.callback("700.HK", SimpleNamespace(last_done=Decimal("123.45")))
            if "event: heartbeat" in body:
                disconnected.set()

        scope = {
            "type": "http", "asgi": {"version": "3.0", "spec_version": "2.0"},
            "method": "GET", "scheme": "http", "path": "/longbridge/stream",
            "raw_path": b"/longbridge/stream", "query_string": b"symbols=00700.HK,700.HK,AAPL.US",
            "root_path": "", "headers": [], "server": ("test", 80), "client": ("test", 123),
        }
        async with app.router.lifespan_context(app):
            await asyncio.wait_for(app(scope, receive, send), 2)
            assert sdk.unsubscribed == [["700.HK", "AAPL.US"]]
        assert sdk.subscribed == [["700.HK", "AAPL.US"]]
        assert messages[0]["status"] == 200
        headers = dict(messages[0]["headers"])
        assert headers[b"content-type"].startswith(b"text/event-stream")
        assert headers[b"cache-control"] == b"no-cache"
        assert headers[b"x-accel-buffering"] == b"no"
        events = [message["body"].decode() for message in messages if message.get("body")]
        assert events[0] == 'event: ready\ndata: {"symbols":["700.HK","AAPL.US"],"source":"longbridge"}\n\n'
        assert '"price":123.45' in events[1]
        assert events[1].startswith("event: quote\n")
        assert events[2].startswith("event: heartbeat\n")

    asyncio.run(scenario())


def test_lifespan_closes_shared_subscriptions():
    async def scenario():
        sdk = FakeSDK()
        service = LongbridgeService(factory=lambda: sdk)
        app = app_for(service)
        async with app.router.lifespan_context(app):
            await service.hub.attach(["600000.SH", "000001.SZ"])
        assert sdk.unsubscribed == [["000001.SZ", "600000.SH"]]
        assert service.status()["error"] == "service_closed"

    asyncio.run(scenario())


@pytest.mark.parametrize("query", ["", "symbols=700.HK&symbols=AAPL.US"])
def test_missing_or_repeated_symbols_are_rejected(query):
    with TestClient(app_for(LongbridgeService(credentials={}))) as client:
        response = client.get(f"/longbridge/stream?{query}")
        assert response.status_code == 422
        assert response.json() == {"error": "invalid_symbols"}


def test_stream_send_failure_releases_all_references():
    async def scenario():
        sdk = FakeSDK()
        service = LongbridgeService(factory=lambda: sdk)
        listener = await service.hub.attach(["700.HK", "AAPL.US"])
        response = QuoteStreamResponse(service.hub, listener, ["700.HK", "AAPL.US"], 15)

        async def send(message):
            raise OSError("browser disconnected")

        async def receive():
            await asyncio.Event().wait()

        with pytest.raises(Exception):
            await response({"asgi": {"spec_version": "2.4"}}, receive, send)
        assert sdk.unsubscribed == [["700.HK", "AAPL.US"]]
        await service.shutdown()

    asyncio.run(scenario())


def test_shutdown_emits_terminal_sse_error():
    async def scenario():
        sdk = FakeSDK()
        service = LongbridgeService(factory=lambda: sdk)
        listener = await service.hub.attach(["700.HK"])
        response = QuoteStreamResponse(service.hub, listener, ["700.HK"], 15)
        iterator = response.body_iterator
        assert (await anext(iterator)).startswith("event: ready\n")
        await service.shutdown()
        assert await anext(iterator) == 'event: error\ndata: {"error":"service_closed","source":"longbridge"}\n\n'
        with pytest.raises(StopAsyncIteration):
            await anext(iterator)
        assert sdk.unsubscribed == [["700.HK"]]

    asyncio.run(scenario())
