from pathlib import Path

from src.cli import _frontend_needs_build


def _make_frontend(tmp_path: Path) -> Path:
    fe = tmp_path / "frontend"
    (fe / "src").mkdir(parents=True)
    (fe / "package.json").write_text("{}")
    (fe / "src" / "main.ts").write_text("console.log(1)")
    (fe / "dist" / "browser").mkdir(parents=True)
    return fe


def test_frontend_needs_build_when_dist_missing(tmp_path):
    fe = _make_frontend(tmp_path)
    assert (fe / "dist" / "browser" / "index.html").exists() is False
    assert _frontend_needs_build(fe) is True


def test_frontend_needs_build_when_source_newer_than_dist(tmp_path):
    fe = _make_frontend(tmp_path)
    index = fe / "dist" / "browser" / "index.html"
    index.write_text("index")
    src = fe / "src" / "main.ts"
    src.write_text("console.log(2)")

    # index older (mtime anterior) que la fuente recién escrita
    src.write_text("newer")  # refresca el mtime después del index
    assert _frontend_needs_build(fe) is True


def test_frontend_needs_build_false_when_dist_is_fresh(tmp_path):
    fe = _make_frontend(tmp_path)
    index = fe / "dist" / "browser" / "index.html"
    index.write_text("index")
    # tocar el index después de la fuente => dist al día
    index.write_text("index-edited-after")
    assert _frontend_needs_build(fe) is False


def test_frontend_without_package_json_never_builds(tmp_path):
    fe = tmp_path / "frontend"
    fe.mkdir()
    assert _frontend_needs_build(fe) is False