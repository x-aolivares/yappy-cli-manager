const STATUS_LABELS = {
  equal: "Sin cambios",
  different: "Hay cambios",
  missing_in_a: "Falta en A",
  missing_in_b: "Falta en B (nada que aplicar)",
  none: "No existe en ninguna región",
};

async function loadEnvs(selectA, selectB) {
  const res = await fetch("/api/envs");
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  const envs = Array.isArray(data.environments) ? data.environments : [];
  if (!envs.length) {
    const cfg = data.config_dir ? ` (config_dir: ${escapeHtml(data.config_dir)})` : "";
    throw new Error("no se encontraron ambientes en config/env.*" + cfg);
  }
  const opts = envs.map((e) => {
    const note = e.load_error
      ? ` (error: ${escapeHtml(e.load_error)})`
      : "";
    return `<option value="${escapeHtml(e.env)}">${escapeHtml(e.env)} — ${escapeHtml(
      e.region || "",
    )} (${escapeHtml(e.profile || "")})${note}</option>`;
  });
  [selectA, selectB].forEach((sel, i) => {
    sel.innerHTML = opts.join("");
    sel.value = envs.length >= 2 ? envs[i].env : envs[0].env;
  });
}

function statusBadge(status) {
  return `<span class="badge ${status}">${STATUS_LABELS[status] || status}</span>`;
}

function preBlock(content, emptyText) {
  if (!content) return `<pre class="empty">${emptyText || "—"}</pre>`;
  return `<pre>${escapeHtml(content)}</pre>`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); return true; } finally { ta.remove(); }
  }
}

async function copyButton(text) {
  const btn = document.createElement("button");
  btn.className = "secondary";
  btn.textContent = "Copiar script";
  btn.addEventListener("click", async () => {
    const ok = await copyText(text);
    btn.textContent = ok ? "¡Copiado!" : "Error al copiar";
    setTimeout(() => (btn.textContent = "Copiar script"), 1500);
  });
  return btn;
}

function renderError(msg) {
  return `<div class="error-box">${escapeHtml(msg)}</div>`;
}