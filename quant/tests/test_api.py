import pytest
from fastapi.testclient import TestClient

from fixtures import bars
from signaldeck_quant.api import create_app
from signaldeck_quant.data import MarketData
from test_data import Provider


@pytest.fixture
def client():
    return TestClient(create_app(MarketData(Provider())))


def test_health_and_catalogs_are_available_without_fetching_market_data(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["source"] == "fixture"
    assert len(client.get("/formulas").json()) == 4
    assert len(client.get("/strategies").json()) == 5
    assert all({"key", "name", "min_history"} <= row.keys() for row in client.get("/formulas").json())


def test_history_and_quotes_follow_internal_contract(client):
    response = client.post("/history", json={"code": "000001", "count": 40})
    assert response.status_code == 200
    assert response.json()["adjustment"] == "qfq"
    assert len(response.json()["bars"]) == 40
    assert set(response.json()["bars"][0]) == {"date", "open", "high", "low", "close", "volume"}
    quote = client.post("/quotes", json={"codes": ["000001"]}).json()[0]
    assert {"source", "as_of", "stale"} <= quote.keys()


def test_screen_and_signals_preserve_per_symbol_failure_reasons(client):
    response = client.post("/screen", json={"formula": "ma_cross", "codes": ["000001", "600000"], "count": 40})
    assert response.status_code == 200
    assert response.json()["hits"] == []
    assert response.json()["failures"] == [{"code": "600000", "error": "fixture: supplier unavailable"}]
    response = client.post("/signals", json={"codes": ["000001", "600000"]})
    assert response.json()["signals"] == []
    assert response.json()["failures"][0]["code"] == "600000"
    assert "supplier unavailable" in response.json()["failures"][0]["error"]


def test_matching_screen_and_signal_results_include_code_date_price():
    provider = Provider()
    provider.history = lambda code, count: bars([10.0] * (count - 1) + [15.0])
    client = TestClient(create_app(MarketData(provider)))
    hit = client.post("/screen", json={"formula": "ma_cross", "codes": ["000001"], "count": 40}).json()["hits"][0]
    assert hit == {"code": "000001", "formula": "ma_cross", "date": "2025-02-25", "price": 15.0}
    signals = client.post("/signals", json={"codes": ["000001"]}).json()["signals"]
    assert len(signals) == 3
    assert all(set(signal) == {"code", "key", "name", "type", "date", "price"} for signal in signals)


def test_backtest_returns_source_adjustment_and_marked_equity(client):
    response = client.post("/backtest", json={"code": "000001", "strategy": "dual_ma", "count": 40,
                                              "init_capital": 10000, "position_pct": 0.5,
                                              "commission": 0.001, "stamp_tax": 0.001})
    assert response.status_code == 200
    assert response.json()["final_equity"] == 10000
    assert response.json()["source"] == "fixture"
    assert response.json()["adjustment"] == "qfq"
    assert response.json()["code"] == "000001"


@pytest.mark.parametrize("path,payload", [
    ("/history", {"code": "1", "count": 40}),
    ("/history", {"code": 1, "count": 40}),
    ("/history", {"code": "000001", "count": 0}),
    ("/history", {"code": "000001", "count": 2001}),
    ("/history", {"code": "000001", "count": True}),
    ("/history", {"code": "000001", "count": "40"}),
    ("/history", {"code": "000001", "count": 40, "unexpected": 1}),
    ("/quotes", {"codes": []}),
    ("/quotes", {"codes": ["000001"] * 101}),
    ("/quotes", {"codes": ["AAPL"]}),
    ("/screen", {"codes": ["000001"], "formula": "invalid", "count": 40}),
    ("/screen", {"codes": ["000001"], "formula": "macd_cross", "count": 20}),
    ("/backtest", {"code": "000001", "strategy": "invalid"}),
    ("/backtest", {"code": "000001", "strategy": "dual_ma", "position_pct": 2}),
    ("/backtest", {"code": "000001", "strategy": "dual_ma", "commission": -1}),
    ("/backtest", {"code": "000001", "strategy": "dual_ma", "init_capital": True}),
])
def test_invalid_requests_use_error_envelope(client, path, payload):
    response = client.post(path, json=payload)
    assert response.status_code == 422
    assert set(response.json()) == {"error"}


def test_supplier_failure_and_missing_route_use_error_envelope(client):
    response = client.post("/history", json={"code": "600000", "count": 40})
    assert response.status_code == 502
    assert "supplier unavailable" in response.json()["error"]
    assert set(client.get("/missing").json()) == {"error"}
    assert set(client.post("/history", content="{", headers={"Content-Type": "application/json"}).json()) == {"error"}


def test_all_failed_screen_is_explicit_not_an_empty_success(client):
    result = client.post("/screen", json={"formula": "ma_cross", "codes": ["600000"], "count": 40}).json()
    assert result["hits"] == [] and len(result["failures"]) == 1
