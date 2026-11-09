(() => {
  "use strict";

  const TRIGGERS_KEY = "snippets";
  const EDITABLE_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email"]);

  let cachedSnippets = {};
  let cachedTriggers = [];

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
  }

  function loadCache() {
    return safeStorageGet(TRIGGERS_KEY).then((data) => rebuildTriggerCache(data[TRIGGERS_KEY] || {}));
  }

  // Follows focus into open shadow roots (web components).
  function deepActiveElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function getActiveEditable() {
    const active = deepActiveElement();
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

  // Inserting through execCommand keeps the browser undo stack and fires the
  // native input events that React/Vue/etc. editors listen to.
  function insertText(text) {
    try {
      return document.execCommand("insertText", false, text);
    } catch {
      return false;
    }
  }

  function dispatchReplacementEvents(el) {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setNativeInputValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function replaceInInput(el, after) {
    // <input type="email"> exposes no caret/selection APIs. Switch it to text
    // for the edit, treat the caret as end-of-value, and restore the type.
    // Email values are whitespace-trimmed, so no trailing space is re-added.
    const restoreType = el.type === "email" ? "email" : null;
    try {
      if (restoreType) {
        el.type = "text";
        el.setSelectionRange(el.value.length, el.value.length);
        after = "";
      }
      const end = el.selectionStart;
      if (end === null || end !== el.selectionEnd) return false;

      const value = el.value || "";
      const match = TextExpanderMatch.findMatch(value.slice(0, end), cachedTriggers, cachedSnippets);
      if (!match || typeof match.snippet !== "string") return false;

      const text = match.snippet + after;
      el.setSelectionRange(match.start, end);
      if (!insertText(text)) {
        // Fallback: direct assignment (loses undo history).
        setNativeInputValue(el, value.slice(0, match.start) + text + value.slice(end));
        const caret = match.start + text.length;
        el.setSelectionRange(caret, caret);
        dispatchReplacementEvents(el);
      }
      return true;
    } catch (error) {
      logWarn("Input replacement failed:", error?.message || error);
      return false;
    } finally {
      if (restoreType) el.type = restoreType;
    }
  }

  // Nearest non-inline ancestor of `node` (inside `root`): triggers are matched
  // within one block, so a previous paragraph's last letter is not "glued" to it.
  function blockOf(node, root) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== root && getComputedStyle(el).display.startsWith("inline")) el = el.parentElement;
    return el && root.contains(el) ? el : root;
  }

  // Range from the start of the caret's current line (after the last <br>
  // in its block) to the caret.
  function currentLineRange(root, caret) {
    const block = blockOf(caret.startContainer, root);
    const line = document.createRange();
    line.selectNodeContents(block);
    line.setEnd(caret.startContainer, caret.startOffset);
    for (const br of block.querySelectorAll("br")) {
      if (line.comparePoint(br, 0) === 0) line.setStartAfter(br);
    }
    return line;
  }

  // DOM point for a character offset inside the text of `line`.
  function pointAt(line, offset) {
    const anc = line.commonAncestorContainer;
    const walker = document.createTreeWalker(anc.nodeType === Node.TEXT_NODE ? anc.parentNode : anc, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let last = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!line.intersectsNode(node)) continue;
      const from = node === line.startContainer ? line.startOffset : 0;
      const to = node === line.endContainer ? line.endOffset : node.nodeValue.length;
      last = { node, offset: to };
      if (remaining <= to - from) return { node, offset: from + remaining };
      remaining -= to - from;
    }
    return last;
  }

  function replaceInContentEditable(active, after) {
    try {
      // Inside a shadow root the page-level selection is retargeted; use the root's own.
      const tree = active.getRootNode();
      const selection = (tree instanceof ShadowRoot && tree.getSelection?.()) || window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;

      const caret = selection.getRangeAt(0);
      if (!caret.collapsed) return false;

      const root = active.closest?.("[contenteditable]:not([contenteditable='false'])") || active;
      if (!root.contains(caret.startContainer)) return false;

      const line = currentLineRange(root, caret);
      const text = line.toString();
      const match = TextExpanderMatch.findMatch(text, cachedTriggers, cachedSnippets);
      if (!match || typeof match.snippet !== "string") return false;

      const from = pointAt(line, match.start);
      const to = pointAt(line, text.length);
      if (!from || !to) return false;

      const replaceRange = document.createRange();
      replaceRange.setStart(from.node, from.offset);
      replaceRange.setEnd(to.node, to.offset);
      selection.removeAllRanges();
      selection.addRange(replaceRange);

      const out = match.snippet + after;
      if (!insertText(out)) {
        // Fallback: manual DOM edit (loses undo history).
        replaceRange.deleteContents();
        const node = document.createTextNode(out);
        replaceRange.insertNode(node);
        const end = document.createRange();
        end.setStart(node, node.nodeValue.length);
        end.collapse(true);
        selection.removeAllRanges();
        selection.addRange(end);
        dispatchReplacementEvents(root);
      }
      return true;
    } catch (error) {
      logWarn("Contenteditable replacement failed:", error?.message || error);
      return false;
    }
  }

  // `after` is text re-inserted behind the snippet (a space for Space, nothing
  // for Enter/Tab, which are swallowed when a trigger expands).
  function tryExpandAtCaret(after) {
    if (!cachedTriggers.length) return false;

    const active = getActiveEditable();
    if (!isUsableEditable(active)) return false;

    const tag = active.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea"
      ? replaceInInput(active, after)
      : replaceInContentEditable(active, after);
  }

  // keydown (not keyup) so the expansion happens before the page reacts to the
  // key: Enter does not send a chat message, Tab does not change focus.
  document.addEventListener("keydown", (event) => {
    if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;

    let after;
    if (event.key === " ") after = " ";
    else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) after = "";
    else return;

    if (tryExpandAtCaret(after)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  try {
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName === "local" && changes[TRIGGERS_KEY]) {
        rebuildTriggerCache(changes[TRIGGERS_KEY].newValue || {});
      }
    });
  } catch (error) {
    logWarn("Storage listener failed:", error?.message || error);
  }

  loadCache().catch((error) => logWarn("Initial cache failed:", error?.message || error));
})();
