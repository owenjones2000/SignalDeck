import asyncio
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from signaldeck_quant.longbridge import LongbridgeError, QuoteHub, quote_payload


class FakeSDK:
    def __init__(self):
        self.subscribed = []
        self.unsubscribed = []
        self.callback = None

    def set_on_quote(self, callback):
        self.callback = callback

    def subscribe(self, symbols):
        self.subscribed.append(list(symbols))

    def unsubscribe(self, symbols):
        self.unsubscribed.append(list(symbols))


@pytest.mark.skipif(not hasattr(time, "tzset"), reason="requires process timezone control")
@pytest.mark.parametrize("zone,wall_time,expected", [
    ("Asia/Hong_Kong", datetime(2026, 11, 20, 16), "2026-11-20T08:00:00+00:00"),
    ("UTC", datetime(2026, 11, 20, 16), "2026-11-20T16:00:00+00:00"),
    ("America/New_York", datetime(2026, 7, 20, 16), "2026-07-20T20:00:00+00:00"),
    ("America/New_York", datetime(2026, 11, 20, 16), "2026-11-20T21:00:00+00:00"),
])
def test_sdk_naive_quote_timestamp_uses_process_timezone(monkeypatch, zone, wall_time, expected):
    try:
        with monkeypatch.context() as patch:
            patch.setenv("TZ", zone)
            time.tzset()
            payload = quote_payload("7709.HK", SimpleNamespace(timestamp=wall_time))
            assert payload["timestamp"] == expected
            aware = datetime(2026, 11, 20, 16, tzinfo=timezone(timedelta(hours=8)))
            assert quote_payload("7709.HK", SimpleNamespace(timestamp=aware))["timestamp"] == (
                "2026-11-20T08:00:00+00:00"
            )
    finally:
        time.tzset()


def test_first_subscriber_subscribes_and_last_subscriber_unsubscribes():
    async def scenario():
        sdk = FakeSDK()
        factories = []

        def factory():
            factories.append(True)
            return sdk

        hub = QuoteHub(factory)
        first = await hub.attach(["AAPL.US", "700.HK"])
        second = await hub.attach(["700.HK"])
        assert factories == [True]
        assert sdk.subscribed == [["AAPL.US", "700.HK"]]
        await hub.detach(first)
        assert sdk.unsubscribed == [["AAPL.US"]]
        await hub.detach(second)
        await hub.detach(second)
        assert sdk.unsubscribed == [["AAPL.US"], ["700.HK"]]

    asyncio.run(scenario())


def test_concurrent_subscribers_share_a_subscription_and_shutdown_is_idempotent():
    async def scenario():
        sdk = FakeSDK()
        hub = QuoteHub(lambda: sdk)
        listeners = await asyncio.gather(*(hub.attach(["700.HK"]) for _ in range(12)))
        assert sdk.subscribed == [["700.HK"]]
        await hub.shutdown()
        await hub.shutdown()
        await asyncio.gather(*(hub.detach(listener) for listener in listeners))
        assert sdk.unsubscribed == [["700.HK"]]
        with pytest.raises(LongbridgeError, match="service_closed"):
            await hub.attach(["700.HK"])

    asyncio.run(scenario())


def test_threaded_pushes_merge_latest_per_symbol_and_normalize_finite_values():
    async def scenario():
        sdk = FakeSDK()
        hub = QuoteHub(lambda: sdk)
        listener = await hub.attach(["700.HK", "AAPL.US"])
        ignored = await hub.attach(["600000.SH"])

        def push():
            for value in range(10000):
                sdk.callback("700.HK", SimpleNamespace(
                    last_done=Decimal(value), open=Decimal("NaN"), high=float("inf"),
                    low=Decimal("3.5"), volume=123, turnover=Decimal("500.25"),
                    timestamp=datetime(2026, 11, 19, 16, tzinfo=timezone(timedelta(hours=8))),
                ))
            sdk.callback("AAPL.US", SimpleNamespace(last_done=25, timestamp=None))

        thread = threading.Thread(target=push)
        thread.start()
        thread.join()
        first = await listener.receive(0.1)
        second = await listener.receive(0.1)
        assert first == ("quote", {
            "symbol": "700.HK", "price": 9999.0, "open": None, "high": None,
            "low": 3.5, "volume": 123.0, "turnover": 500.25,
            "timestamp": "2026-11-19T08:00:00+00:00", "source": "longbridge",
        })
        assert second[1]["symbol"] == "AAPL.US"
        assert second[1]["timestamp"] is None
        assert await listener.receive(0.01) == ("heartbeat", {"source": "longbridge"})
        assert await ignored.receive(0.01) == ("heartbeat", {"source": "longbridge"})
        await hub.shutdown()
        assert await listener.receive(0.1) == ("error", {"error": "service_closed", "source": "longbridge"})

    asyncio.run(scenario())


def test_cancelled_subscription_waits_for_sdk_then_releases_references():
    async def scenario():
        sdk = FakeSDK()
        started, finish = threading.Event(), threading.Event()
        original = sdk.subscribe

        def subscribe(symbols):
            started.set()
            finish.wait(2)
            original(symbols)

        sdk.subscribe = subscribe
        hub = QuoteHub(lambda: sdk)
        task = asyncio.create_task(hub.attach(["700.HK"]))
        await asyncio.to_thread(started.wait, 2)
        task.cancel()
        finish.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert sdk.unsubscribed == [["700.HK"]]
        await hub.shutdown()
        assert sdk.unsubscribed == [["700.HK"]]

    asyncio.run(scenario())


def test_unsubscribe_failure_is_retained_for_shutdown_retry_without_leaking_errors():
    async def scenario():
        sdk = FakeSDK()
        hub = QuoteHub(lambda: sdk)
        listener = await hub.attach(["700.HK"])
        original = sdk.unsubscribe

        def fail(symbols):
            original(symbols)
            raise RuntimeError("private-token")

        sdk.unsubscribe = fail
        await hub.detach(listener)
        sdk.unsubscribe = original
        await hub.shutdown()
        assert sdk.unsubscribed == [["700.HK"], ["700.HK"]]

    asyncio.run(scenario())


def test_failed_partial_subscription_rolls_back_only_new_symbols_and_can_retry():
    async def scenario():
        sdk = FakeSDK()
        hub = QuoteHub(lambda: sdk)
        existing = await hub.attach(["700.HK"])
        original = sdk.subscribe

        def fail(symbols):
            original(symbols)
            raise RuntimeError("private-access-token")

        sdk.subscribe = fail
        with pytest.raises(LongbridgeError, match="subscription_failed"):
            await hub.attach(["700.HK", "AAPL.US"])
        assert sdk.unsubscribed == [["AAPL.US"]]
        sdk.subscribe = original
        retry = await hub.attach(["AAPL.US"])
        await hub.detach(existing)
        await hub.detach(retry)
        assert sdk.subscribed == [["700.HK"], ["AAPL.US"], ["AAPL.US"]]

    asyncio.run(scenario())


def test_failed_rollback_does_not_mark_unknown_subscription_as_successful():
    async def scenario():
        sdk = FakeSDK()
        hub = QuoteHub(lambda: sdk)
        subscribe, unsubscribe = sdk.subscribe, sdk.unsubscribe

        def failed_subscribe(symbols):
            subscribe(symbols)
            raise RuntimeError("secret")

        def failed_unsubscribe(symbols):
            unsubscribe(symbols)
            raise RuntimeError("secret")

        sdk.subscribe = failed_subscribe
        sdk.unsubscribe = failed_unsubscribe
        with pytest.raises(LongbridgeError, match="subscription_failed"):
            await hub.attach(["700.HK"])
        sdk.subscribe = subscribe
        with pytest.raises(LongbridgeError, match="unsubscribe_failed"):
            await hub.attach(["700.HK"])
        sdk.unsubscribe = unsubscribe
        listener = await hub.attach(["700.HK"])
        assert sdk.subscribed == [["700.HK"], ["700.HK"]]
        await hub.detach(listener)
        await hub.shutdown()
        assert sdk.unsubscribed == [["700.HK"]] * 4

    asyncio.run(scenario())
