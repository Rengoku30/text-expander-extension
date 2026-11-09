(() => {
  "use strict";

  const TRIGGERS_KEY = "snippets";
  const MAX_TRIGGER_LENGTH = 80;
  const MAX_SNIPPET_LENGTH = 20000;

  const $ = (id) => document.getElementById(id);
  const els = {
    trigger: $("trigger"),
    text: $("text"),
    search: $("search"),
    saveBtn: $("saveBtn"),
    clearBtn: $("clearBtn"),
    removeBtn: $("removeBtn"),
    exportBtn: $("exportBtn"),
    importBtn: $("importBtn"),
    importFile: $("importFile"),
    status: $("status"),
    list: $("list")
  };

  let snippets = {};
  let editingTrigger = null; // set by Edit; saving under a new name renames

  function setStatus(message, type = "ok") {
    els.status.textContent = message;
    els.status.className = type;
  }

  function getRuntimeError(prefix) {
    const err = chrome.runtime.lastError;
    return err ? new Error(`${prefix}: ${err.message}`) : null;
  }

  async function storageGet(key) {
    try {
      const data = await chrome.storage.local.get(key);
      const err = getRuntimeError("Failed to read storage");
      if (err) throw err;
      return data;
    } catch (error) {
      throw new Error(error?.message || "Failed to read storage.");
    }
  }

  async function storageSet(value) {
    try {
      await chrome.storage.local.set(value);
      const err = getRuntimeError("Failed to write storage");
      if (err) throw err;
    } catch (error) {
      throw new Error(error?.message || "Failed to write storage.");
    }
  }

  function validateTrigger(trigger) {
    if (!trigger) return "Trigger is required.";
    if (trigger === "__proto__") return "Trigger is reserved.";
    if (/\s/.test(trigger)) return "Trigger cannot contain spaces or newlines.";
    if (trigger.length > MAX_TRIGGER_LENGTH) return `Trigger must be ${MAX_TRIGGER_LENGTH} characters or fewer.`;
    return null;
  }

  function validateSnippet(snippet) {
    if (!snippet) return "Snippet is empty. Use Remove to delete a trigger.";
    if (snippet.length > MAX_SNIPPET_LENGTH) return `Snippet must be ${MAX_SNIPPET_LENGTH} characters or fewer.`;
    return null;
  }

  function normalizeImportedSnippets(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) && value.snippets
      ? value.snippets
      : value;

    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("Invalid JSON. Expected an object like {\";addr\": \"123 Main St\"} or {\"snippets\": {...}}.");
    }

    const out = {};
    for (const [rawTrigger, rawSnippet] of Object.entries(source)) {
      const trigger = String(rawTrigger).trim();
      const snippet = String(rawSnippet ?? "");
      if (!snippet) continue; // empty snippets are skipped, not fatal
      const triggerError = validateTrigger(trigger);
      const snippetError = validateSnippet(snippet);
      if (triggerError) throw new Error(`Invalid trigger ${JSON.stringify(rawTrigger)}: ${triggerError}`);
      if (snippetError) throw new Error(`Invalid snippet for ${trigger}: ${snippetError}`);
      out[trigger] = snippet;
    }
    return out;
  }

  async function loadSnippets() {
    const data = await storageGet(TRIGGERS_KEY);
    snippets = data[TRIGGERS_KEY] || {};
    render();
  }

  async function persistSnippets() {
    await storageSet({ [TRIGGERS_KEY]: snippets });
    render();
  }

  function clearForm() {
    els.trigger.value = "";
    els.text.value = "";
    editingTrigger = null;
    els.trigger.focus();
  }

  function render() {
    const query = els.search.value.trim().toLowerCase();
    const entries = Object.entries(snippets)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([trigger, snippet]) => {
        if (!query) return true;
        return trigger.toLowerCase().includes(query) || String(snippet).toLowerCase().includes(query);
      });

    els.list.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = Object.keys(snippets).length === 0 ? "No snippets yet." : "No snippets match your search.";
      els.list.appendChild(empty);
      return;
    }

    for (const [trigger, snippet] of entries) {
      const row = document.createElement("div");
      row.className = "snippet-row";

      const triggerEl = document.createElement("div");
      triggerEl.className = "trigger";
      triggerEl.textContent = trigger;

      const snippetEl = document.createElement("div");
      snippetEl.className = "snippet";
      snippetEl.textContent = snippet;

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "secondary";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => {
        els.trigger.value = trigger;
        els.text.value = snippet;
        editingTrigger = trigger;
        els.text.focus();
      });

      row.append(triggerEl, snippetEl, editBtn);
      els.list.appendChild(row);
    }
  }

  els.saveBtn.addEventListener("click", async () => {
    try {
      const trigger = els.trigger.value.trim();
      const snippet = els.text.value;
      const triggerError = validateTrigger(trigger);
      const snippetError = validateSnippet(snippet);
      if (triggerError) throw new Error(triggerError);
      if (snippetError) throw new Error(snippetError);

      const renaming = editingTrigger !== null && editingTrigger !== trigger;
      const warnings = [];
      if (Object.prototype.hasOwnProperty.call(snippets, trigger) && trigger !== editingTrigger) {
        warnings.push(`"${trigger}" already exists and will be overwritten.`);
      }
      if (/^[\p{L}\p{N}]{1,3}$/u.test(trigger)) {
        warnings.push(`"${trigger}" is a very short plain word: it will expand every time you type it followed by Space, Enter or Tab. Consider a prefix such as ";".`);
      }
      if (warnings.length && !confirm(warnings.join("\n\n") + "\n\nSave anyway?")) {
        setStatus("Not saved.");
        return;
      }

      if (renaming) delete snippets[editingTrigger];
      snippets[trigger] = snippet;
      await persistSnippets();
      setStatus(renaming ? `Renamed ${editingTrigger} to ${trigger}.` : `Saved ${trigger}.`);
      clearForm();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.removeBtn.addEventListener("click", async () => {
    try {
      const trigger = els.trigger.value.trim();
      const triggerError = validateTrigger(trigger);
      if (triggerError) throw new Error(triggerError);
      if (!Object.prototype.hasOwnProperty.call(snippets, trigger)) throw new Error(`No snippet found for ${trigger}.`);

      delete snippets[trigger];
      await persistSnippets();
      setStatus(`Removed ${trigger}.`);
      clearForm();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.clearBtn.addEventListener("click", () => {
    clearForm();
    setStatus("Form cleared.");
  });

  els.search.addEventListener("input", render);

  els.exportBtn.addEventListener("click", () => {
    try {
      const blob = new Blob([JSON.stringify({ snippets }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "text-expander-snippets.json";
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Exported snippets.");
    } catch (error) {
      setStatus(error.message || "Export failed.", "error");
    }
  });

  els.importBtn.addEventListener("click", () => els.importFile.click());

  els.importFile.addEventListener("change", async () => {
    const file = els.importFile.files?.[0];
    els.importFile.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = normalizeImportedSnippets(parsed);
      snippets = { ...snippets, ...imported };
      await persistSnippets();
      setStatus(`Imported ${Object.keys(imported).length} snippet(s).`);
    } catch (error) {
      setStatus(error.message || "Import failed.", "error");
    }
  });

  window.addEventListener("error", (event) => setStatus(event.message || "Unexpected error.", "error"));
  window.addEventListener("unhandledrejection", (event) => setStatus(event.reason?.message || "Unexpected async error.", "error"));

  loadSnippets().catch((error) => setStatus(error.message, "error"));
})();
