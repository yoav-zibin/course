/* Reviewed presentation repair for the original Backgammon package. The match
 * keeps its pinned rules, schemas and version; only these exact UI bytes change. */
(function (global) {
  "use strict";
  const GAME_ID = "5f5293c3-2a3a-4eec-b631-9debf59be0ca";
  const RULES_SHA256 = new Set([
    "0206fffd96b1447a457f63431d013c6de5d5337dfc40285157304a95204b3c4e",
    "9c372d98d8556a52c564cf03f061a50025070740e79dab9acf36617d76dcfb76",
  ]);
  const LEGACY_UI_SHA256 = new Set([
    "bb690c066a3f779a8a0a9e13a7bda77c6f48fccb14d859508d4ddb32a986b843",
    "4bee425e8a8b1690212fb1e018370d2a8badbc3c6a825d2f34d8a91d28107c21",
    "40463fb1a19489a19055c9824951edda17ec821b7ea718c8978eab18c05fd314",
  ]);
  const REPAIRED_UI_SHA256 = "34094a02eb9678b6ce612034f4ccd407eb02b577081e8cda9ec9634a8a1a3c24";
  let replacementPromise = null;

  // Match Python's sort_keys=True, ensure_ascii=False, separators=(",", ":").
  // Build JSON directly: JSON.stringify(object) reorders numeric object keys.
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  async function digest(value) {
    const bytes = new global.TextEncoder().encode(value);
    const hash = await global.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function loadReplacement() {
    if (!replacementPromise) {
      replacementPromise = (async () => {
        const response = await global.fetch("/static/backgammon-declarative-ui.json?v=3", {credentials: "omit"});
        if (!response.ok) throw new Error();
        const spec = await response.json();
        if (spec?.format !== "buildplay-ui" || spec.version !== 1 || typeof spec.ui_code !== "string" ||
            await digest(canonical(spec)) !== REPAIRED_UI_SHA256)
          throw new Error();
        return spec;
      })().catch(error => {
        replacementPromise = null;
        throw error;
      });
    }
    return replacementPromise;
  }

  async function forGame(game) {
    const original = game?.declarative_ui;
    if (game?.id !== GAME_ID || !original || !global.crypto?.subtle) return original;
    try {
      if (!RULES_SHA256.has(await digest(game.server_code)) ||
          !LEGACY_UI_SHA256.has(await digest(canonical(original)))) return original;
      const repaired = await loadReplacement();
      // Keep the validated cached copy private, so a host cannot change the
      // presentation used by a later match when retaining its own local state.
      return JSON.parse(JSON.stringify(repaired));
    } catch {
      return original;
    }
  }

  global.DeclarativePresentation = {forGame};
})(typeof window !== "undefined" ? window : globalThis);
