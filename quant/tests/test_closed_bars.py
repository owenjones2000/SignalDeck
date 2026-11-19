from datetime import datetime, timezone

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from fixtures import bars
from signaldeck_quant.api import create_app
from signaldeck_quant.data import MarketData, SHANGHAI
from test_data import Provider


def market_frame(count=121):
    frame = bars([10.0] * (count - 1) + [15.0])
    frame["date"] = pd.bdate_range(end="2026-11-18", periods=count).strftime("%Y-%m-%d")
    return frame


@pytest.mark.parametrize("instant,closed", [
    (datetime(2026, 11, 18, 9, 30, tzinfo=SHANGHAI), False),
    (datetime(2026, 11, 18, 14, 59, 59, tzinfo=SHANGHAI), False),
    (datetime(2026, 11, 18, 15, 0, tzinfo=SHANGHAI), True),
    (datetime(2026, 11, 18, 6, 59, 59, tzinfo=timezone.utc), False),
    (datetime(2026, 11, 18, 7, 0, tzinfo=timezone.utc), True),
])
def test_calculations_only_use_closed_shanghai_bars_but_history_keeps_current_bar(instant, closed):
    provider = Provider()
    provider.history = lambda code, count: market_frame().tail(count)
    client = TestClient(create_app(MarketData(provider, now=lambda: instant)))
    history = client.post("/history", json={"code": "000001", "count": 40}).json()
    assert history["bars"][-1]["date"] == "2026-11-18"
    screen = client.post("/screen", json={"codes": ["000001"], "formula": "ma_cross", "count": 40}).json()
    assert screen["failures"] == []
    assert bool(screen["hits"]) is closed
    signals = client.post("/signals", json={"codes": ["000001"]}).json()
    assert signals["failures"] == []
    assert bool(signals["signals"]) is closed
    result = client.post("/backtest", json={"code": "000001", "strategy": "dual_ma", "count": 40}).json()
    assert len(result["equity_curve"]) == 40
    assert result["equity_curve"][-1]["date"] == ("2026-11-18" if closed else "2026-11-17")


def test_close_boundary_does_not_reuse_pre_close_calculation_cache():
    instant = [datetime(2026, 11, 18, 14, 59, 59, tzinfo=SHANGHAI)]
    provider = Provider()
    provider.history = lambda code, count: market_frame().tail(count)
    client = TestClient(create_app(MarketData(provider, now=lambda: instant[0])))
    params = {"codes": ["000001"], "formula": "ma_cross", "count": 40}
    assert client.post("/screen", json=params).json()["hits"] == []
    instant[0] = datetime(2026, 11, 18, 15, 0, tzinfo=SHANGHAI)
    assert client.post("/screen", json=params).json()["hits"][0]["date"] == "2026-11-18"


def test_insufficient_closed_history_is_explicit_for_all_calculation_endpoints():
    provider = Provider()
    provider.history = lambda code, count: market_frame(35)
    instant = datetime(2026, 11, 18, 10, 0, tzinfo=SHANGHAI)
    client = TestClient(create_app(MarketData(provider, now=lambda: instant)))
    response = client.post("/backtest", json={"code": "000001", "strategy": "macd", "count": 35})
    assert response.status_code == 502
    assert "Insufficient history" in response.json()["error"]
    result = client.post("/screen", json={"codes": ["000001"], "formula": "macd_cross", "count": 35}).json()
    assert "Insufficient history" in result["failures"][0]["error"]
    result = client.post("/signals", json={"codes": ["000001"]}).json()
    assert "Insufficient history" in result["failures"][0]["error"]


def test_closed_history_accepts_maximum_count_and_does_not_drop_previous_day_before_open():
    provider = Provider()
    frame = market_frame(2001)
    provider.history = lambda code, count: frame.tail(count)
    instant = datetime(2026, 11, 18, 0, 0, tzinfo=SHANGHAI)
    client = TestClient(create_app(MarketData(provider, now=lambda: instant)))
    response = client.post("/backtest", json={"code": "000001", "strategy": "dual_ma", "count": 2000})
    assert response.status_code == 200
    assert len(response.json()["equity_curve"]) == 2000
    assert response.json()["equity_curve"][-1]["date"] == "2026-11-17"


def test_breakout_api_rejects_21_bars_and_accepts_22_closed_bars():
    provider = Provider()
    provider.history = lambda code, count: market_frame().tail(count)
    instant = datetime(2026, 11, 18, 15, 0, tzinfo=SHANGHAI)
    client = TestClient(create_app(MarketData(provider, now=lambda: instant)))
    params = {"code": "000001", "strategy": "breakout", "count": 21}
    response = client.post("/backtest", json=params)
    assert response.status_code == 422
    assert "Insufficient history" in response.json()["error"]
    params["count"] = 22
    response = client.post("/backtest", json=params)
    assert response.status_code == 200
    assert len(response.json()["equity_curve"]) == 22


def test_previous_day_is_kept_and_cached_unclosed_prices_are_not_used_after_close():
    instant = [datetime(2026, 11, 18, 14, 59, 59, tzinfo=SHANGHAI)]
    provider = Provider()
    frame = market_frame()
    frame.loc[frame.index[-1], ["open", "close"]] = 10.0
    frame.loc[frame.index[-1], "low"] = 9.0
    provider.history = lambda code, count: frame.tail(count)
    data = MarketData(provider, now=lambda: instant[0])
    assert data.history("000001", 40)["bars"][-1]["close"] == 10.0
    assert data.closed_history("000001", 40)["bars"][-1]["date"] == "2026-11-17"
    instant[0] = datetime(2026, 11, 18, 15, 0, tzinfo=SHANGHAI)
    frame.loc[frame.index[-1], "close"] = 15.0
    assert data.closed_history("000001", 40)["bars"][-1]["close"] == 15.0
