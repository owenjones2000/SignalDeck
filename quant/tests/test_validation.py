import pytest

from fixtures import bars
from signaldeck_quant.backtest import run_backtest
from signaldeck_quant.data import MarketData
from signaldeck_quant.rules import evaluate_formula, latest_signals, strategy_orders
from test_data import Provider


@pytest.mark.parametrize("operation", [
    lambda frame: run_backtest(frame, "dual_ma"),
    lambda frame: strategy_orders(frame, "dual_ma"),
    lambda frame: evaluate_formula(frame, "volume_breakout"),
    lambda frame: latest_signals(frame, "000001"),
])
@pytest.mark.parametrize("mutation", [
    lambda frame: frame.assign(open=0),
    lambda frame: frame.assign(close=float("inf")),
    lambda frame: frame.assign(volume=-1),
])
def test_public_calculation_interfaces_reject_corrupt_history(operation, mutation):
    with pytest.raises(ValueError):
        operation(mutation(bars([10.0] * 40)))


@pytest.mark.parametrize("price", [None, 0, -1, True, float("nan"), float("inf")])
def test_corrupt_quotes_are_reported_as_supplier_errors(price):
    provider = Provider()
    provider.quotes = lambda codes: [{"code": "000001", "price": price}]
    with pytest.raises(ValueError, match="Invalid quote"):
        MarketData(provider).quotes(["000001"])


def test_failed_history_is_not_cached_and_can_recover():
    provider = Provider()
    provider.fail = True
    data = MarketData(provider)
    with pytest.raises(ValueError):
        data.history("000001", 40)
    provider.fail = False
    assert len(data.history("000001", 40)["bars"]) == 40
    assert provider.calls == 2
