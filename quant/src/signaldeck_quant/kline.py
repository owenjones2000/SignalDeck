import os
from datetime import timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from fastapi.responses import JSONResponse

PERIODS = {"30": "Min_30", "1D": "Day", "1W": "Week"}
SYMBOL = "07709.HK"
KEY = ("longbridge", SYMBOL)
router = APIRouter()


def connect(variable):
    import psycopg

    connection = psycopg.connect(os.environ[variable], connect_timeout=5)
    try:
        database, elevated = connection.execute(
            "SELECT current_database(), rolsuper FROM pg_roles WHERE rolname = current_user"
        ).fetchone()
        if database != "quant_db" or elevated:
            raise RuntimeError("Expected non-superuser connection to quant_db")
    except Exception:
        connection.close()
        raise
    return connection


def fetch_rows(context, sdk):
    for period, name in PERIODS.items():
        candles = context.candlesticks(SYMBOL, getattr(sdk.Period, name), 300, sdk.AdjustType.ForwardAdjust)
        if not candles or len(candles) > 300:
            raise RuntimeError("Unexpected Longbridge candle count")
        for bar in candles:
            timestamp = bar.timestamp
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=ZoneInfo("Asia/Hong_Kong"))
            yield (*KEY, period, "forward", timestamp.astimezone(timezone.utc),
                   bar.open, bar.high, bar.low, bar.close, bar.volume)


def main():
    try:
        from longbridge import openapi as sdk

        config = sdk.Config.from_apikey(
            *(os.environ[name] for name in ("LONGPORT_APP_KEY", "LONGPORT_APP_SECRET", "LONGPORT_ACCESS_TOKEN")),
            enable_print_quote_packages=False,
        )
        rows = list(fetch_rows(sdk.QuoteContext(config), sdk))
        with connect("SIGNALDECK_KLINE_WRITE_DSN") as connection, connection.cursor() as cursor:
            cursor.executemany(
                """INSERT INTO signaldeck.kline
                   (source, symbol, period, adjustment, ts, open, high, low, close, volume)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source, symbol, period, adjustment, ts) DO UPDATE SET
                   open=excluded.open, high=excluded.high, low=excluded.low,
                   close=excluded.close, volume=excluded.volume""", rows,
            )
        print(f"Longbridge rows upserted: {len(rows)}")
    except Exception as error:
        raise SystemExit(f"Longbridge import failed: {type(error).__name__}") from None


@router.get("/kline/longbridge/{period}")
def history(period: str):
    if period not in PERIODS:
        return JSONResponse({"error": "unsupported_period"}, status_code=400)
    try:
        with connect("SIGNALDECK_KLINE_READ_DSN") as connection:
            rows = connection.execute(
                """SELECT ts, open, high, low, close, volume FROM signaldeck.kline
                   WHERE source=%s AND symbol=%s AND period=%s AND adjustment='forward'
                   ORDER BY ts DESC LIMIT 300""", (*KEY, period),
            ).fetchall()
    except Exception:
        return JSONResponse({"error": "market_database_unavailable"}, status_code=503)
    return [{"time": int(ts.timestamp() * 1000), "open": float(o), "high": float(h),
             "low": float(l), "close": float(c), "volume": v} for ts, o, h, l, c, v in reversed(rows)]


if __name__ == "__main__":
    main()
