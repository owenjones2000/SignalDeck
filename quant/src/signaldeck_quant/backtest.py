import math
from decimal import Decimal, ROUND_FLOOR

import pandas as pd

from .data import validate_bars
from .rules import strategy_orders


def run_backtest(
    frame: pd.DataFrame,
    strategy: str,
    init_capital: float = 100000,
    position_pct: float = 1.0,
    commission: float = 0.0003,
    stamp_tax: float = 0.0005,
) -> dict:
    for name, value in {"init_capital": init_capital, "position_pct": position_pct,
                        "commission": commission, "stamp_tax": stamp_tax}.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"Invalid {name}")
    if init_capital <= 0 or not 0 < position_pct <= 1:
        raise ValueError("Invalid capital or position_pct")
    if not 0 <= commission < 1 or not 0 <= stamp_tax < 1:
        raise ValueError("Invalid fee rate")
    buys, sells = strategy_orders(frame, strategy)
    frame = validate_bars(frame, len(frame))
    cash = Decimal(str(init_capital))
    allocation = Decimal(str(position_pct))
    fee_rate, tax_rate = Decimal(str(commission)), Decimal(str(stamp_tax))
    shares = 0
    trades, equity = [], []
    peak = cash
    max_drawdown = Decimal(0)
    for index, row in enumerate(frame.to_dict("records")):
        if index > 0 and row["volume"] > 0:
            price = Decimal(str(row["open"]))
            side = None
            if shares and sells.iloc[index - 1]:
                side = "sell"
                quantity = shares
                gross = price * quantity
                fee, tax = gross * fee_rate, gross * tax_rate
                cash += gross - fee - tax
                shares = 0
            elif not shares and buys.iloc[index - 1]:
                lot_cost = price * 100 * (1 + fee_rate)
                quantity = int((cash * allocation / lot_cost).to_integral_value(rounding=ROUND_FLOOR)) * 100
                if quantity:
                    side = "buy"
                    gross = price * quantity
                    fee, tax = gross * fee_rate, Decimal(0)
                    cash -= gross + fee
                    shares = quantity
            if side:
                trades.append({"type": side, "signal_date": str(frame.iloc[index - 1]["date"]),
                               "date": str(row["date"]), "price": float(price), "shares": quantity,
                               "commission": float(fee), "stamp_tax": float(tax)})
        value = cash + shares * Decimal(str(row["close"]))
        peak = max(peak, value)
        max_drawdown = max(max_drawdown, (peak - value) / peak)
        equity.append({"date": str(row["date"]), "equity": float(value)})
    final = equity[-1]["equity"]
    return {"strategy": strategy, "init_capital": init_capital, "final_equity": final,
            "total_return": final / init_capital - 1, "max_drawdown": float(max_drawdown),
            "cash": float(cash), "position_shares": shares, "trades": trades, "equity_curve": equity,
            "limitations": ["long_only", "single_position", "next_open", "100_share_lots",
                            "no_slippage", "no_price_limit_matching", "qfq_prices_not_actual_fills"]}
