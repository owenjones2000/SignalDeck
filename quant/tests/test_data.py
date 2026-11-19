from datetime import datetime, timezone
from inspect import signature

import akshare
import pandas as pd
import pytest

from fixtures import bars
from signaldeck_quant.data import AkShareProvider, MarketData, validate_bars


class Provider:
    source = "fixture"

    def __init__(self):
        self.calls = 0
        self.fail = False

    def history(self, code, count):
        self.calls += 1
        if self.fail or code == "600000":
            raise RuntimeError("supplier unavailable")
        return bars([10.0] * count)

    def quotes(self, codes):
        if self.fail:
            raise RuntimeError("supplier unavailable")
        return [{"code": code, "name": "Fixture", "price": 10.0} for code in codes]


def test_history_is_qfq_and_cache_expires_without_hiding_supplier_failure():
    provider = Provider()
    clock = [0.0]
    data = MarketData(provider, ttl=10, max_entries=2, clock=lambda: clock[0])
    first = data.history("000001", 40)
    assert first["code"] == "000001" and first["source"] == "fixture"
    assert first["adjustment"] == "qfq" and len(first["bars"]) == 40
    first["bars"][0]["close"] = 999
    assert data.history("000001", 40)["bars"][0]["close"] == 10
    assert provider.calls == 1
    data.history("000002", 40)
    data.history("000003", 40)
    data.history("000001", 40)
    assert provider.calls == 4
    provider.fail = True
    clock[0] = 11
    with pytest.raises(ValueError, match="supplier unavailable"):
        data.history("000001", 40)


@pytest.mark.parametrize("mutation", [
    lambda f: f.assign(close=float("nan")),
    lambda f: f.assign(open=0),
    lambda f: f.assign(volume=-1),
    lambda f: f.assign(high=1),
    lambda f: f.assign(low=30),
    lambda f: f.assign(date="2025-02-30"),
    lambda f: f.assign(date="2025-01-01"),
    lambda f: f.iloc[::-1],
    lambda f: f.drop(columns="low"),
])
def test_invalid_market_bars_are_rejected(mutation):
    with pytest.raises(ValueError):
        validate_bars(mutation(bars([10.0] * 40)), 40)


def test_insufficient_history_and_quote_missing_values_are_not_empty_success():
    with pytest.raises(ValueError, match="Insufficient history"):
        validate_bars(bars([10.0] * 10), 40)
    provider = Provider()
    provider.quotes = lambda codes: []
    with pytest.raises(ValueError, match="Missing quote"):
        MarketData(provider).quotes(["000001"])


def test_quotes_report_source_timestamp_and_cache_staleness():
    time = datetime(2026, 11, 18, 2, 0, tzinfo=timezone.utc)
    data = MarketData(Provider(), now=lambda: time)
    result = data.quotes(["000001"])
    assert result == [{"code": "000001", "name": "Fixture", "price": 10.0,
                       "source": "fixture", "as_of": "2026-11-18T10:00:00+08:00", "stale": False}]
    assert data.quotes(["000001"])[0]["stale"] is True


def test_akshare_adapter_normalizes_daily_units_and_requests_qfq():
    class SDK:
        def stock_zh_a_hist_em(self, **kwargs):
            assert kwargs["symbol"] == "000001" and kwargs["adjust"] == "qfq"
            assert kwargs["period"] == "daily"
            return pd.DataFrame({"日期": ["2026-11-17"], "开盘": [10], "最高": [12],
                                 "最低": [9], "收盘": [11], "成交量": [25]})

        def stock_zh_a_spot_em(self):
            return pd.DataFrame({"代码": ["000001"], "名称": ["平安银行"], "最新价": [11]})

    adapter = AkShareProvider(SDK())
    frame = adapter.history("000001", 1)
    assert frame.iloc[0]["volume"] == 2500
    assert frame.iloc[0]["date"] == "2026-11-17"
    assert adapter.quotes(["000001"]) == [{"code": "000001", "name": "平安银行", "price": 11.0}]


def test_real_akshare_sdk_exposes_daily_and_quote_adapter_endpoints(monkeypatch):
    assert akshare.__version__ == "1.20.65"
    assert callable(akshare.stock_zh_a_hist_em)
    assert callable(akshare.stock_zh_a_spot_em)
    assert {"symbol", "period", "adjust", "start_date", "end_date"} <= set(signature(akshare.stock_zh_a_hist_em).parameters)
    monkeypatch.setattr(akshare, "stock_zh_a_hist_em", lambda **kwargs: pd.DataFrame({
        "日期": ["2026-11-17"], "开盘": [10], "最高": [12], "最低": [9], "收盘": [11], "成交量": [25],
    }))
    assert AkShareProvider().history("000001", 1).iloc[0]["close"] == 11.0
