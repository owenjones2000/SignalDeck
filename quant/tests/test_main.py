from signaldeck_quant.__main__ import main


def test_default_loopback(monkeypatch):
    monkeypatch.delenv("QUANT_HOST", raising=False)
    monkeypatch.delenv("QUANT_PORT", raising=False)
    calls = []
    monkeypatch.setattr("signaldeck_quant.__main__.uvicorn.run", lambda *args, **kwargs: calls.append((args, kwargs)))
    main()
    assert calls == [(("signaldeck_quant.api:create_app",), {"factory": True, "host": "127.0.0.1", "port": 8010})]


def test_container_host_and_custom_port(monkeypatch):
    monkeypatch.setenv("QUANT_HOST", "0.0.0.0")
    monkeypatch.setenv("QUANT_PORT", "8020")
    calls = []
    monkeypatch.setattr("signaldeck_quant.__main__.uvicorn.run", lambda *args, **kwargs: calls.append(kwargs))
    main()
    assert calls[0]["host"] == "0.0.0.0"
    assert calls[0]["port"] == 8020
