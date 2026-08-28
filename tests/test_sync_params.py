import json

from src.sync import params as p


def test_compare_values_equal_json():
    status, is_json, changes, patch = p.compare_values('{"a": 1}', '{"a": 1}')
    assert status == "equal"
    assert is_json is True
    assert changes == []
    assert patch == '{"a": 1}'


def test_compare_values_partial_patch_only_changes_changed_keys():
    a = '{"common": "keep", "rate": 10, "nested": {"x": 1, "y": 2}}'
    b = '{"common": "keep", "rate": 20, "nested": {"x": 1, "y": 9}, "new_key": 1}'

    status, is_json, changes, patch = p.compare_values(a, b)

    assert status == "different"
    assert is_json is True
    patched = json.loads(patch)
    assert patched["common"] == "keep"  # untouched
    assert patched["rate"] == 20
    assert patched["nested"] == {"x": 1, "y": 9}
    assert patched["new_key"] == 1

    paths = {c["path"] for c in changes}
    assert "$.rate" in paths
    assert "$.nested.y" in paths
    assert "$.new_key" in paths
    assert "$.common" not in paths


def test_compare_values_removes_keys_present_only_in_a():
    a = '{"a": 1, "gone": 2}'
    b = '{"a": 1}'

    status, is_json, changes, patch = p.compare_values(a, b)

    assert status == "different"
    assert json.loads(patch) == {"a": 1}
    assert any(c["path"] == "$.gone" and c["op"] == "del" for c in changes)


def test_compare_values_list_patch():
    a = '{"items": ["a", "b", "x"]}'
    b = '{"items": ["a", "b", "c"]}'

    status, is_json, changes, patch = p.compare_values(a, b)

    assert status == "different"
    assert json.loads(patch) == {"items": ["a", "b", "c"]}


def test_compare_values_plain_strings():
    status, is_json, changes, patch = p.compare_values("abc", "abd")
    assert status == "different"
    assert is_json is False
    assert patch == "abd"
    assert changes == [{"path": "$", "op": "set", "old": "abc", "new": "abd"}]


def test_compare_values_equal_plain_strings():
    status, is_json, changes, patch = p.compare_values("abc", "abc")
    assert status == "equal"
    assert is_json is False
    assert changes == []


def test_compare_values_one_side_not_json_treated_as_string():
    status, is_json, changes, patch = p.compare_values("{not: json", '{"rate": 20}')
    assert status == "different"
    assert is_json is False
    assert patch == '{"rate": 20}'


def test_shell_quote_escapes_single_quotes():
    assert p._shell_quote("a'b") == "'a'\\''b'"


def test_build_ssm_script():
    class FakeCfg:
        profile = "dev-profile"
        region = "us-west-2"

    script = p.build_ssm_script("/app/rate", "20", "String", FakeCfg())

    assert "--profile 'dev-profile'" in script
    assert "--region 'us-west-2'" in script
    assert "--type String" in script
    assert "--overwrite" in script
    assert "--name '/app/rate'" in script


def test_build_secret_script():
    class FakeCfg:
        profile = "qa-profile"
        region = "us-west-1"

    script = p.build_secret_script("/app/secret", '{"a": 1}', FakeCfg())

    assert script.startswith("aws secretsmanager update-secret")
    assert "--secret-id '/app/secret'" in script
    assert "--profile 'qa-profile'" in script
    assert "--region 'us-west-1'" in script


def test_diff_params_missing_in_a(monkeypatch):
    class FakeCfg:
        profile = "a-profile"
        region = "us-east-1"

        def __init__(self, name):
            self.name = name

    monkeypatch.setattr(
        p, "read_parameter",
        lambda cfg, name: (_raise_not_found() if cfg.name == "a" else ("20", "String")),
    )

    class FakeA(FakeCfg):
        pass

    class FakeB(FakeCfg):
        pass

    def _raise_not_found():
        raise p.ParamNotFound("x")

    result = p.diff_params(FakeA("a"), FakeB("b"), "ssm", "/app/rate", "a", "b")

    assert result.status == "missing_in_a"
    assert result.value_b == "20"
    assert "aws ssm put-parameter" in result.script
    assert "--profile 'a-profile'" in result.script


def test_diff_params_equal(monkeypatch):
    def fake_read(cfg, name):
        return ("same-value", "String")

    monkeypatch.setattr(p, "read_parameter", fake_read)

    class FakeCfg:
        profile = "p"
        region = "r"

    result = p.diff_params(FakeCfg(), FakeCfg(), "ssm", "/x", "a", "b")

    assert result.status == "equal"
    assert result.script is None
    assert result.value_a == "same-value"