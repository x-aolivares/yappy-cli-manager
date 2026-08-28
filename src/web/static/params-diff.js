const envA = document.getElementById("env-a");
const envB = document.getElementById("env-b");
const compareBtn = document.getElementById("compare-btn");
const result = document.getElementById("result");

loadEnvs(envA, envB).catch((e) => {
  result.innerHTML = renderError("No se pudieron cargar los ambientes: " + e.message);
});

function render(data) {
  const parts = [];

  parts.push(
    `<div class="panel" style="margin-top:18px;">
       <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
         <span>${statusBadge(data.status)}</span>
         <span class="muted">${escapeHtml(data.name)}</span>
         <span class="muted">${escapeHtml(data.service)}</span>
         <span class="muted">${data.env_a} → ${data.env_b}</span>
       </div>` +
      (data.notes && data.notes.length
        ? data.notes.map((n) => `<div class="note">• ${escapeHtml(n)}</div>`).join("")
        : "") +
      `</div>`,
  );

  if (data.status === "equal" || data.status === "none") {
    result.innerHTML = parts.join("");
    return;
  }

  const showA = data.value_a ?? "—";
  const showB = data.value_b ?? "—";
  parts.push(
    `<div class="columns">
       <div class="panel">
         <div class="section-title"><strong>Región A — ${escapeHtml(data.env_a)}</strong></div>
         ${preBlock(showA, "No existe en la región A")}
       </div>
       <div class="panel">
         <div class="section-title"><strong>Región B — ${escapeHtml(data.env_b)}</strong></div>
         ${preBlock(showB, "No existe en la región B")}
       </div>
     </div>`,
  );

  if (data.changes && data.changes.length) {
    const rows = data.changes
      .map(
        (c) =>
          `<tr>
             <td><code>${escapeHtml(c.path)}</code></td>
             <td><span class="badge ${c.op === "removed" ? "missing_in_b" : "different"}">${escapeHtml(c.op)}</span></td>
             <td>${formatValue(c.old)}</td>
             <td>${formatValue(c.new)}</td>
           </tr>`,
      )
      .join("");
    parts.push(
      `<div class="panel">
         <div class="section-title"><strong>Cambios</strong>${data.is_json ? '<span class="muted">(diferencias JSON por clave)</span>' : ""}</div>
         <table><thead><tr><th>Ruta</th><th>Operación</th><th>Región A</th><th>Región B</th></tr></thead>
         <tbody>${rows}</tbody></table>
       </div>`,
    );
  }

  if (data.status === "different" || data.status === "missing_in_a") {
    const patchSection = data.is_json
      ? `<div class="panel" style="margin-top:14px;">
           <div class="section-title"><strong>Valor a aplicar en ${escapeHtml(data.env_a)}</strong>
           <span class="muted">(solo claves cambiadas)</span></div>
           ${preBlock(data.patch_value, "—")}
         </div>`
      : "";
    const scriptSection = `<div class="panel script-block" style="margin-top:14px;">
        <div class="section-title"><strong>Comando para ${escapeHtml(data.env_a)}</strong></div>
        ${preBlock(data.script || "No hay comando que ejecutar.", "—")}
      </div>`;

    parts.push(
      `<div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:start;">
         ${scriptSection}
         ${patchSection}
       </div>`,
    );
    result.innerHTML = parts.join("");
    if (data.script) {
      copyButton(data.script).then((btn) => {
        const wrap = result.querySelector(".script-block .actions");
        if (wrap) wrap.appendChild(btn);
      });
    }
    return;
  }

  result.innerHTML = parts.join("");
}

function formatValue(v) {
  if (v === null || v === undefined) return '<span class="muted">—</span>';
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return `<pre style="margin:0; padding:6px 8px; font-size:12px;">${escapeHtml(text)}</pre>`;
}

compareBtn.addEventListener("click", async () => {
  const payload = {
    env_a: envA.value,
    env_b: envB.value,
    service: document.getElementById("service").value,
    name: document.getElementById("name").value.trim(),
  };

  if (!payload.env_a || !payload.env_b) {
    result.innerHTML = renderError("Seleccioná las dos regiones.");
    return;
  }

  if (!payload.name) {
    result.innerHTML = renderError("Ingresá el nombre del parámetro o secreto.");
    return;
  }

  compareBtn.disabled = true;
  result.innerHTML = `<div class="panel"><span class="spinner"></span>Consultando ${escapeHtml(
    payload.name,
  )} en ${payload.env_a} y ${payload.env_b}...</div>`;

  try {
    const res = await fetch("/api/params/diff", {
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