import numpy as np
import pandas as pd
import pytest

from signaldeck_quant.indicators import cross_up, ema, macd, rsi, sma


def test_sma_requires_full_window_and_ema_uses_recursive_weight():
    values = pd.Series([1.0, 2.0, 3.0, 4.0])
    assert np.isnan(sma(values, 3).iloc[1])
    assert sma(values, 3).iloc[2:].tolist() == [2.0, 3.0]
    assert ema(values, 3).tolist() == [1.0, 1.5, 2.25, 3.125]


def test_rsi_handles_flat_rising_and_falling_prices():
    assert rsi(pd.Series([10.0] * 16), 14).iloc[-1] == 50.0
    assert rsi(pd.Series(range(16), dtype=float), 14).iloc[-1] == 100.0
    assert rsi(pd.Series(range(16, 0, -1), dtype=float), 14).iloc[-1] == 0.0


def test_macd_flat_prices_and_cross_requires_previous_comparison():
    line, signal, histogram = macd(pd.Series([10.0] * 40))
    assert (line == 0).all() and (signal == 0).all() and (histogram == 0).all()
    assert cross_up(pd.Series([1, 2, 3]), pd.Series([2, 2, 2])).tolist() == [False, False, True]


@pytest.mark.parametrize("period", [0, -1, True, 1.5])
def test_invalid_indicator_window_is_rejected(period):
    with pytest.raises(ValueError):
        sma(pd.Series([1.0]), period)
