import pytest

from scripts import run_local


@pytest.mark.parametrize('args,expected', [([],8000),(['--port','8001'],8001),(['--port','1024'],1024),(['--port','65535'],65535)])
def test_launcher_port_and_fixed_loopback(monkeypatch, args, expected):
    calls = []
    monkeypatch.setattr(run_local.os, 'chdir', lambda _:None)
    monkeypatch.setattr(run_local, 'load_local_env', lambda _:None)
    monkeypatch.setattr(run_local.uvicorn, 'run', lambda *a,**kw:calls.append((a,kw)))
    run_local.main(args)
    assert calls == [(('app.main:app',), {'host':'127.0.0.1','port':expected,'access_log':False})]


@pytest.mark.parametrize('args', [['--port','1023'],['--port','65536'],['--port','bad'],['--port','8001.5'],['--host','0.0.0.0']])
def test_launcher_rejects_invalid_port_or_host_before_settings(monkeypatch, args):
    def unexpected(*args,**kwargs):
        pytest.fail('Invalid arguments must fail before environment loading or server startup')
    monkeypatch.setattr(run_local, 'load_local_env', unexpected)
    monkeypatch.setattr(run_local.uvicorn, 'run', unexpected)
    with pytest.raises(SystemExit) as failure:
        run_local.main(args)
    assert failure.value.code == 2
