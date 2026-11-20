import inspect
import subprocess
import sys
from types import SimpleNamespace

import pytest

from signaldeck_quant.longbridge import LongbridgeSDK, LongbridgeService
from test_longbridge import FakeSDK


def test_factory_maps_longport_credentials_to_verified_longbridge_api(monkeypatch):
    calls = []
    sdk = FakeSDK()
    quote_type = object()
    config = object()

    class Config:
        @staticmethod
        def from_apikey(app_key, app_secret, access_token, *, enable_print_quote_packages):
            calls.append((app_key, app_secret, access_token, enable_print_quote_packages))
            return config

    class QuoteContext:
        def __init__(self, received):
            assert received is config

        def set_on_quote(self, callback):
            sdk.set_on_quote(callback)

        def subscribe(self, symbols, sub_types):
            assert sub_types == [quote_type]
            sdk.subscribe(symbols)

        def unsubscribe(self, symbols, sub_types):
            assert sub_types == [quote_type]
            sdk.unsubscribe(symbols)

    monkeypatch.setitem(sys.modules, "longbridge.openapi", SimpleNamespace(
        Config=Config, QuoteContext=QuoteContext, SubType=SimpleNamespace(Quote=quote_type),
    ))
    adapter = LongbridgeSDK({
        "LONGPORT_APP_KEY": "fixture-key", "LONGPORT_APP_SECRET": "fixture-secret",
        "LONGPORT_ACCESS_TOKEN": "fixture-token",
    })
    callback = lambda symbol, event: None
    adapter.set_on_quote(callback)
    adapter.subscribe(["700.HK"])
    adapter.unsubscribe(["700.HK"])
    assert calls == [("fixture-key", "fixture-secret", "fixture-token", False)]
    assert sdk.callback is callback
    assert sdk.subscribed == sdk.unsubscribed == [["700.HK"]]


def test_installed_sdk_matches_adapter_without_creating_network_connection():
    openapi = pytest.importorskip("longbridge.openapi")
    parameters = inspect.signature(openapi.Config.from_apikey).parameters
    assert {"app_key", "app_secret", "access_token", "enable_print_quote_packages"} <= parameters.keys()
    assert list(inspect.signature(openapi.QuoteContext.subscribe).parameters) == ["self", "symbols", "sub_types"]
    assert list(inspect.signature(openapi.QuoteContext.unsubscribe).parameters) == ["self", "symbols", "sub_types"]
    assert list(inspect.signature(openapi.QuoteContext.set_on_quote).parameters) == ["self", "callback"]
    assert all(hasattr(openapi.PushQuote, field) for field in (
        "last_done", "open", "high", "low", "volume", "turnover", "timestamp",
    ))


def test_partial_configuration_is_unconfigured_even_when_sdk_is_installed():
    service = LongbridgeService(credentials={"LONGPORT_APP_KEY": "fixture-key"})
    assert service.status() == {
        "configured": False, "available": False, "source": "longbridge", "error": "not_configured",
    }


def test_installed_sdk_availability_is_repeatable_in_fresh_process():
    pytest.importorskip("longbridge.openapi")
    result = subprocess.run([
        sys.executable, "-c",
        "from signaldeck_quant.longbridge import sdk_available; "
        "assert [sdk_available() for _ in range(3)] == [True, True, True]",
    ], capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
