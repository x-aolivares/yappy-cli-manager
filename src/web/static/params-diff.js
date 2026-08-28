const envA = document.getElementById("env-a");
const envB = document.getElementById("env-b");
const compareBtn = document.getElementById("compare-btn");
const result = document.getElementById("result");

loadEnvs(envB, envA).catch((e) => {
  result.innerHTML = renderError("No se pudieron cargar los ambientes: " + e.message);
});

/* --- Interactive change selection state --- */

let data = null;
let rows = [];
let isJSON = false;
let scriptText = "";
let applyTimer = null;
let applySeq = 0;

function parseValue(text) {
  const t = String(text).trim();
  if (t === "") return "";
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function getParts(path) {
  return path.replace(/^\$/, "").split(".").filter((s) => s !== "");
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function setAt(obj, parts, value) {
  if (!parts.length) return value;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (cur[seg] == null || typeof cur[seg] !== "object") {
      cur[seg] = nextIsIndex ? [] : {};
    }
    cur = cur[seg];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function deleteAt(obj, parts) {
  if (!parts.length) return {};
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    if (cur == null || cur[seg] == null) return obj;
    cur = cur[seg];
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur) && /^\d+$/.test(last)) {
    cur.splice(Number(last), 1);
  } else {
    delete cur[last];
  }
  return obj;
}

function mergedValue() {
  const selected = rows.filter((r) => r.include);
  if (!isJSON) {
    const whole = selected.find((r) => r.path === "$");
    return whole ? parseValue(whole.text) : "";
  }
  const base = clone(parseValue(data.value_a ?? ""));
  const dels = selected
    .filter((r) => r.op === "del")
    .map((r) => getParts(r.path))
    .sort((a, b) => {
      const la = a[a.length - 1] || "";
      const lb = b[b.length - 1] || "";
      const na = /^\d+$/.test(la);
      const nb = /^\d+$/.test(lb);
      if (na && nb) return Number(lb) - Number(la);
      return 0;
    });
  for (const parts of dels) deleteAt(base, parts);
  for (const r of selected) {
    if (r.op !== "del") setAt(base, getParts(r.path), parseValue(r.text));
  }
  return base;
}

function serializeMerged() {
  const v = mergedValue();
  return isJSON ? JSON.stringify(v, null, 2) : String(v);
}

function state() {
  return {
    key: data.source_marker || "",
    _i: Math.random(),
  };
}

function refreshScript() {
  const seq = ++applySeq;
  const newValue = serializeMerged();
  const pre = document.getElementById("script-pre");
  fetch("/api/params/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      env_a: data.env_a,
      env_b: data.env_b,
      service: data.service,
      name: data.name,
      new_value: newValue,
      value_type: data.value_type_b || "String",
    }),
  })
    .then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "HTTP " + res.status);
      return body;
    })
    .then((body) => {
      if (seq !== applySeq) return;
      scriptText = body.script;
      if (pre) pre.textContent = scriptText;
    })
    .catch((e) => {
      if (seq !== applySeq) return;
      scriptText = "";
      if (pre) pre.textContent = "No se pudo generar el comando: " + e.message;
    });
}

function onEdit() {
  const preview = document.getElementById("preview-pre");
  if (preview) preview.textContent = serializeMerged();
  clearTimeout(applyTimer);
  applyTimer = setTimeout(refreshScript, 350);
}

function makeCopyBtn() {
  const btn = document.createElement("button");
  btn.className = "secondary";
  btn.textContent = "Copiar comando";
  btn.addEventListener("click", async () => {
    const ok = await copyText(scriptText);
    btn.textContent = ok ? "¡Copiado!" : "Error al copiar";
    setTimeout(() => (btn.textContent = "Copiar comando"), 1500);
  });
  return btn;
}

/* --- Rendering --- */

function render(payload) {
  clearTimeout(applyTimer);
  data = payload;
  const parts = [];

  parts.push(
    `<div class="panel" style="margin-top:18px;">
       <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
         <span>${statusBadge(data.status)}</span>
         <span class="muted">${escapeHtml(data.name)}</span>
         <span class="muted">${escapeHtml(data.service)}</span>
         <span class="muted">${escapeHtml(data.env_b)} → ${escapeHtml(data.env_a)}</span>
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

  const showA = data.value_a ?? "";
  const showB = data.value_b ?? "";
  parts.push(
    `<div class="columns">
       <div class="panel">
         <div class="section-title"><strong>Región de Origen — ${escapeHtml(data.env_b)}</strong></div>
         ${preBlock(showB, "No existe en la región de origen")}
       </div>
       <div class="panel">
         <div class="section-title"><strong>Región Destino — ${escapeHtml(data.env_a)}</strong></div>
         ${preBlock(showA, "No existe en la región destino")}
       </div>
     </div>`,
  );

  const hasChanges = Array.isArray(data.changes) && data.changes.length > 0;

  if (hasChanges && data.is_json) {
    isJSON = true;
    rows = data.changes.map((c) => ({
      path: c.path,
      op: c.op,
      old: c.old,
      text:
        c.op === "del"
          ? ""
          : c.new != null && typeof c.new === "object"
          ? JSON.stringify(c.new, null, 2)
          : c.new == null
          ? ""
          : String(c.new),
      include: true,
    }));
    parts.push(renderChangesTable());
    result.innerHTML = parts.join("");
    attachChangeHandlers();
    onEdit();
    const wrap = document.getElementById("script-actions");
    if (wrap) wrap.appendChild(makeCopyBtn());
    return;
  }

  if (hasChanges && !data.is_json) {
    isJSON = false;
    rows = [
      { path: "$", op: "set", old: data.value_a, text: data.value_b ?? "", include: true },
    ];
    parts.push(renderPlainEdit());
    result.innerHTML = parts.join("");
    attachChangeHandlers();
    onEdit();
    const wrap = document.getElementById("script-actions");
    if (wrap) wrap.appendChild(makeCopyBtn());
    return;
  }

  if (data.script && ["different", "missing_in_a", "missing_in_b"].includes(data.status)) {
    const patchSection = data.is_json
      ? `<div class="panel" style="margin-top:14px;">
           <div class="section-title"><strong>Valor a aplicar en la región destino (${escapeHtml(data.env_a)})</strong>
           <span class="muted">(solo claves cambiadas)</span></div>
           ${preBlock(data.patch_value, "—")}
         </div>`
      : "";
    const scriptSection = `<div class="panel script-block" style="margin-top:14px;">
        <div class="section-title"><strong>${data.status === "missing_in_b" ? "Comando de eliminación" : "Comando de actualización"} para la región destino (${escapeHtml(data.env_a)})</strong></div>
        ${preBlock(data.script || "No hay comando que ejecutar.", "—")}
      </div>`;

    parts.push(
      patchSection
        ? `<div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:start;">
             ${scriptSection}
             ${patchSection}
           </div>`
        : scriptSection,
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

function renderChangesTable() {
  const bodyRows = rows
    .map((r, i) => {
      const opBadge = `<span class="badge ${r.op === "del" ? "missing_in_b" : "different"}">${escapeHtml(r.op)}</span>`;
      const input =
        r.op === "del"
          ? '<span class="muted">Se elimina la clave</span>'
          : `<textarea class="change-input" data-i="${i}" rows="1" spellcheck="false">${escapeHtml(r.text)}</textarea>`;
      return `<tr>
        <td><input type="checkbox" class="change-include" data-i="${i}" ${r.include ? "checked" : ""}></td>
        <td><code>${escapeHtml(r.path)}</code></td>
        <td>${opBadge}</td>
        <td>${formatValue(r.old)}</td>
        <td>${input}</td>
      </tr>`;
    })
    .join("");
  return `<div class="panel">
     <div class="section-title">
       <strong>Cambios</strong>
       <span class="muted">(marcá los que querés llevar a destino y editá los valores a aplicar)</span>
     </div>
     <table>
       <thead><tr><th></th><th>Ruta</th><th>Operación</th><th>Valor actual en destino</th><th>Valor a aplicar</th></tr></thead>
       <tbody>${bodyRows}</tbody>
     </table>
   </div>
   <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:start; margin-top:14px;">
     <div class="panel">
       <div class="section-title"><strong>Valor resultante en destino (${escapeHtml(data.env_a)})</strong></div>
       <pre id="preview-pre" class="script-block"></pre>
     </div>
     <div class="panel script-block">
       <div class="section-title"><strong>Comando de actualización para la región destino (${escapeHtml(data.env_a)})</strong></div>
       <pre id="script-pre" class="script-block">Regenerando…</pre>
       <div class="actions" style="margin-top:10px;"><span id="script-actions"></span></div>
     </div>
   </div>`;
}

function renderPlainEdit() {
  return `<div class="panel">
     <div class="section-title"><strong>Valor a aplicar en la región destino (${escapeHtml(data.env_a)})</strong>
     <span class="muted">(texto plano, no JSON)</span></div>
     <textarea class="change-input" data-i="0" rows="4" spellcheck="false">${escapeHtml(rows[0].text)}</textarea>
   </div>
   <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:start; margin-top:14px;">
     <div class="panel">
       <div class="section-title"><strong>Valor resultante en destino</strong></div>
       <pre id="preview-pre" class="script-block"></pre>
     </div>
     <div class="panel script-block">
       <div class="section-title"><strong>Comando de actualización para la región destino (${escapeHtml(data.env_a)})</strong></div>
       <pre id="script-pre" class="script-block">Regenerando…</pre>
       <div class="actions" style="margin-top:10px;"><span id="script-actions"></span></div>
     </div>
   </div>`;
}

function attachChangeHandlers() {
  document.querySelectorAll(".change-include").forEach((cb) =>
    cb.addEventListener("change", () => {
      rows[+cb.dataset.i].include = cb.checked;
      onEdit();
    }),
  );
  document.querySelectorAll(".change-input").forEach((ta) =>
    ta.addEventListener("input", () => {
      rows[+ta.dataset.i].text = ta.value;
      onEdit();
    }),
  );
}

function formatValue(v) {
  if (v === null || v === undefined) return '<span class="muted">—</span>';
  const text = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return `<pre style="margin:0; padding:6px 8px; font-size:12px;">${escapeHtml(text)}</pre>`;
}

compareBtn.addEventListener("click", async () => {
  const payload = {
    env_a: envA.value,
    env_b: envB.value,
    service: document.getElementById("service").value,
    name: document.getElementById("name").value.trim(),
    include_deletes: document.getElementById("include-deletes").checked,
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
  )} de origen ${payload.env_b} a destino ${payload.env_a}...</div>`;

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