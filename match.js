(() => {
  "use strict";

  const WORD_CHAR = /[\p{L}\p{N}]/u;

  // Longest-first `triggers` must already be sorted. A trigger only matches at
  // the end of `text` and only when the character before it is not a letter or
  // digit, so "hello;addr" does not expand but "hello ;addr" and ";addr" do.
  function findMatch(text, triggers, snippets) {
    for (const trigger of triggers) {
      if (!text.endsWith(trigger)) continue;
      const start = text.length - trigger.length;
      if (start > 0) {
        const prev = [...text.slice(Math.max(0, start - 2), start)].pop();
        if (WORD_CHAR.test(prev)) continue;
      }
      return { trigger, snippet: snippets[trigger], start };
    }
    return null;
  }

  const api = { findMatch };
  globalThis.TextExpanderMatch = api;
  if (typeof module !== "undefined") module.exports = api;
})();
