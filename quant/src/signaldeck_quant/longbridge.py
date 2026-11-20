import asyncio
import importlib.util
import json
import math
import os
import re
import threading
from datetime import datetime, timezone
from typing import Callable, Protocol

from fastapi import APIRouter, Request
from starlette.exceptions import HTTPException
from starlette.responses import StreamingResponse


class LongbridgeError(Exception):
    pass


class QuoteSDK(Protocol):
    def set_on_quote(self, callback: Callable) -> None: ...

    def subscribe(self, symbols: list[str]) -> None: ...

    def unsubscribe(self, symbols: list[str]) -> None: ...


def finite_number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def quote_payload(symbol: str, event) -> dict:
    timestamp = getattr(event, "timestamp", None)
    if isinstance(timestamp, datetime):
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        timestamp = timestamp.astimezone(timezone.utc).isoformat()
    else:
        timestamp = None
    return {
        "symbol": symbol,
        "price": finite_number(getattr(event, "last_done", None)),
        **{key: finite_number(getattr(event, key, None))
           for key in ("open", "high", "low", "volume", "turnover")},
        "timestamp": timestamp,
        "source": "longbridge",
    }


class QuoteListener:
    def __init__(self, symbols: list[str]):
        self.symbols = frozenset(symbols)
        self._loop = asyncio.get_running_loop()
        self._lock = threading.Lock()
        self._pending = {}
        self._wake = asyncio.Event()
        self._scheduled = False
        self._closed = False

    def publish(self, payload: dict) -> None:
        with self._lock:
            if self._closed:
                return
            self._pending[payload["symbol"]] = payload
            self._notify()

    def _notify(self) -> None:
        if not self._scheduled:
            self._scheduled = True
            try:
                self._loop.call_soon_threadsafe(self._wake.set)
            except RuntimeError:
                self._scheduled = False

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._pending.clear()
            self._notify()

    async def receive(self, timeout: float = 15) -> tuple[str, dict]:
        while True:
            with self._lock:
                if self._closed:
                    return "error", {"error": "service_closed", "source": "longbridge"}
                if self._pending:
                    symbol = next(iter(self._pending))
                    return "quote", self._pending.pop(symbol)
                self._wake.clear()
                self._scheduled = False
            try:
                await asyncio.wait_for(self._wake.wait(), timeout)
            except TimeoutError:
                return "heartbeat", {"source": "longbridge"}


async def finish_task(task: asyncio.Task):
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
    return task.result()


class QuoteHub:
    def __init__(self, factory: Callable[[], QuoteSDK]):
        self._factory = factory
        self._sdk = None
        self._lock = asyncio.Lock()
        self._push_lock = threading.Lock()
        self._listeners = {}
        self._subscribed = set()
        self._closed = False
        self.error = None

    def _on_quote(self, symbol: str, event) -> None:
        payload = quote_payload(symbol, event)
        with self._push_lock:
            listeners = [listener for listener in self._listeners if symbol in listener.symbols]
        for listener in listeners:
            listener.publish(payload)

    async def attach(self, symbols: list[str]) -> QuoteListener:
        task = asyncio.create_task(self._attach(symbols))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            try:
                listener = await finish_task(task)
            except Exception:
                pass
            else:
                await finish_task(asyncio.create_task(self._detach(listener)))
            raise

    async def _attach(self, symbols: list[str]) -> QuoteListener:
        async with self._lock:
            if self._closed:
                raise LongbridgeError("service_closed")
            if self._sdk is None:
                try:
                    sdk = await asyncio.to_thread(self._factory)
                    await asyncio.to_thread(sdk.set_on_quote, self._on_quote)
                    self._sdk = sdk
                except Exception:
                    self.error = "connection_failed"
                    raise LongbridgeError(self.error) from None
            with self._push_lock:
                referenced = set().union(*self._listeners.values())
            orphaned = self._subscribed - referenced
            if orphaned:
                await self._unsubscribe(sorted(orphaned))
                if self._subscribed & orphaned:
                    raise LongbridgeError("unsubscribe_failed")
            listener = QuoteListener(symbols)
            with self._push_lock:
                self._listeners[listener] = set(symbols)
            new = [symbol for symbol in symbols if symbol not in self._subscribed]
            if new:
                try:
                    await asyncio.to_thread(self._sdk.subscribe, new)
                except Exception:
                    with self._push_lock:
                        self._listeners.pop(listener, None)
                    listener.close()
                    try:
                        await asyncio.to_thread(self._sdk.unsubscribe, new)
                    except Exception:
                        self._subscribed.update(new)
                    self.error = "subscription_failed"
                    raise LongbridgeError("subscription_failed") from None
                self._subscribed.update(new)
            self.error = None
            return listener

    async def _unsubscribe(self, symbols: list[str]) -> None:
        if not symbols or self._sdk is None:
            return
        try:
            await asyncio.to_thread(self._sdk.unsubscribe, symbols)
        except Exception:
            self.error = "unsubscribe_failed"
        else:
            self._subscribed.difference_update(symbols)

    async def detach(self, listener: QuoteListener) -> None:
        task = asyncio.create_task(self._detach(listener))
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await finish_task(task)
            raise

    async def _detach(self, listener: QuoteListener) -> None:
        async with self._lock:
            with self._push_lock:
                symbols = self._listeners.pop(listener, set())
                remaining = set().union(*self._listeners.values())
            listener.close()
            await self._unsubscribe(sorted(symbols - remaining))

    async def shutdown(self) -> None:
        task = asyncio.create_task(self._shutdown())
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await finish_task(task)
            raise

    async def _shutdown(self) -> None:
        async with self._lock:
            self._closed = True
            with self._push_lock:
                listeners = list(self._listeners)
                self._listeners.clear()
            for listener in listeners:
                listener.close()
            await self._unsubscribe(sorted(self._subscribed))
            if not self._subscribed:
                self._sdk = None


def parse_symbols(value: str) -> list[str]:
    raw = value.split(",")
    if not 1 <= len(raw) <= 20:
        raise HTTPException(422, "invalid_symbols")
    symbols = []
    for symbol in raw:
        if re.fullmatch(r"[A-Z][A-Z0-9]{0,14}(?:[.-][A-Z0-9]{1,10})?\.US", symbol):
            normalized = symbol
        elif re.fullmatch(r"[0-9]{1,5}\.HK", symbol) and int(symbol[:-3]) > 0:
            normalized = f"{int(symbol[:-3])}.HK"
        elif re.fullmatch(r"[0-9]{6}\.(SH|SZ)", symbol):
            normalized = symbol
        else:
            raise HTTPException(422, "invalid_symbols")
        if normalized not in symbols:
            symbols.append(normalized)
    return symbols


def sdk_available() -> bool:
    try:
        return importlib.util.find_spec("longbridge.openapi") is not None
    except (ImportError, ValueError):
        return False


class LongbridgeSDK:
    def __init__(self, credentials: dict[str, str]):
        from longbridge.openapi import Config, QuoteContext, SubType

        config = Config.from_apikey(
            credentials["LONGPORT_APP_KEY"], credentials["LONGPORT_APP_SECRET"],
            credentials["LONGPORT_ACCESS_TOKEN"], enable_print_quote_packages=False,
        )
        self._context = QuoteContext(config)
        self._quote = SubType.Quote

    def set_on_quote(self, callback: Callable) -> None:
        self._context.set_on_quote(callback)

    def subscribe(self, symbols: list[str]) -> None:
        self._context.subscribe(symbols, [self._quote])

    def unsubscribe(self, symbols: list[str]) -> None:
        self._context.unsubscribe(symbols, [self._quote])


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'), allow_nan=False)}\n\n"


class QuoteStreamResponse(StreamingResponse):
    def __init__(self, hub: QuoteHub, listener: QuoteListener, symbols: list[str], heartbeat: float):
        self._hub = hub
        self._listener = listener

        async def events():
            yield sse_event("ready", {"symbols": symbols, "source": "longbridge"})
            while True:
                event, payload = await listener.receive(heartbeat)
                yield sse_event(event, payload)
                if event == "error":
                    return

        super().__init__(events(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
        })

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            await self._hub.detach(self._listener)


class LongbridgeService:
    def __init__(self, credentials: dict[str, str] | None = None,
                 factory: Callable[[], QuoteSDK] | None = None, heartbeat: float = 15):
        keys = ("LONGPORT_APP_KEY", "LONGPORT_APP_SECRET", "LONGPORT_ACCESS_TOKEN")
        values = credentials if credentials is not None else os.environ
        credentials = {key: values.get(key, "").strip() for key in keys}
        self._configured = factory is not None or all(credentials.values())
        self._injected = factory is not None
        self._closed = False
        self._heartbeat = heartbeat
        self.hub = QuoteHub(factory if factory is not None else lambda: LongbridgeSDK(credentials))
        self.router = APIRouter(prefix="/longbridge")
        self.router.add_api_route("/status", self.status, methods=["GET"])
        self.router.add_api_route("/stream", self.stream, methods=["GET"])

    def status(self) -> dict:
        if self._closed:
            error = "service_closed"
        elif not self._configured:
            error = "not_configured"
        elif not self._injected and not sdk_available():
            error = "sdk_unavailable"
        else:
            error = self.hub.error
        return {"configured": bool(self._configured), "available": error is None,
                "source": "longbridge", "error": error}

    async def stream(self, request: Request) -> StreamingResponse:
        values = request.query_params.getlist("symbols")
        if len(values) != 1:
            raise HTTPException(422, "invalid_symbols")
        symbols = parse_symbols(values[0])
        status = self.status()
        if status["error"] in ("service_closed", "not_configured", "sdk_unavailable"):
            raise HTTPException(503, status["error"])
        try:
            listener = await self.hub.attach(symbols)
        except LongbridgeError as error:
            raise HTTPException(503 if str(error) == "service_closed" else 502, str(error)) from None
        return QuoteStreamResponse(self.hub, listener, symbols, self._heartbeat)

    async def shutdown(self) -> None:
        self._closed = True
        await self.hub.shutdown()
