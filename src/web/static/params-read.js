const envSel = document.getElementById("env");
const readBtn = document.getElementById("read-btn");
const entriesInput = document.getElementById("entries");
const result = document.getElementById("result");
const sesEnvB = document.getElementById("ses-env-b");
const sesEnvA = document.getElementById("ses-env-a");
const sessionBtn = document.getElementById("session-btn");

loadEnvs(envSel, sesEnvB, sesEnvA).catch((e) => {
  result.innerHTML = renderError("No se pudieron cargar los ambientes: " + e.message);
});

function collectEntries() {
  const raw = entriesInput.value.trim();
  if (raw.startsWith("[")) {
    let entries;
    try {
      entries = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        "El JSON no es válido: " +
          e.message +
          ' — formato esperado: [{ "key": "/path", "is_secret": false }] o una clave por línea',
      );
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(
        'El JSON debe ser una lista, por ejemplo: [{ "key": "/yappy/dev/rate", "is_secret": false }]',
      );
    }
    return entries;
  }
  const entries = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((key) => ({ key, is_secret: false }));
  if (entries.length === 0) {
    throw new Error(
      'Pegá una clave por línea, por ejemplo: /prod/ecommerce/db/master_url — o un JSON como [{ "key": "/path", "is_secret": false }]',
    );
  }
  return entries;
}

function formatValue(v) {
  if (v === null || v === undefined || v === "") return "";
  try {
    return JSON.stringify(JSON.parse(v), null, 2);
  } catch {
    return v;
  }
}

function render(data) {
  const total = data.results.length;
  const ok = data.ok_count;

  const banner =
    ok === total
      ? `<div class="ok-box"><strong>Listo.</strong> ${total} valor${
          total === 1 ? "" : "es"
        } leído${total === 1 ? "" : "s"} en ${escapeHtml(data.env)}.</div>`
      : `<div class="error-box"><strong>${data.err_count} entrada${
          data.err_count === 1 ? "" : "s"
        } con error</strong> de ${total} en ${escapeHtml(data.env)}.</div>`;

  const rows = data.results
    .map((r) => {
      const state = r.ok
        ? '<span class="badge ok">OK</span>'
        : '<span class="badge error">Error</span>';
      const service = r.is_secret
        ? '<span class="badge secret">Secreto</span>'
        : '<span class="muted">SSM</span>';
      const value = r.ok ? formatValue(r.value) : r.error || "—";
      return `<tr>
        <td><code>${escapeHtml(r.key)}</code></td>
        <td>${service}</td>
        <td>${state}</td>
        <td>${preBlock(value, "—")}</td>
      </tr>`;
    })
    .join("");

  result.innerHTML =
    banner +
    `<div class="panel">
       <div class="section-title"><strong>Valores en ${escapeHtml(data.env)}</strong></div>
       <table>
         <thead><tr><th>Nombre</th><th>Servicio</th><th>Estado</th><th>Valor</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>
     </div>`;
}

readBtn.addEventListener("click", async () => {
  const env = envSel.value;
  if (!env) {
    result.innerHTML = renderError("Seleccioná el ambiente.");
    return;
  }

  let entries;
  try {
    entries = collectEntries();
  } catch (e) {
    result.innerHTML = renderError(e.message);
    return;
  }

  readBtn.disabled = true;
  result.innerHTML = `<div class="panel"><span class="spinner"></span>Leyendo ${entries.length} entrada${entries.length === 1 ? "" : "s"} en ${escapeHtml(env)}...</div>`;

  try {
    const res = await fetch(
      "/api/params/read?env=" + encodeURIComponent(env),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entries),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      result.innerHTML = renderError(data.detail || "Error desconocido");
      return;
    }
    render(data);
  } catch (e) {
    result.innerHTML = renderError("Error de conexión con el backend: " + e.message);
  } finally {
    readBtn.disabled = false;
  }
});

sessionBtn.addEventListener("click", async () => {
  const envB = sesEnvB.value;
  const envA = sesEnvA.value;
  if (!envB || !envA) {
    result.innerHTML = renderError("Seleccioná la región de origen y la de destino.");
    return;
  }
  if (envA === envB) {
    result.innerHTML = renderError("La región de origen y la de destino deben ser distintas.");
    return;
  }

  let entries;
  try {
    entries = collectEntries();
  } catch (e) {
    result.innerHTML = renderError(e.message);
    return;
  }
  const keys = entries.map((e) => (typeof e === "string" ? e : e.key || e.name || ""));

  sessionBtn.disabled = true;
  result.innerHTML = `<div class="panel"><span class="spinner"></span>Creando sesión con ${keys.length} parámetros (${escapeHtml(
    envB,
  )} → ${escapeHtml(envA)})...</div>`;

  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        env_a: envA,
        env_b: envB,
        service: document.getElementById("ses-service").value,
        keys,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      result.innerHTML = renderError(body.detail || "Error desconocido");
      return;
    }
    location.href = "/sessions/" + encodeURIComponent(body.id);
  } catch (e) {
    result.innerHTML = renderError("Error de conexión con el backend: " + e.message);
  } finally {
    sessionBtn.disabled = false;
  }
});