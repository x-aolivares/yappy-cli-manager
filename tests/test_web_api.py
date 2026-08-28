import pytest
from fastapi import HTTPException

from src.config import Config
from src.sync import params as p
from src.web.server import api_envs, api_params_read, ReadParamsEntry


class _FakeConfig:
    def __init__(self, env):
        self._env = env

    @property
    def region(self):
        return "us-east-1"

    @property
    def profile(self):
        return "prof-" + self._env


def _fake_with_env(env):
    if env == "broken":
        raise ValueError("Missing required config: AWS_REGION")
    return _FakeConfig(env)


def test_api_envs_keeps_envs_and_reports_load_errors(monkeypatch):
    monkeypatch.setattr(Config, "_get_config_dir", classmethod(lambda cls: None))
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev", "broken"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(_fake_with_env))

    payload = api_envs()

    assert payload["config_dir"] == "None"  # _get_config_dir mocked -> str(None)
    assert len(payload["environments"]) == 2
    by_env = {e["env"]: e for e in payload["environments"]}

    assert by_env["dev"]["load_error"] is None
    assert by_env["dev"]["profile"] == "prof-dev"
    assert by_env["dev"]["region"] == "us-east-1"

    assert by_env["broken"]["load_error"] == "Missing required config: AWS_REGION"
    assert by_env["broken"]["profile"] is None
    assert by_env["broken"]["region"] is None


def _fake_read_many(cfg, entries):
    return [
        {
            "key": e["key"],
            "is_secret": e["is_secret"],
            "service": "secretsmanager" if e["is_secret"] else "ssm",
            "value": "valor-" + e["key"],
            "value_type": None,
            "ok": True,
            "error": None,
        }
        for e in entries
    ]


def test_api_params_read_ok(monkeypatch):
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(lambda env: _FakeConfig(env)))
    monkeypatch.setattr(p, "read_many", staticmethod(_fake_read_many))

    payload = api_params_read(
        env="dev",
        body=[
            ReadParamsEntry(key="/rate"),
            ReadParamsEntry(key="/secret", is_secret=True),
        ],
    )

    assert payload["env"] == "dev"
    assert payload["ok_count"] == 2 and payload["err_count"] == 0
    assert payload["results"][0]["key"] == "/rate"
    assert payload["results"][1]["service"] == "secretsmanager"


def test_api_params_read_empty_list_returns_400(monkeypatch):
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(lambda env: _FakeConfig(env)))

    with pytest.raises(HTTPException) as exc_info:
        api_params_read(env="dev", body=[])

    assert exc_info.value.status_code == 400
    assert "vacía" in str(exc_info.value.detail)