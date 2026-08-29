import pytest
from fastapi import HTTPException

from src.config import Config
from src.sync import db_objects as obj
from src.sync import params as p
from src.web.server import (
    api_envs,
    api_db_diff,
    api_params_apply,
    api_params_apply_execute,
    api_params_diff,
    api_params_read,
    ApplyParamsRequest,
    DbDiffRequest,
    ExecuteParamsRequest,
    ParamsDiffRequest,
    ReadParamsEntry,
)


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


class _CaptureDiff:
    def __init__(self, fake_result):
        self.fake_result = fake_result
        self.kwargs = None

    def __call__(self, *args, **kwargs):
        self.kwargs = kwargs
        return self.fake_result


def test_api_params_diff_forwards_include_deletes(monkeypatch):
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev", "qa"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(lambda env: _FakeConfig(env)))

    base = p.ParamDiffResult(
        env_a="dev", env_b="qa", service="ssm", name="/x",
        status="missing_in_b", value_a="20", value_type_a="String",
    )
    capture = _CaptureDiff(base)
    monkeypatch.setattr(p, "diff_params", capture)

    api_params_diff(
        ParamsDiffRequest(env_a="dev", env_b="qa", service="ssm", name="/x")
    )
    assert capture.kwargs["include_deletes"] is False

    payload = api_params_diff(
        ParamsDiffRequest(
            env_a="dev", env_b="qa", service="ssm", name="/x",
            include_deletes=True,
        )
    )
    assert capture.kwargs["include_deletes"] is True
    assert payload["status"] == "missing_in_b"


def test_api_params_apply_builds_ssm_script(monkeypatch):
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev", "qa"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(lambda env: _FakeConfig(env)))

    payload = api_params_apply(
        ApplyParamsRequest(
            env_a="dev", env_b="qa", service="ssm", name="/x",
            new_value='{"name": 1}', value_type="SecureString",
        )
    )

    assert payload["script"].startswith("aws ssm put-parameter")
    assert "--type SecureString" in payload["script"]
    assert "--profile 'prof-dev'" in payload["script"]
    assert "'{\"name\": 1}'" in payload["script"]


def test_api_params_apply_builds_secret_script(monkeypatch):
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev", "qa"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(lambda env: _FakeConfig(env)))

    payload = api_params_apply(
        ApplyParamsRequest(
            env_a="qa", env_b="dev", service="secretsmanager", name="/s",
            new_value="pepitos",
        )
    )

    assert payload["script"].startswith("aws secretsmanager update-secret")
    assert "--secret-id '/s'" in payload["script"]
    assert "'pepitos'" in payload["script"]
    assert "--profile 'prof-qa'" in payload["script"]


def test_api_params_apply_execute_requires_confirmation(monkeypatch):
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev", "qa"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(lambda env: _FakeConfig(env)))

    with pytest.raises(HTTPException) as exc_info:
        api_params_apply_execute(
            ExecuteParamsRequest(
                env_a="dev", env_b="qa", service="ssm", name="/x",
                new_value="20", confirm=False,
            )
        )
    assert exc_info.value.status_code == 400
    assert "confirmación" in str(exc_info.value.detail)


def test_api_params_apply_execute_forwards_to_ssm_put(monkeypatch):
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev", "qa"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(lambda env: _FakeConfig(env)))

    captured = {}

    def fake_put(cfg, name, value, value_type):
        captured["cfg_env"] = cfg._env
        captured["value"] = value
        captured["value_type"] = value_type
        return {"ok": True, "message": "listo"}

    monkeypatch.setattr(p, "put_parameter", fake_put)

    payload = api_params_apply_execute(
        ExecuteParamsRequest(
            env_a="qa", env_b="dev", service="ssm", name="/x",
            new_value="20", value_type="SecureString", confirm=True,
        )
    )

    assert captured["cfg_env"] == "qa"
    assert captured["value"] == "20"
    assert captured["value_type"] == "SecureString"
    assert payload["ok"] is True
    assert payload["message"] == "listo"


def test_api_params_apply_execute_forwards_to_secret_update(monkeypatch):
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev", "qa"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(lambda env: _FakeConfig(env)))

    captured = {}

    def fake_update(cfg, name, value):
        captured["name"] = name
        captured["value"] = value
        return {"ok": True, "message": "ok"}

    monkeypatch.setattr(p, "update_secret", fake_update)

    api_params_apply_execute(
        ExecuteParamsRequest(
            env_a="qa", env_b="dev", service="secretsmanager", name="/s",
            new_value="papitas", confirm=True,
        )
    )
    assert captured == {"name": "/s", "value": "papitas"}


def test_api_params_apply_execute_delete_forwards_to_ssm(monkeypatch):
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev", "qa"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(lambda env: _FakeConfig(env)))

    captured = {}
    monkeypatch.setattr(
        p, "delete_parameter",
        lambda cfg, name: captured.update(cfg_env=cfg._env, name=name) or {"ok": True, "message": "del"},
    )
    monkeypatch.setattr(
        p, "delete_secret",
        lambda cfg, name: captured.update(cfg_env=cfg._env, name=name) or {"ok": True, "message": "del"},
    )

    payload = api_params_apply_execute(
        ExecuteParamsRequest(
            env_a="qa", env_b="dev", service="ssm", name="/x", op="delete",
            confirm=True,
        )
    )
    assert captured == {"cfg_env": "qa", "name": "/x"}
    assert payload["op"] == "delete"


class _FakeConn:
    def __init__(self, env):
        self.env = env

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_connect(cfg):
    return _FakeConn(cfg._env)


def test_api_db_diff_missing_in_b_respects_include_deletes(monkeypatch):
    monkeypatch.setattr(
        Config, "known_environments", classmethod(lambda cls: ["dev", "qa"])
    )
    monkeypatch.setattr(Config, "with_env", staticmethod(lambda env: _FakeConfig(env)))
    monkeypatch.setattr("src.web.server.connect", _fake_connect)
    monkeypatch.setattr(obj, "show_create_table",
                        lambda conn, schema, name: (
                            "CREATE TABLE ..." if conn.env == "dev" else None
                        ))
    monkeypatch.setattr(obj, "table_columns", lambda conn, schema, name: [])
    monkeypatch.setattr(obj, "table_indexes", lambda conn, schema, name: [])

    req = DbDiffRequest(
        env_a="dev", env_b="qa", schema_name="yappy", object_type="table",
        object_name="orders", include_deletes=True,
    )
    payload = api_db_diff(req)

    assert payload["status"] == "missing_in_b"
    assert payload["script"] == "DROP TABLE `yappy`.`orders`;"

    req_no_delete = DbDiffRequest(
        env_a="dev", env_b="qa", schema_name="yappy", object_type="table",
        object_name="orders",
    )
    payload_no_delete = api_db_diff(req_no_delete)

    assert payload_no_delete["status"] == "missing_in_b"
    assert payload_no_delete["script"] is None
    assert "no hay nada que sincronizar" in payload_no_delete["notes"][0]