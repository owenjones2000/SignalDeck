import pytest

from fixtures import bars
from signaldeck_quant.rules import FORMULAS, STRATEGIES, evaluate_formula, strategy_orders, latest_signals


def test_four_formulas_five_strategies_and_three_signals_use_fixed_history():
    assert set(FORMULAS) == {"ma_cross", "macd_cross", "volume_breakout", "rsi_rebound"}
    assert set(STRATEGIES) == {"dual_ma", "macd", "rsi", "bollinger", "breakout"}
    flat = bars([10.0] * 80)
    assert all(not evaluate_formula(flat, key) for key in FORMULAS)
    assert latest_signals(flat, "000001") == []
    for key in STRATEGIES:
        buy, sell = strategy_orders(flat, key)
        assert not buy.any() and not sell.any()


def test_ma_cross_and_breakout_are_only_triggered_on_crossing_bar():
    frame = bars([10.0] * 79 + [15.0], volumes=[10000] * 79 + [25000])
    assert evaluate_formula(frame, "ma_cross") is True
    assert evaluate_formula(frame, "macd_cross") is True
    assert evaluate_formula(frame, "volume_breakout") is True
    signals = latest_signals(frame, "000001")
    assert {s["key"] for s in signals} == {"ma_cross", "macd_cross", "breakout"}
    assert all(s["code"] == "000001" and s["type"] == "buy" and s["price"] == 15.0 for s in signals)
    assert all(s["date"] == frame.iloc[-1]["date"] for s in signals)
    extended = bars([10.0] * 79 + [15.0, 15.0])
    assert not evaluate_formula(extended, "ma_cross")


def test_rsi_rebound_and_bollinger_reentry():
    frame = bars([30.0] * 60 + list(range(29, 9, -1)) + [20.0])
    assert evaluate_formula(frame, "rsi_rebound")
    buy, sell = strategy_orders(frame, "rsi")
    assert buy.iloc[-1] and not sell.iloc[-1]
    band_frame = bars([20.0] * 60 + [5.0, 19.0])
    buy, sell = strategy_orders(band_frame, "bollinger")
    assert buy.iloc[-1] and not sell.iloc[-1]


@pytest.mark.parametrize("name", ["dual_ma", "macd", "rsi", "bollinger", "breakout"])
def test_strategies_do_not_use_future_bars(name):
    frame = bars([10.0] * 60 + [15.0, 12.0, 9.0, 18.0, 7.0])
    full = strategy_orders(frame, name)
    prefix = strategy_orders(frame.iloc[:63], name)
    for complete, early in zip(full, prefix):
        assert complete.iloc[:63].tolist() == early.tolist()


def test_unknown_rule_and_insufficient_history_raise_errors():
    with pytest.raises(ValueError, match="Unknown formula"):
        evaluate_formula(bars([10.0] * 80), "unknown")
    with pytest.raises(ValueError, match="Unknown strategy"):
        strategy_orders(bars([10.0] * 80), "unknown")
    with pytest.raises(ValueError, match="history"):
        latest_signals(bars([10.0] * 10), "000001")


def test_breakout_cross_requires_22_bars_for_two_valid_thresholds():
    assert STRATEGIES["breakout"]["min_history"] == 22
    with pytest.raises(ValueError, match="need 22, got 21"):
        strategy_orders(bars([10.0] * 20 + [15.0]), "breakout")
    buy, sell = strategy_orders(bars([10.0] * 21 + [15.0]), "breakout")
    assert buy.tolist() == [False] * 21 + [True]
    assert not sell.any()


def test_volume_breakout_does_not_require_cross_and_still_accepts_21_bars():
    frame = bars([10.0] * 20 + [15.0], volumes=[10000] * 20 + [25000])
    assert FORMULAS["volume_breakout"]["min_history"] == 21
    assert evaluate_formula(frame, "volume_breakout")
