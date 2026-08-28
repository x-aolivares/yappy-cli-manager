"""SSM Parameter Store / Secrets Manager comparison between two regions.

Direction is always B -> A: A is the target. When the value is JSON in both
regions the generated "patch" only touches the keys that changed, instead of
overwriting the whole parameter.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field


class ParamNotFound(ValueError):
    pass


def _boto_session(profile: str, region: str):
    import boto3

    return boto3.session.Session(profile_name=profile, region_name=region)


def read_parameter(cfg, name: str) -> tuple[str, str]:
    """Return ``(value, type)`` of an SSM parameter, or raise ParamNotFound."""
    session = _boto_session(cfg.profile, cfg.region)
    client = session.client("ssm")
    try:
        resp = client.get_parameter(Name=name, WithDecryption=True)
    except client.exceptions.ParameterNotFound as exc:
        raise ParamNotFound(name) from exc
    return resp["Parameter"]["Value"], resp["Parameter"]["Type"]


def read_secret(cfg, name: str) -> str:
    """Return the string value of a Secrets Manager secret, or raise ParamNotFound."""
    session = _boto_session(cfg.profile, cfg.region)
    client = session.client("secretsmanager")
    try:
        resp = client.get_secret_value(SecretId=name)
    except client.exceptions.ResourceNotFoundException as exc:
        raise ParamNotFound(name) from exc
    if "SecretString" in resp:
        return resp["SecretString"]
    if "SecretBinary" in resp:
        raise ValueError(
            f"Secret '{name}' is binary; only string secrets are supported."
        )
    raise ValueError(f"Secret '{name}' has no value")


def _shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def build_ssm_script(name: str, value: str, value_type: str, cfg_a) -> str:
    return (
        "aws ssm put-parameter "
        f"--name {_shell_quote(name)} "
        f"--value {_shell_quote(value)} "
        f"--type {value_type or 'String'} "
        "--overwrite "
        f"--profile {_shell_quote(cfg_a.profile)} "
        f"--region {_shell_quote(cfg_a.region)}"
    )


def build_secret_script(name: str, value: str, cfg_a) -> str:
    return (
        "aws secretsmanager update-secret "
        f"--secret-id {_shell_quote(name)} "
        f"--secret-string {_shell_quote(value)} "
        f"--profile {_shell_quote(cfg_a.profile)} "
        f"--region {_shell_quote(cfg_a.region)}"
    )


def _get(node, key):
    if isinstance(node, dict):
        return node.get(key)
    return node[key] if 0 <= key < len(node) else None


def _diff_tree(a, b):
    """Return a tree of changes (only differing paths) between two JSON values.

    Each entry is ``key -> (op, payload)`` with op in
    ``add | del | set | patch``.
    """
    if type(a) is dict and type(b) is dict:
        out = {}
        for key in set(a) | set(b):
            if key not in a:
                out[key] = ("add", copy.deepcopy(b[key]))
            elif key not in b:
                out[key] = ("del", None)
            elif type(a[key]) is dict and type(b[key]) is dict:
                sub = _diff_tree(a[key], b[key])
                if sub:
                    out[key] = ("patch", sub)
            elif type(a[key]) is list and type(b[key]) is list:
                sub = _diff_tree(a[key], b[key])
                if sub:
                    out[key] = ("patch", sub)
            elif a[key] != b[key]:
                out[key] = ("set", copy.deepcopy(b[key]))
        return out

    if type(a) is list and type(b) is list:
        if a == b:
            return {}
        out = {}
        for i in range(max(len(a), len(b))):
            if i >= len(a):
                out[i] = ("add", copy.deepcopy(b[i]))
            elif i >= len(b):
                out[i] = ("del", None)
            elif type(a[i]) is dict and type(b[i]) is dict:
                sub = _diff_tree(a[i], b[i])
                if sub:
                    out[i] = ("patch", sub)
            elif type(a[i]) is list and type(b[i]) is list:
                sub = _diff_tree(a[i], b[i])
                if sub:
                    out[i] = ("patch", sub)
            elif a[i] != b[i]:
                out[i] = ("set", copy.deepcopy(b[i]))
        return out

    return {}


def apply_patch(source, tree):
    """Apply the change tree onto ``source``; untouched parts keep A's values."""
    if isinstance(source, dict):
        out = copy.deepcopy(source)
        for key, (op, payload) in tree.items():
            if op == "del":
                out.pop(key, None)
            elif op in ("add", "set"):
                out[key] = copy.deepcopy(payload)
            elif op == "patch":
                out[key] = apply_patch(out.get(key, {}), payload)
        return out

    if isinstance(source, list):
        out = copy.deepcopy(source)
        # Deletions first (from the end) to keep earlier indexes valid.
        for key in sorted(tree, reverse=True):
            op, payload = tree[key]
            if op == "del":
                if key < len(out):
                    del out[key]
        for key in sorted(tree):
            op, payload = tree[key]
            if op in ("add", "set"):
                while key >= len(out):
                    out.append(None)
                out[key] = copy.deepcopy(payload)
            elif op == "patch":
                while key >= len(out):
                    out.append({})
                out[key] = apply_patch(out[key], payload)
        return out

    return copy.deepcopy(source)


def _flatten(tree, a, b, path: str = "$"):
    rows = []
    for key in sorted(tree):
        op, payload = tree[key]
        old = _get(a, key)
        new = payload if op != "del" else None
        if op == "patch":
            rows.extend(
                _flatten(payload, a[key], b[key], f"{path}.{key}")
            )
        else:
            rows.append(
                {
                    "path": f"{path}.{key}",
                    "op": op,
                    "old": old,
                    "new": new,
                }
            )
    return rows


def compare_values(value_a: str, value_b: str):
    """Compare two string parameter values.

    Returns ``(status, is_json, changes, patch_value)``:
    - ``status``: ``equal`` | ``different``
    - ``changes``: human-readable list of ``{path, op, old, new}`` (empty if equal)
    - ``patch_value``: value to write on A (JSON with only the changed keys
      when both sides are JSON, otherwise B's full value).
    """
    def parse(v: str):
        try:
            return json.loads(v)
        except (TypeError, ValueError):
            return None

    a = parse(value_a)
    b = parse(value_b)
    if a is not None and b is not None:
        tree = _diff_tree(a, b)
        if not tree:
            return "equal", True, [], value_a
        return "different", True, _flatten(tree, a, b), json.dumps(
            apply_patch(a, tree), indent=2, ensure_ascii=False
        )
    if value_a == value_b:
        return "equal", False, [], value_a
    return (
        "different",
        False,
        [{"path": "$", "op": "set", "old": value_a, "new": value_b}],
        value_b,
    )


@dataclass
class ParamDiffResult:
    env_a: str
    env_b: str
    service: str
    name: str
    status: str
    value_a: str | None = None
    value_b: str | None = None
    value_type_a: str | None = None
    value_type_b: str | None = None
    is_json: bool = False
    changes: list = field(default_factory=list)
    patch_value: str | None = None
    script: str | None = None
    notes: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "env_a": self.env_a,
            "env_b": self.env_b,
            "service": self.service,
            "name": self.name,
            "status": self.status,
            "value_a": self.value_a,
            "value_b": self.value_b,
            "value_type_a": self.value_type_a,
            "value_type_b": self.value_type_b,
            "is_json": self.is_json,
            "changes": self.changes,
            "patch_value": self.patch_value,
            "script": self.script,
            "notes": self.notes,
        }


def _build_script(service: str, name: str, value: str, value_type: str | None, cfg_a) -> str:
    if service == "ssm":
        return build_ssm_script(name, value, value_type or "String", cfg_a)
    return build_secret_script(name, value, cfg_a)


def diff_params(cfg_a, cfg_b, service: str, name: str, env_a: str, env_b: str) -> ParamDiffResult:
    """Compare a parameter/secret named ``name`` between region A and region B."""
    if service not in ("ssm", "secretsmanager"):
        raise ValueError("service must be 'ssm' or 'secretsmanager'")
    read = read_parameter if service == "ssm" else read_secret

    def safe_read(cfg):
        try:
            return read(cfg, name)
        except ParamNotFound:
            return None

    a = safe_read(cfg_a)
    b = safe_read(cfg_b)

    if service == "ssm":
        value_a, type_a = a if a else (None, None)
        value_b, type_b = b if b else (None, None)
    else:
        value_a, type_a = (a, None) if a else (None, None)
        value_b, type_b = (b, None) if b else (None, None)

    if value_a is None and value_b is None:
        return ParamDiffResult(
            env_a=env_a, env_b=env_b, service=service, name=name,
            status="none",
            notes=[f"No existe en ninguna de las dos regiones."],
        )

    if value_a is None:
        return ParamDiffResult(
            env_a=env_a, env_b=env_b, service=service, name=name,
            status="missing_in_a",
            value_b=value_b, value_type_b=type_b,
            script=_build_script(service, name, value_b, type_b, cfg_a),
            notes=[f"Existe solo en {env_b} — debe crearse en {env_a}."],
        )

    if value_b is None:
        return ParamDiffResult(
            env_a=env_a, env_b=env_b, service=service, name=name,
            status="missing_in_b",
            value_a=value_a, value_type_a=type_a,
            notes=[f"Existe en {env_a} pero no en {env_b} — no hay nada que sincronizar (B→A)."],
        )

    status, is_json, changes, patch_value = compare_values(value_a, value_b)

    if status == "equal":
        return ParamDiffResult(
            env_a=env_a, env_b=env_b, service=service, name=name,
            status="equal",
            value_a=value_a, value_b=value_b,
            value_type_a=type_a, value_type_b=type_b,
            is_json=is_json,
            notes=["No hay cambios."],
        )

    new_value = patch_value if is_json else value_b
    return ParamDiffResult(
        env_a=env_a, env_b=env_b, service=service, name=name,
        status="different",
        value_a=value_a, value_b=value_b,
        value_type_a=type_a, value_type_b=type_b,
        is_json=is_json,
        changes=changes,
        patch_value=patch_value,
        script=_build_script(service, name, new_value, type_b, cfg_a),
        notes=[f"Hay cambios de {env_b} → {env_a}."],
    )