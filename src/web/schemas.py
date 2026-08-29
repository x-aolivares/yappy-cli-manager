"""Pydantic request/response models for the Region Sync web API.

These are the API contract: FastAPI serves them in OpenAPI and the browser
client (Angular) generates its types from them.
"""

from __future__ import annotations

from pydantic import BaseModel


class DbDiffRequest(BaseModel):
    env_a: str
    env_b: str
    schema_name: str
    object_type: str  # "table" | "procedure"
    object_name: str
    include_deletes: bool = False


class ParamsDiffRequest(BaseModel):
    env_a: str
    env_b: str
    service: str  # "ssm" | "secretsmanager"
    name: str
    include_deletes: bool = False
    with_secret: bool = False


class ApplyParamsRequest(BaseModel):
    env_a: str
    env_b: str
    service: str  # "ssm" | "secretsmanager"
    name: str
    new_value: str
    value_type: str = "String"
    with_secret: bool = False
    new_secret_value: str = ""
    write_secret: bool = False
    write_param: bool = True
    target: str = "a"  # "a" (destino) | "b" (origen)


class ExecuteParamsRequest(BaseModel):
    env_a: str
    env_b: str
    service: str  # "ssm" | "secretsmanager"
    op: str = "update"  # "update" | "delete"
    name: str
    new_value: str = ""
    value_type: str = "String"
    confirm: bool = False
    with_secret: bool = False
    new_secret_value: str = ""
    write_secret: bool = False
    write_param: bool = True
    target: str = "a"  # "a" (destino) | "b" (origen)


class CreateMultiParamsRequest(BaseModel):
    name: str
    value: str = ""
    value_type: str = "String"
    envs: list[str] = []
    create_secret: bool = False
    dry_run: bool = False
    confirm: bool = False


class ExecuteRequest(BaseModel):
    env: str
    object_type: str  # "table" | "procedure"
    schema_name: str = ""
    code: str


class ReadParamsEntry(BaseModel):
    key: str = ""
    name: str = ""
    is_secret: bool = False


class CreateSessionRequest(BaseModel):
    env_a: str
    env_b: str
    service: str = "ssm"
    keys: list[str] = []
    title: str = ""
    reuse: bool = False


class UpdateSessionItemRequest(BaseModel):
    name: str
    status: str | None = None
    service: str | None = None
    is_secret: bool | None = None
    diff_json: str | None = None
    diff_err: str | None = None
    script: str | None = None
    preview: str | None = None
    notes: str | None = None