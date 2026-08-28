const STATUS_LABELS = {
  equal: "Sin cambios",
  different: "Hay cambios",
  missing_in_a: "Falta en A",
  missing_in_b: "Falta en B (nada que aplicar)",
  none: "No existe en ninguna región",
};

async function loadEnvs(selectA, selectB) {
  const res = await fetch("/api/envs");
  const data = await res.json();
  const opts = data.environments.map(
    (e) => `<option value="${e.env}">${e.env} — ${e.region} (${e.profile})</option>`,
  );
  [selectA, selectB].forEach((sel) => {
    sel.innerHTML = opts.join("");
    if (opts.length >= 2) {
      sel.value = data.environments[sel === selectA ? 0 : 1].env;
    }
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
    .replaceAll(">", "&gt;");
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