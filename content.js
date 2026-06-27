(() => {
  "use strict";

  const TRIGGERS_KEY = "snippets";
  const CACHE_TTL_MS = 2000;
  const EDITABLE_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email"]);

  let cachedSnippets = {};
  let cachedTriggers = [];
  let lastCacheTime = 0;
  let refreshPromise = null;

  function logWarn(...args) {
    console.warn("[Text Expander]", ...args);
  }

  function isExtensionContextValid() {
    return Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local);
  }

  async function safeStorageGet(key) {
    if (!isExtensionContextValid()) return {};
    try {
      return await chrome.storage.local.get(key);
    } catch (error) {
      logWarn("Storage read failed:", error?.message || error);
      return {};
    }
  }

  function rebuildTriggerCache(snippets) {
    cachedSnippets = snippets && typeof snippets === "object" && !Array.isArray(snippets) ? snippets : {};
    cachedTriggers = Object.keys(cachedSnippets)
      .filter((trigger) => trigger && typeof cachedSnippets[trigger] === "string")
      .sort((a, b) => b.length - a.length);
    lastCacheTime = Date.now();
  }

  async function refreshCacheIfNeeded(force = false) {
    const now = Date.now();
    if (!force && now - lastCacheTime < CACHE_TTL_MS) return;
    if (refreshPromise) return refreshPromise;

    refreshPromise = safeStorageGet(TRIGGERS_KEY)
      .then((data) => rebuildTriggerCache(data[TRIGGERS_KEY] || {}))
      .finally(() => {
        refreshPromise = null;
      });

    return refreshPromise;
  }

  function getActiveEditable() {
    const active = document.activeElement;
    if (!active) return null;

    const tag = active.tagName?.toLowerCase();
    if (tag === "textarea") return active;

    if (tag === "input") {
      const type = (active.getAttribute("type") || "text").toLowerCase();
      if (EDITABLE_INPUT_TYPES.has(type)) return active;
      return null;
    }

    if (active.isContentEditable) return active;
    return null;
  }

  function isUsableEditable(el) {
    if (!el) return false;
    if (el.matches?.("[readonly], [disabled], [aria-disabled='true']")) return false;
    return true;
  }

  function setNativeInputValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function dispatchReplacementEvents(el) {
    try {
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        inputType: "insertReplacementText"
      }));
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findMatchedTrigger(beforeCaret, suffix = "") {
    const textBeforeTriggerCheck = suffix && beforeCaret.endsWith(suffix)
      ? beforeCaret.slice(0, -suffix.length)
      : beforeCaret;

    for (const trigger of cachedTriggers) {
      if (textBeforeTriggerCheck.endsWith(trigger)) {
        return { trigger, snippet: cachedSnippets[trigger], textBeforeTriggerCheck };
      }
    }

    return null;
  }

  function replaceInInput(el, suffix = "") {
    try {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start === null || end === null || start !== end) return false;

      const value = el.value || "";
      const beforeCaret = value.slice(0, start);
      const match = findMatchedTrigger(beforeCaret, suffix);
      if (!match || typeof match.snippet !== "string") return false;

      const { trigger, snippet, textBeforeTriggerCheck } = match;
      const suffixToKeep = beforeCaret.slice(textBeforeTriggerCheck.length);
      const afterCaret = value.slice(end);
      const beforeTrigger = textBeforeTriggerCheck.slice(0, textBeforeTriggerCheck.length - trigger.length);
      const newBefore = beforeTrigger + snippet + suffixToKeep;

      setNativeInputValue(el, newBefore + afterCaret);

      const newCaret = newBefore.length;
      el.setSelectionRange(newCaret, newCaret);
      dispatchReplacementEvents(el);
      return true;
    } catch (error) {
      logWarn("Input replacement failed:", error?.message || error);
      return false;
    }
  }

  function getContentEditableRoot(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return el?.closest?.("[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']") || null;
  }

  function textBeforeCaret(root, range) {
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(root);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    return beforeRange.toString();
  }

  function findTextPosition(root, charOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = charOffset;
    let lastTextNode = null;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      lastTextNode = node;
      const len = node.nodeValue?.length || 0;
      if (remaining <= len) return { node, offset: remaining };
      remaining -= len;
    }

    return lastTextNode ? { node: lastTextNode, offset: lastTextNode.nodeValue.length } : null;
  }

  function replaceInContentEditable(active, suffix = "") {
    try {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;

      const caretRange = selection.getRangeAt(0);
      if (!caretRange.collapsed) return false;

      const root = getContentEditableRoot(active) || active;
      if (!root.contains(caretRange.startContainer)) return false;

      const beforeCaret = textBeforeCaret(root, caretRange);
      const match = findMatchedTrigger(beforeCaret, suffix);
      if (!match || typeof match.snippet !== "string") return false;

      const { trigger, snippet, textBeforeTriggerCheck } = match;
      const replacementStartOffset = textBeforeTriggerCheck.length - trigger.length;
      const replacementEndOffset = textBeforeTriggerCheck.length;
      const startPosition = findTextPosition(root, replacementStartOffset);
      const endPosition = findTextPosition(root, replacementEndOffset);
      if (!startPosition || !endPosition) return false;

      const replaceRange = document.createRange();
      replaceRange.setStart(startPosition.node, startPosition.offset);
      replaceRange.setEnd(endPosition.node, endPosition.offset);
      replaceRange.deleteContents();

      const snippetNode = document.createTextNode(snippet);
      replaceRange.insertNode(snippetNode);

      // Put caret after the suffix if suffix was already inserted, otherwise after snippet.
      const newRange = document.createRange();
      if (suffix && beforeCaret.endsWith(suffix)) {
        const afterSuffixOffset = replacementStartOffset + snippet.length + suffix.length;
        const afterSuffixPosition = findTextPosition(root, afterSuffixOffset);
        if (afterSuffixPosition) newRange.setStart(afterSuffixPosition.node, afterSuffixPosition.offset);
        else newRange.setStart(snippetNode, snippetNode.nodeValue.length);
      } else {
        newRange.setStart(snippetNode, snippetNode.nodeValue.length);
      }
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      dispatchReplacementEvents(root);
      return true;
    } catch (error) {
      logWarn("Contenteditable replacement failed:", error?.message || error);
      return false;
    }
  }

  function tryExpandAtCaretSync(suffix = "") {
    if (!cachedTriggers.length) return false;

    const active = getActiveEditable();
    if (!isUsableEditable(active)) return false;

    const tag = active.tagName?.toLowerCase();
    const isPlainInput = tag === "input" || tag === "textarea";
    return isPlainInput ? replaceInInput(active, suffix) : replaceInContentEditable(active, suffix);
  }

  document.addEventListener("keyup", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

    let suffix = "";
    if (event.key === " ") suffix = " ";
    else if (event.key === "Enter") suffix = "\n";
    else return;

    const replaced = tryExpandAtCaretSync(suffix);

    // If the page was used immediately after loading and the storage cache was
    // not ready yet, refresh now and try once more. This fixes the common
    // "typed trigger + Space too quickly" race condition.
    if (!replaced) {
      refreshCacheIfNeeded(true)
        .then(() => tryExpandAtCaretSync(suffix))
        .catch((error) => logWarn("Cache refresh failed:", error?.message || error));
    } else {
      refreshCacheIfNeeded().catch((error) => logWarn("Cache refresh failed:", error?.message || error));
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

    // Tab often moves focus before keyup fires, so expand synchronously before focus changes.
    const replaced = tryExpandAtCaretSync("");
    if (replaced) {
      event.preventDefault();
      event.stopPropagation();
    }
    refreshCacheIfNeeded().catch((error) => logWarn("Cache refresh failed:", error?.message || error));
  }, true);

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes[TRIGGERS_KEY]) {
      rebuildTriggerCache(changes[TRIGGERS_KEY].newValue || {});
    }
  });

  refreshCacheIfNeeded(true).catch((error) => logWarn("Initial cache failed:", error?.message || error));
})();
