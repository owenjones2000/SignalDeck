import pytest

from fixtures import bars
from signaldeck_quant.backtest import run_backtest


def test_orders_execute_next_open_with_lots_commission_and_sell_only_tax():
    prices = [10.0] * 25 + [15.0] * 5 + [5.0] * 5
    opens = prices.copy()
    opens[26] = 12.0
    opens[33] = 6.0
    result = run_backtest(bars(prices, opens), "dual_ma", 10000, 1.0, 0.01, 0.02)
    assert result["trades"] == [
        {"type": "buy", "signal_date": "2025-02-05", "date": "2025-02-06",
         "price": 12.0, "shares": 800, "commission": 96.0, "stamp_tax": 0.0},
        {"type": "sell", "signal_date": "2025-02-14", "date": "2025-02-17",
         "price": 6.0, "shares": 800, "commission": 48.0, "stamp_tax": 96.0},
    ]
    assert result["final_equity"] == 4960.0
    assert result["total_return"] == pytest.approx(-0.504)
    assert result["position_shares"] == 0
    assert "no_slippage" in result["limitations"]
    assert "no_price_limit_matching" in result["limitations"]


def test_last_bar_signal_does_not_trade_and_insufficient_cash_is_not_negative():
    frame = bars([10.0] * 25 + [15.0])
    assert run_backtest(frame, "dual_ma")["trades"] == []
    result = run_backtest(bars([10.0] * 25 + [15.0] * 5), "dual_ma", 100, 0.5)
    assert result["trades"] == []
    assert result["final_equity"] == 100


def test_open_position_is_marked_to_market_not_forcibly_liquidated():
    result = run_backtest(bars([10.0] * 25 + [15.0] * 5), "dual_ma", 10000, 0.5, 0, 0)
    assert result["position_shares"] == 300
    assert result["cash"] == 5500
    assert result["final_equity"] == 10000
    assert len(result["trades"]) == 1


@pytest.mark.parametrize("params", [
    {"init_capital": 0}, {"init_capital": float("inf")}, {"init_capital": True},
    {"position_pct": 0}, {"position_pct": 1.01}, {"position_pct": float("nan")},
    {"commission": -1}, {"commission": 1}, {"stamp_tax": -1}, {"stamp_tax": 1},
])
def test_invalid_backtest_parameters_are_rejected(params):
    with pytest.raises(ValueError):
        run_backtest(bars([10.0] * 40), "dual_ma", **params)


def test_suspension_volume_zero_skips_pending_order():
    frame = bars([10.0] * 25 + [15.0] * 5, volumes=[10000] * 26 + [0] + [10000] * 3)
    assert run_backtest(frame, "dual_ma")["trades"] == []
