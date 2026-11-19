import pandas as pd

from .data import validate_bars, validate_code
from .indicators import cross_up, macd, rsi, sma


FORMULAS = {
    "ma_cross": {"name": "5/20日均线金叉", "min_history": 21},
    "macd_cross": {"name": "MACD金叉", "min_history": 35},
    "volume_breakout": {"name": "放量突破20日高点", "min_history": 21},
    "rsi_rebound": {"name": "RSI上穿30", "min_history": 16},
}
STRATEGIES = {
    "dual_ma": {"name": "5/20日双均线", "min_history": 21},
    "macd": {"name": "MACD交叉", "min_history": 35},
    "rsi": {"name": "RSI 30/70", "min_history": 16},
    "bollinger": {"name": "布林带回归", "min_history": 21},
    "breakout": {"name": "20日突破/10日退出", "min_history": 22},
}
SIGNALS = {
    "ma_cross": {"name": "均线金叉", "strategy": "dual_ma"},
    "macd_cross": {"name": "MACD金叉", "strategy": "macd"},
    "breakout": {"name": "20日突破", "strategy": "breakout"},
}


def _require(frame: pd.DataFrame, minimum: int) -> None:
    if len(frame) < minimum:
        raise ValueError(f"Insufficient history: need {minimum}, got {len(frame)}")
    validate_bars(frame, len(frame))


def strategy_orders(frame: pd.DataFrame, strategy: str) -> tuple[pd.Series, pd.Series]:
    if strategy not in STRATEGIES:
        raise ValueError(f"Unknown strategy: {strategy}")
    minimum = STRATEGIES[strategy]["min_history"]
    _require(frame, minimum)
    close = frame["close"]
    if strategy == "dual_ma":
        fast, slow = sma(close, 5), sma(close, 20)
        buy, sell = cross_up(fast, slow), cross_up(slow, fast)
    elif strategy == "macd":
        line, signal, _ = macd(close)
        buy, sell = cross_up(line, signal), cross_up(signal, line)
    elif strategy == "rsi":
        strength = rsi(close)
        buy = cross_up(strength, pd.Series(30.0, index=frame.index))
        sell = cross_up(pd.Series(70.0, index=frame.index), strength)
    elif strategy == "bollinger":
        middle = sma(close, 20)
        deviation = close.rolling(20).std(ddof=0)
        buy = cross_up(close, middle - 2 * deviation)
        sell = cross_up(middle, close)
    else:
        upper = frame["high"].rolling(20).max().shift(1)
        lower = frame["low"].rolling(10).min().shift(1)
        buy, sell = cross_up(close, upper), cross_up(lower, close)
    buy = buy.copy()
    sell = sell.copy()
    buy.iloc[:minimum - 1] = False
    sell.iloc[:minimum - 1] = False
    return buy, sell


def evaluate_formula(frame: pd.DataFrame, formula: str) -> bool:
    if formula not in FORMULAS:
        raise ValueError(f"Unknown formula: {formula}")
    _require(frame, FORMULAS[formula]["min_history"])
    mapping = {"ma_cross": "dual_ma", "macd_cross": "macd", "rsi_rebound": "rsi"}
    if formula in mapping:
        return bool(strategy_orders(frame, mapping[formula])[0].iloc[-1])
    price = frame["close"].iloc[-1] > frame["high"].iloc[-21:-1].max()
    volume = frame["volume"].iloc[-1] > 1.5 * frame["volume"].iloc[-21:-1].mean()
    return bool(price and volume)


def latest_signals(frame: pd.DataFrame, code: str) -> list[dict]:
    validate_code(code)
    _require(frame, 35)
    last = frame.iloc[-1]
    return [
        {"code": code, "key": key, "name": metadata["name"], "type": "buy",
         "date": str(last["date"]), "price": float(last["close"])}
        for key, metadata in SIGNALS.items()
        if strategy_orders(frame, metadata["strategy"])[0].iloc[-1]
    ]
