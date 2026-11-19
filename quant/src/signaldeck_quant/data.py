import copy
import math
import re
import time
from collections import OrderedDict
from datetime import date, datetime, timedelta
from threading import RLock
from typing import Protocol
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd


SHANGHAI = ZoneInfo("Asia/Shanghai")
FIELDS = ["date", "open", "high", "low", "close", "volume"]


class Provider(Protocol):
    source: str

    def history(self, code: str, count: int) -> pd.DataFrame: ...

    def quotes(self, codes: list[str]) -> list[dict]: ...


def validate_code(code: str) -> str:
    if not isinstance(code, str) or not re.fullmatch(r"(?:[03468][0-9]{5}|92[0-9]{4})", code):
        raise ValueError("code must be a six-digit A-share code")
    return code


def validate_count(count: int) -> int:
    if type(count) is not int or not 1 <= count <= 2000:
        raise ValueError("count must be an integer between 1 and 2000")
    return count


def validate_bars(frame: pd.DataFrame, count: int) -> pd.DataFrame:
    validate_count(count)
    if not isinstance(frame, pd.DataFrame) or not set(FIELDS).issubset(frame.columns):
        raise ValueError("Invalid history columns")
    if len(frame) < count:
        raise ValueError(f"Insufficient history: need {count}, got {len(frame)}")
    result = frame[FIELDS].copy().reset_index(drop=True)
    try:
        dates = [date.fromisoformat(str(value)) for value in result["date"]]
        if any(str(value) != parsed.isoformat() for value, parsed in zip(result["date"], dates)):
            raise ValueError("Invalid date format")
        if any(left >= right for left, right in zip(dates, dates[1:])):
            raise ValueError("Dates must be unique and increasing")
        if any(value > datetime.now(SHANGHAI).date() for value in dates):
            raise ValueError("Future daily bar")
        numeric = result[FIELDS[1:]].apply(pd.to_numeric, errors="raise")
        if not np.isfinite(numeric.to_numpy(dtype=float)).all():
            raise ValueError("Non-finite bar")
        if (numeric[["open", "high", "low", "close"]] <= 0).any().any():
            raise ValueError("Prices must be positive")
        if (numeric["volume"] < 0).any():
            raise ValueError("Negative volume")
        if (numeric["high"] < numeric[["open", "low", "close"]].max(axis=1)).any():
            raise ValueError("Invalid high")
        if (numeric["low"] > numeric[["open", "high", "close"]].min(axis=1)).any():
            raise ValueError("Invalid low")
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(f"Invalid history: {error}") from error
    result[FIELDS[1:]] = numeric.astype(float)
    result["date"] = [value.isoformat() for value in dates]
    return result.tail(count).reset_index(drop=True)


class AkShareProvider:
    source = "akshare/eastmoney"

    def __init__(self, sdk=None):
        if sdk is None:
            import akshare

            sdk = akshare
        self.sdk = sdk

    def history(self, code: str, count: int) -> pd.DataFrame:
        end = datetime.now(SHANGHAI).date()
        start = end - timedelta(days=max(count * 3, 365))
        raw = self.sdk.stock_zh_a_hist_em(symbol=code, period="daily", adjust="qfq",
                                     start_date=start.strftime("%Y%m%d"), end_date=end.strftime("%Y%m%d"))
        frame = raw.rename(columns={"日期": "date", "开盘": "open", "最高": "high",
                                    "最低": "low", "收盘": "close", "成交量": "volume"})
        frame = frame[FIELDS].copy()
        frame["date"] = frame["date"].astype(str)
        frame["volume"] = pd.to_numeric(frame["volume"], errors="raise") * 100
        return frame.tail(count)

    def quotes(self, codes: list[str]) -> list[dict]:
        raw = self.sdk.stock_zh_a_spot_em()
        selected = raw[raw["代码"].isin(codes)]
        return [{"code": str(row["代码"]), "name": str(row["名称"]), "price": float(row["最新价"])}
                for row in selected.to_dict("records")]


class MarketData:
    def __init__(self, provider: Provider, ttl: float = 30, max_entries: int = 128,
                 clock=time.monotonic, now=None):
        if ttl <= 0 or max_entries < 1:
            raise ValueError("Invalid cache limits")
        self.provider = provider
        self.ttl, self.max_entries = ttl, max_entries
        self.clock = clock
        self.now = now or (lambda: datetime.now(SHANGHAI))
        self.cache = OrderedDict()
        self.lock = RLock()

    def _load(self, key, loader):
        with self.lock:
            timestamp = self.clock()
            expired = [key for key, (deadline, _) in self.cache.items() if deadline <= timestamp]
            for item in expired:
                self.cache.pop(item)
            if key in self.cache:
                self.cache.move_to_end(key)
                return copy.deepcopy(self.cache[key][1]), True
            try:
                value = loader()
            except Exception as error:
                raise ValueError(f"{self.provider.source}: {error}") from error
            self.cache[key] = (self.clock() + self.ttl, copy.deepcopy(value))
            while len(self.cache) > self.max_entries:
                self.cache.popitem(last=False)
            return value, False

    def history(self, code: str, count: int) -> dict:
        validate_code(code)
        validate_count(count)

        def load():
            frame = validate_bars(self.provider.history(code, count), count)
            return {"code": code, "source": self.provider.source, "adjustment": "qfq",
                    "bars": frame.to_dict("records")}

        return self._load(("history", code, count), load)[0]

    def closed_history(self, code: str, count: int) -> dict:
        validate_code(code)
        validate_count(count)
        instant = self.now().astimezone(SHANGHAI)
        today = instant.date().isoformat()
        closed = (instant.hour, instant.minute, instant.second) >= (15, 0, 0)

        def load():
            frame = self.provider.history(code, count)
            frame = validate_bars(frame, count)
            eligible = frame["date"] <= today if closed else frame["date"] < today
            if eligible.sum() < count:
                frame = self.provider.history(code, count + 1)
                validate_bars(frame, count)
                dates = frame["date"].astype(str)
                eligible = dates <= today if closed else dates < today
            frame = validate_bars(frame.loc[eligible], count)
            return {"code": code, "source": self.provider.source, "adjustment": "qfq",
                    "bars": frame.to_dict("records")}

        return self._load(("closed_history", code, count, today, closed), load)[0]

    def quotes(self, codes: list[str]) -> list[dict]:
        if not codes or len(codes) > 100:
            raise ValueError("codes must contain 1 to 100 entries")
        codes = list(dict.fromkeys(validate_code(code) for code in codes))

        def load():
            rows = self.provider.quotes(codes)
            indexed = {row["code"]: row for row in rows}
            result = []
            for code in codes:
                if code not in indexed:
                    raise ValueError(f"Missing quote: {code}")
                row = indexed[code]
                price = row.get("price")
                if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or price <= 0:
                    raise ValueError(f"Invalid quote: {code}")
                result.append({"code": code, "name": str(row.get("name", "")), "price": float(price),
                               "source": self.provider.source, "as_of": self.now().astimezone(SHANGHAI).isoformat(),
                               "stale": False})
            return result

        result, cached = self._load(("quotes", tuple(codes)), load)
        if cached:
            for row in result:
                row["stale"] = True
        return result
