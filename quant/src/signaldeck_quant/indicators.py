import numpy as np
import pandas as pd


def _period(period: int) -> None:
    if type(period) is not int or period < 1:
        raise ValueError("period must be a positive integer")


def sma(values: pd.Series, period: int) -> pd.Series:
    _period(period)
    return values.rolling(period, min_periods=period).mean()


def ema(values: pd.Series, period: int) -> pd.Series:
    _period(period)
    return values.ewm(span=period, adjust=False).mean()


def rsi(values: pd.Series, period: int = 14) -> pd.Series:
    _period(period)
    delta = values.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    result = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    result = result.mask((loss == 0) & (gain > 0), 100)
    return result.mask((loss == 0) & (gain == 0), 50)


def macd(values: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    line = ema(values, 12) - ema(values, 26)
    signal = ema(line, 9)
    return line, signal, line - signal


def cross_up(left: pd.Series, right: pd.Series) -> pd.Series:
    return ((left > right) & (left.shift(1) <= right.shift(1))).fillna(False)
