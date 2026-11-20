BEGIN;
CREATE ROLE signaldeck_reader LOGIN;
CREATE ROLE signaldeck_writer LOGIN;
CREATE SCHEMA signaldeck;
CREATE TABLE signaldeck.kline (
    source text NOT NULL,
    symbol text NOT NULL,
    period text NOT NULL CHECK (period IN ('30', '1D', '1W')),
    adjustment text NOT NULL,
    ts timestamptz NOT NULL,
    open numeric NOT NULL,
    high numeric NOT NULL,
    low numeric NOT NULL,
    close numeric NOT NULL,
    volume bigint NOT NULL CHECK (volume >= 0),
    CHECK (low <= least(open, close) AND high >= greatest(open, close)),
    PRIMARY KEY (source, symbol, period, adjustment, ts)
);
GRANT USAGE ON SCHEMA signaldeck TO signaldeck_reader, signaldeck_writer;
GRANT SELECT ON signaldeck.kline TO signaldeck_reader, signaldeck_writer;
GRANT INSERT, UPDATE (open, high, low, close, volume) ON signaldeck.kline TO signaldeck_writer;
COMMIT;
