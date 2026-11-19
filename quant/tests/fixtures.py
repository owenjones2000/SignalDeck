import pandas as pd


def bars(prices, opens=None, volumes=None):
    opens = opens if opens is not None else prices
    volumes = volumes if volumes is not None else [10000] * len(prices)
    return pd.DataFrame({
        "date": pd.bdate_range("2025-01-01", periods=len(prices)).strftime("%Y-%m-%d"),
        "open": opens,
        "high": [max(o, c) + 1 for o, c in zip(opens, prices)],
        "low": [min(o, c) - 1 for o, c in zip(opens, prices)],
        "close": prices,
        "volume": volumes,
    })
