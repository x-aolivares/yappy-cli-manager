const envA = document.getElementById("env-a");
const envB = document.getElementById("env-b");
const compareBtn = document.getElementById("compare-btn");
const result = document.getElementById("result");

loadEnvs(envA, envB).catch((e) => {
  result.innerHTML = renderError("No se pudieron cargar los ambientes: " + e.message);
});

function objectLabel(type) {
  return type === "procedure" ? "stored procedure" : "tabla";
}

function render(data) {
  const parts = [];

  parts.push(
    `<div class="panel" style="margin-top:18px;">
       <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
         <span>${statusBadge(data.status)}</span>
         <span class="muted">${data.object_type} ${escapeHtml(data.schema_name)}.${escapeHtml(data.object_name)}</span>
         <span class="muted">${escapeHtml(data.env_a)} → ${escapeHtml(data.env_b)}</span>
       </div>` +
      (data.notes && data.notes.length
        ? data.notes.map((n) => `<div class="note">• ${escapeHtml(n)}</div>`).join("")
        : "") +
      `</div>`,
  );

  if (data.status === "equal") {
    result.innerHTML = parts.join("");
    return;
  }

  if (data.status === "none") {
    result.innerHTML = parts.join("");
    return;
  }

  if (data.status === "missing_in_b") {
    parts.push(`<div class="panel">
        <div class="section-title"><strong>Región A (${escapeHtml(data.env_a)})</strong></div>
        ${preBlock(data.code_a, `No existe en ${escapeHtml(data.env_b)}`)}
      </div>`);
    result.innerHTML = parts.join("");
    return;
  }

  parts.push(
    `<div class="columns">
       <div class="panel">
         <div class="section-title"><strong>Región A — ${escapeHtml(data.env_a)}</strong></div>
         ${preBlock(data.code_a, "No existe en la región A")}
       </div>
       <div class="panel">
         <div class="section-title"><strong>Región B — ${escapeHtml(data.env_b)}</strong></div>
         ${preBlock(data.code_b, "No existe en la región B")}
       </div>
     </div>`,
  );

  if (data.status === "different" || data.status === "missing_in_a") {
    const scriptHtml = data.script
      ? `<pre class="script-block">${escapeHtml(data.script)}</pre>`
      : `<pre class="empty">No se detectaron cambios de estructura ejecutables.</pre>`;
    parts.push(
      `<div class="panel">
         <div class="section-title">
           <strong>Script de actualización (ejecutar en ${escapeHtml(data.env_a)})</strong>
         </div>
         ${scriptHtml}
         <div class="actions" style="margin-top:10px;"><span id="copy-badge"></span></div>
       </div>`,
    );
    result.innerHTML = parts.join("");
    if (data.script) {
      copyButton(data.script).then((btn) =>
        document.getElementById("copy-badge").appendChild(btn),
      );
    }
    return;
  }

  result.innerHTML = parts.join("");
}

compareBtn.addEventListener("click", async () => {
  const typeInput = document.querySelector('input[name="object-type"]:checked');
  const payload = {
    env_a: envA.value,
    env_b: envB.value,
    schema_name: document.getElementById("schema").value.trim(),
    object_type: typeInput ? typeInput.value : "table",
    object_name: document.getElementById("object-name").value.trim(),
  };

  if (!payload.env_a || !payload.env_b) {
    result.innerHTML = renderError("Seleccioná las dos regiones.");
    return;
  }

  if (!payload.schema_name || !payload.object_name) {
    result.innerHTML = renderError("Completá el schema y el nombre del objeto.");
    return;
  }

  compareBtn.disabled = true;
  result.innerHTML = `<div class="panel"><span class="spinner"></span>Comparando ${objectLabel(
    payload.object_type,
  )} ${escapeHtml(payload.schema_name)}.${escapeHtml(payload.object_name)} entre ${escapeHtml(
    payload.env_a,
  )} y ${escapeHtml(payload.env_b)}...</div>`;

  try {
    const res = await fetch("/api/db/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      result.innerHTML = renderError(data.detail || "Error desconocido");
      return;
    }
    render(data);
  } catch (e) {
    result.innerHTML = renderError("Error de conexión con el backend: " + e.message);
  } finally {
    compareBtn.disabled = false;
  }
});