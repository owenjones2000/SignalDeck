from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

from signaldeck_quant.kline import PERIODS, SYMBOL, fetch_rows, history


def test_import_requests_only_forward_adjusted_periods():
    candle = SimpleNamespace(timestamp=datetime(2026, 11, 20, 9, 30),
                             open=1, high=2, low=1, close=2, volume=100)
    context = Mock()
    context.candlesticks.return_value = [candle]
    sdk = SimpleNamespace(Period=SimpleNamespace(**{name: name for name in PERIODS.values()}),
                          AdjustType=SimpleNamespace(ForwardAdjust='forward'))
    rows = list(fetch_rows(context, sdk))
    assert [call.args for call in context.candlesticks.call_args_list] == [
        (SYMBOL, period, 300, 'forward') for period in PERIODS.values()
    ]
    assert [row[2] for row in rows] == list(PERIODS)
    assert rows[0][:5] == ('longbridge', SYMBOL, '30', 'forward',
                           datetime(2026, 11, 20, 1, 30, tzinfo=timezone.utc))


def test_history_rejects_unknown_period():
    assert history('60').status_code == 400
