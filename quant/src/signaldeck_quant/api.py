import logging
from contextlib import asynccontextmanager
from typing import Annotated

import pandas as pd
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator
from starlette.exceptions import HTTPException

from .backtest import run_backtest
from .data import AkShareProvider, MarketData, validate_code
from . import kline
from .longbridge import LongbridgeService
from .rules import FORMULAS, STRATEGIES, evaluate_formula, latest_signals


Code = Annotated[str, StringConstraints(strict=True)]
Count = Annotated[int, Field(strict=True, ge=1, le=2000)]
Codes = Annotated[list[Code], Field(min_length=1, max_length=100)]
logger = logging.getLogger("signaldeck_quant")


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class CodesInput(Input):
    codes: Codes

    @field_validator("codes")
    @classmethod
    def valid_codes(cls, codes):
        return list(dict.fromkeys(validate_code(code) for code in codes))


class HistoryInput(Input):
    code: Code
    count: Count = 250

    @field_validator("code")
    @classmethod
    def valid_code(cls, code):
        return validate_code(code)


class ScreenInput(CodesInput):
    formula: str
    count: Count = 250

    @model_validator(mode="after")
    def valid_formula(self):
        if self.formula not in FORMULAS:
            raise ValueError("Unknown formula")
        if self.count < FORMULAS[self.formula]["min_history"]:
            raise ValueError("Insufficient history count for formula")
        return self


class BacktestInput(HistoryInput):
    strategy: str
    init_capital: Annotated[float, Field(strict=True, gt=0)] = 100000
    position_pct: Annotated[float, Field(strict=True, gt=0, le=1)] = 1.0
    commission: Annotated[float, Field(strict=True, ge=0, lt=1)] = 0.0003
    stamp_tax: Annotated[float, Field(strict=True, ge=0, lt=1)] = 0.0005

    @model_validator(mode="after")
    def valid_strategy(self):
        if self.strategy not in STRATEGIES:
            raise ValueError("Unknown strategy")
        if self.count < STRATEGIES[self.strategy]["min_history"]:
            raise ValueError("Insufficient history count for strategy")
        return self


def create_app(data: MarketData | None = None, longbridge: LongbridgeService | None = None) -> FastAPI:
    longbridge = longbridge if longbridge is not None else LongbridgeService()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            yield
        finally:
            await longbridge.shutdown()

    app = FastAPI(title="SignalDeck internal quant", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.include_router(longbridge.router)
    app.include_router(kline.router)
    market = data if data is not None else MarketData(AkShareProvider())

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        details = "; ".join(f"{'.'.join(map(str, item['loc']))}: {item['msg']}" for item in error.errors())
        return JSONResponse(status_code=422, content={"error": details})

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException):
        return JSONResponse(status_code=error.status_code, content={"error": str(error.detail)})

    @app.exception_handler(ValueError)
    async def supplier_error(request: Request, error: ValueError):
        return JSONResponse(status_code=502, content={"error": str(error)})

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, error: Exception):
        logger.exception("Unexpected quant error", exc_info=error)
        return JSONResponse(status_code=500, content={"error": "Internal quant service error"})

    @app.get("/health")
    def health():
        return {"status": "ok", "source": market.provider.source, "market_verified": False}

    @app.get("/formulas")
    def formulas():
        return [{"key": key, **metadata} for key, metadata in FORMULAS.items()]

    @app.get("/strategies")
    def strategies():
        return [{"key": key, **metadata} for key, metadata in STRATEGIES.items()]

    @app.post("/quotes")
    def quotes(params: CodesInput):
        return market.quotes(params.codes)

    @app.post("/history")
    def history(params: HistoryInput):
        return market.history(params.code, params.count)

    @app.post("/screen")
    def screen(params: ScreenInput):
        hits, failures = [], []
        for code in params.codes:
            try:
                frame = pd.DataFrame(market.closed_history(code, params.count)["bars"])
                if evaluate_formula(frame, params.formula):
                    hits.append({"code": code, "formula": params.formula,
                                 "date": str(frame.iloc[-1]["date"]), "price": float(frame.iloc[-1]["close"])})
            except ValueError as error:
                failures.append({"code": code, "error": str(error)})
        return {"hits": hits, "failures": failures}

    @app.post("/backtest")
    def backtest(params: BacktestInput):
        history = market.closed_history(params.code, params.count)
        result = run_backtest(pd.DataFrame(history["bars"]), params.strategy, params.init_capital,
                              params.position_pct, params.commission, params.stamp_tax)
        return {"code": params.code, "source": history["source"], "adjustment": history["adjustment"], **result}

    @app.post("/signals")
    def signals(params: CodesInput):
        found, failures = [], []
        for code in params.codes:
            try:
                frame = pd.DataFrame(market.closed_history(code, 120)["bars"])
                found.extend(latest_signals(frame, code))
            except ValueError as error:
                failures.append({"code": code, "error": str(error)})
        return {"signals": found, "failures": failures}

    return app
