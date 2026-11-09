# Translating games' texts

The platform's own screens are translated from catalogs we write (`docs/i18n.md`). The text
*inside a game* is written by the game's builder (usually the AI), so it is not a fixed list of
sentences we can translate ahead of time. This is how it is translated anyway, in the language of
each player, on demand, and remembered.

```
AI writes the game  ->  the game lists every text it shows in one JSON block (in English)
player opens the portal -> it asks  GET /i18n/bundle/es  (one request: the catalog, the game names
                        and every published game's strings; GET /games/{id}/versions/{v}/strings?lang=es
                        is the fallback for one version)
server              ->  reads the block, translates the texts it has never translated (Google
                        Translate), remembers each one, returns them
portal              ->  puts them in the game's state_changed message (strings, locale, direction)
game                ->  shows t("wins", {name}) in Spanish; players in one match can each use their own language
```

The key idea is that the AI **declares the game's whole vocabulary** when it writes the game: the
list is finite and known, so it can be translated one batch at a time and checked. A new version
of the game only pays for the texts that changed, and a text that two games share (or that was
already translated for another player) is translated once.

## For game authors and their agents

A translatable game has, in its client HTML, a block with every text it shows, in English, with
`{placeholders}` for the parts that change, and the helper from `game_i18n_helper.js`:

```html
<script type="application/json" id="i18n-strings">
{"your_turn": "Your turn", "wins": "{name} wins!", "moves": "Moves: {count}"}
</script>
<script>
/* the contents of game_i18n_helper.js: t(key, params) and applyLocale(message) */
window.addEventListener("message", (event) => {
  const m = event.data;
  if (!m || m.type !== "state_changed") return;
  applyLocale(m);                       // first, before drawing anything
  status.textContent = m.status === "over" ? t("wins", {name: winnerName}) : t("your_turn");
});
</script>
```

Rules (game authors are told the same ones, `game_text.PROMPT_RULES`):

- **Every text the player reads is in the block**: buttons, labels, hints, errors, results,
  `aria-label`s, placeholders, and text drawn on a canvas. Shown only through `t()`.
- **One string per sentence, with placeholders.** Never build a sentence from pieces
  (`name + " wins"`) and never pick a word inside a sentence with a ternary: word order differs
  between languages. Use two keys and pick between whole texts.
- Keys are letters, digits, `_ . -` (at most 64); a text is plain text (no HTML), at most 1000
  characters; at most 400 texts. No plurals: write `Moves: {count}`.
- **Keep display text out of the match state** and out of `make_move`: store codes (`"X"`, `"draw"`) and
  turn them into text when drawing. Players in one match may use different languages.
- Player names come from `players` and are not translated.
- Layout: no fixed widths for text, let it wrap, use CSS logical properties (`margin-inline-start`,
  `text-align: start`) so a right-to-left language (Arabic) works.

`game_text.lint(code)` finds the common mistakes (no block, a key used but missing or never used,
text written in the code, sentences joined from pieces, markup, text on a canvas); the endpoint below
returns them as `warnings`. A game with no block still has its **name and description** translated.

### Required for new games (`translation.require_strings`)

A new game must carry a text table that passes `game_text.lint`. With `translation.require_strings`
(config, default `true`; `config.example.json`), the server refuses client code that fails the
checker with **HTTP 400** and the checker's problems in plain words (localized like other errors,
code `game_texts_not_translatable`) when a non-admin:

- creates a game (`POST /games`),
- saves a new version whose client code changed (`PATCH /games/{id}`).

Exempt: example data, games with no client code, and edits that
leave the client code unchanged (a game from before the rule can still change its description).
Set `require_strings` to `false` to accept any code again.

Authors meet the checker through the POST /games import: a submission that fails
returns 422 with the problems named, and the author fixes and resubmits. The checker also catches `aria-label`/`placeholder`/
`title`/`alt` attributes written as text, `alert`/`confirm`/`prompt`/`createTextNode` with literal
text, and `fillText`/`strokeText` with anything but `t()`.

## Converting an existing game

Games built before the rules above have no `i18n-strings` block, so only their name and description
are translated. `games/community/` holds 21 of them, converted by hand (the list, with versions and
the number of texts, is `games/community/manifest.json`; how the owner publishes them is
`tools/community_games_publish.md`). The same steps convert any other game:

1. **Save the exact current code.** `GET /games/{id}` (public) returns the latest version's
   `client_code`. Keep it as `games/community/<id>.original.html` and record the version in the manifest:
   a game in the database only changes when a new version is saved, and the owner may have saved one
   since (`tools/community_games_check.py` compares the file with production, read-only).
2. **List every text the player reads**, in English, with `{placeholders}`: status lines, buttons,
   labels, hints, errors, results, `aria-label`s and placeholders, the page `<title>`, and the texts that are
   written in the page's own HTML (the heading, the rules). Keep data as data: pieces, cards, suits,
   emoji used as pictures and numbers are not texts. Player names are not translated.
3. **Add the block and the helper**, call `applyLocale(message)` first in the `state_changed` handler,
   and show every text through `t()`. Texts in the page's HTML cannot be changed by the helper, so
   write a small `applyStaticTexts()` that sets them with `t()` and call it right after `applyLocale`;
   the HTML keeps the English text, so the page reads the same until a translation arrives.
4. **One key per sentence.** A sentence built from pieces (`name + " wins"`), a plural made with a
   ternary (`"star" + (n === 1 ? "" : "s")`) or a word chosen inside a sentence becomes whole sentences
   and a choice between them: `n === 1 ? t("one_star_left") : t("stars_left", {count: n})`. A text that
   continues an existing sentence (a status followed by "(spectating)") becomes a template with the sentence
   as a placeholder: `"{status} (spectating)"`. `game_text.lint` reads `t("key"` literally, so
   choose between two `t("…")` calls, never `t(cond ? "a" : "b")`, and keep data codes such as
   `"placement"` or `"computer"` out of the expression that sets a text (compute a variable first).
5. **Markup inside a sentence** (a bold word, a line break) cannot be in a string. Split the sentence
   at a placeholder (`"Form {pattern} in a line"`), fill the placeholder with a marker character, and
   build the text and the `<b>` around it with `createElement`, so a translation can put the bold part
   anywhere (see the SOS rules and the War counters).
6. **Do not change how the game plays**: rules, layout, message formats, `make_move`. Prefer logical CSS
   properties (`margin-inline-start`) for anything you touch. Texts the game's server writes into the
   match state (a `log` string, say) stay as the server writes them: list them as `server_` templates and show
   them with `tx(...)` ("Texts the server writes" below).
7. **A local variable named `t`** (or a constant called `strings`) collides with the helper: rename it.
8. **Check it.** `game_text.lint(code)` must return `[]` (`tests/test_community_games.py` does this for
   every converted game). `tests/web/community-games.test.cjs` loads the original and the converted
   page in a fake page (`tests/web/fake-page.cjs`), sends the same `state_changed` messages
   (`tests/web/community-scenarios.cjs`) and checks that (a) in English both pages have the same
   text, attributes and classes, and send the same moves, (b) with a translation that marks every
   text, nothing the player reads is left untranslated, apart from player names and data, and (c) every
   key of the block is shown by some message. A game whose English output cannot be kept identical, or
   whose texts the server decides, is left out and listed with the reason.

## The API (additive: nothing existing changes)

| Endpoint | Description |
|---|---|
| `GET /games/{id}/versions/{v}/strings` | The version's name, description and string table in the viewer's language (`?lang=`, else the user's saved language, else `Accept-Language`). Same visibility as `GET /games/{id}/versions/{v}` |
| `GET /i18n/games/{locale}` | The names and descriptions of every published game, for a portal's game cards |
| `GET /i18n/bundle/{locale}` | **Everything in one response**: the interface catalog, and for every published game its name, description and translated string table (see "The bundle" below) |

```json
{"game_id": "…", "game_version": 3, "locale": "es", "direction": "ltr",
 "status": "translated", "name": "Tres en raya", "description": "…", "translatable": true,
 "strings": {"your_turn": "Tu turno", "wins": "¡{name} gana!"}, "warnings": []}
```

`status`: `source` (English, or a language with no translation: nothing to do), `translated`,
`partial` (some texts could not be translated and are as the builder wrote them), `unavailable`
(no translator is set up, or it is failing). The request never fails because of the translator: what
cannot be translated comes back as written.

**The game's message** (web portal: `static/portal.js` and `I18n.gameText`; every frontend that hosts
games does the same) gains three optional fields, which a game that does not know them ignores:

```json
{"type": "state_changed", "...": "...", "locale": "es", "direction": "ltr",
 "strings": {"your_turn": "Tu turno", "wins": "¡{name} gana!"}}
```

`strings` is only sent when the game has a table and the language is not English. Fetch the strings
once per game version and language, send them with every message, and send a new message when the
player changes language. **iOS, Android and React Native portals must do this to translate games;
until they do, games there show their English.**

## The bundle: one request, one read

A portal used to ask for the catalog, for the game names, and for each game version's strings
separately, and the server answered each with a Firestore read per text. Now both sides work in bundles.

**On the server**, the machine translations of a language are one Firestore document (more only if the
language outgrows ~600 KB, see below), loaded into memory once:

```
<namespace>_translation_bundles/es-000 = {
  "locale": "es", "chunk": 0,
  "entries": {"<sha256 of the source text>": {"t": "Tu turno", "s": "Your turn", "p": "google",
                                              "c": "2026-10-30T12:00:00+00:00", "r": false}, ...}}
```

- The server reads **all** the bundle documents with one query on first use and again after 60 seconds
  (so a second server process catches up), serving the old copy while it does and if it fails. Lookups
  never touch Firestore: a request that needs translations makes **zero reads**.
- A new, corrected (`PUT /admin/translations`) or deleted translation is written with one merge-set that
  touches **only that entry** (no transaction, no read-modify-write), and then
  applied to the memory in place, so concurrent requests and servers cannot overwrite each other's entries.
- A language that would near Firestore's 1 MiB document limit spills into `es-001`, `es-002`, ...; a
  correction stays in the chunk it was in. All chunks of all languages still load in the one query.
- `FirestoreStore` (the whole-database-in-memory mode) and the data-file stores keep the same behaviour:
  they already serve translations from memory; `FirestoreStore` saves them in the same bundle layout.
- `GET /admin/translations` (and `/v2/admin/translations`) answer from the memory too, without the old
  limit of 100 rows.

**Migration (run once, on the VM).** Until it is run the server keeps working: when no bundle exists it
reads the old rows (`<namespace>_translations`, one document per language and text) once at startup and
serves them. To fold them into bundles:

```bash
cd /path/to/game_platform/..          # the directory that contains game_platform/
python3 -m game_platform.tools.migrate_translation_bundles --project PROJECT --database DATABASE --namespace NAMESPACE --dry-run
python3 -m game_platform.tools.migrate_translation_bundles --project PROJECT --database DATABASE --namespace NAMESPACE
```

(`project_id`, `database` and `namespace` are the `firestore` section of `config.json`.) It prints the
counts, adds only entries no bundle has (so it is idempotent and never overwrites a correction made
meanwhile), checks the bundles from the database, and then marks `<namespace>_meta/translations` as
migrated, after which the server no longer reads the old rows. The old documents are left alone;
delete the `<namespace>_translations` collection when you are happy. A server running `FirestoreStore`
needs no command: its first save after the upgrade rewrites the rows as bundles and deletes the old ones.

**To the browser**, `GET /i18n/bundle/{locale}` answers in one response:

```json
{"locale": "es", "direction": "ltr", "status": "translated",
 "catalog": {"locale": "es", "direction": "ltr", "version": "9f2c4e1ab07d", "messages": {"ui.action.save": "Guardar"}},
 "games": {"<game id>": {"version": 3, "name": "Tres en raya", "description": "…", "status": "translated",
                         "translatable": true, "strings": {"your_turn": "Tu turno"}}}}
```

- It has the **published games' latest versions**. A viewer who may see other versions (their own
  unpublished game, an older version of a running match) asks `GET /games/{id}/versions/{v}/strings`, which
  is unchanged. The bundle is therefore the same for everybody and cacheable.
- It has a strong `ETag` (a hash of the answer) and `Cache-Control: no-cache`: send the ETag in
  `If-None-Match` and an unchanged bundle answers `304` with no body. The ETag changes when a
  translation is added, corrected or deleted, when a game is published or changed, or when the catalog changes.
- Texts without a translation yet are asked from the translator **in the background**, under the same
  daily budget; the request waits for it for at most 3 seconds and then answers with what it has: the
  original text for the rest, with `status` (`translated`, `partial`, `unavailable`, or `source` for
  English) for the whole bundle and for each game. The next request has what finished meanwhile.
- `static/i18n.js` loads it once per language, keeps it in `localStorage` with its ETag (without the
  string tables if it exceeds 200,000 characters, and in place of the older separate copies, since the
  browser's storage is small), revalidates it on each visit, and falls back to the old requests if the
  bundle cannot be had. A game whose texts the bundle lacks or has only partly translated is asked for
  with the per-version endpoint as before.

The game connection protocol (`state_changed` with `strings`, `locale`, `direction`) is unchanged.

## Turn it on

Translation is off until configured (`"translation": {"provider": "off"}`).

1. In the Google Cloud project: **enable the Cloud Translation API**, then Credentials, **create an API
   key and restrict it to the Cloud Translation API** (and, if you can, to the VM's address).
2. On the VM, give the server the key as an environment variable, not in the config file:

   ```bash
   sudo systemctl edit game-platform      # add:  [Service]  Environment=GAME_PLATFORM_TRANSLATE_API_KEY=THE_KEY
   ```

3. In `config.json`: `"translation": {"provider": "google", "daily_character_limit": 200000}`, then
   `sudo systemctl restart game-platform`.

Instead of a key, the VM's own service account can sign in (leave the key empty): it needs the Cloud
Translation API User role **and** the VM's access scopes must include `cloud-platform` (set when the VM is
created; changing it needs the VM stopped). The key is the easier route.

**Cost.** Google charges per character translated. The server sends only texts it has never translated
into that language, and never more than `daily_character_limit` characters per (UTC) day (default
200,000; the day's count restarts with the server); beyond that, new texts stay in English until
tomorrow and a `translation_budget_exceeded` alert is raised. Check Google's current price per million
characters and its monthly free allowance before raising the limit. For trying it without a key,
`"provider": "fake"` prefixes each text with its language (`[es] Your turn`); never use it on a real server.

## Checking and correcting translations

Machine translations are remembered in the data (the translation bundles above) with their source text.
An administrator (master password) can review and fix them:

```bash
curl -u :MASTER 'https://HOST/admin/translations?locale=es'
curl -u :MASTER -X PUT https://HOST/admin/translations -H 'Content-Type: application/json' \
     -d '{"locale": "es", "source": "{name} wins!", "text": "¡{name} gana!"}'     # reviewed, never replaced
curl -u :MASTER -X DELETE https://HOST/admin/translations/es/SOURCE_HASH         # translate it again
```

A translation must keep the same `{placeholders}` as the text; the server refuses one that loses them (a
machine translation that does is discarded and the original is shown; `translation_rejected` is logged).

## What can go wrong

- **Google is down, or the key is refused:** games show their own texts; one `translation_failed` alert
  is raised, and the server leaves Google alone for a minute so players are not made to wait for it.
- **The AI forgets the block:** the game still works (and its name and description are translated); the
  `warnings` say why. Games written before this have no block.
- **A translation reads badly:** correct it as above. It is the same text for every game that uses it.

## Texts the server writes

What a game's **server code** writes for the player is not in the page's own texts: the reason of
`throw new InvalidMove('...')` (the platform returns it as the HTTP 400 `detail` of a rejected move and
the portal shows it) and the display strings a game puts in the match state (a `log` line, a hand name, a
label). They are translated through the same table, as **templates**.

### Templates

A game lists each of them in its `i18n-strings` block under a key that starts with `server_`, with
`{placeholders}` for the parts that vary:

```json
{"server_not_your_turn": "not your turn", "server_need_cards": "need {count} more cards",
 "server_calls": "{p1} calls {p2}."}
```

A server text is matched against the templates of its game (`game_messages.py`; the same rule is `tx` in the
helper): **exact match**, each `{name}` standing for any text (`"need 3 more cards"` fits
`"need {count} more cards"`), and the **most specific** template wins (the most fixed characters, then the
fewest placeholders, then the key). A text that matches nothing is shown as written. The matching template
is translated like any other text of the table (once, then remembered), and the captured values are put back
**untranslated** (names, numbers). `server_` keys are not used by `t()`, so "the code never shows this key"
does not apply to them.

### What the platform answers

When a game's server rejects a move (and for the `InvalidMove` of a refused leave), the 400 response's
`detail` is the message translated for the viewer (`request.state.locale`, as other errors) through the table
of **that game version**:

```json
{"detail": "faltan 3 cartas", "code": "game_message", "message_key": "server_need_cards", "params": {"count": "3"}}
```

- `code` is `game_message` for every text a game's server wrote (it was `unknown` before); `message_key` and
  `params` are there when a template matched. All three are additive.
- English, a text with no matching template, a platform with no translator, a failing or over-budget
  translator: `detail` is the text as the game wrote it. Translation never fails a request.
- The templates are compiled once per game version and kept in memory (`GamePlatform._server_templates`,
  as the `_bundle_*` caches), from the code the move handler already holds: no extra store read. The
  translation memory is the one the other game texts use (a template is translated once, whatever the values).
- A computer's rejected move and the emulator endpoints are not affected: they are game bugs and developer
  tools, shown as written.

### The page

`tx(text)` (in `game_i18n_helper.js`) finds the template of a server-written text in the page's own table and
returns `t(key, captured values)`; any other text is returned unchanged. A page wraps every server text it
displays: `log.textContent = tx(state.log)`, `reason: tx(s.reason)`. When one displayed string joins several
server texts (blackjack's results, `"Win 20v18 +50 | Lose 17v19 (-25)"`), split it first and translate each
piece. `tools/update_game_helper.py` re-pastes the current helper into every page that carries an older copy
(`--check` only reports); `game_text.HELPER_JS`, the copy the agent is told to write, reads the same file.

### Filling the tables

`python tools/extract_server_texts.py` reads each `*.server.js`: the argument of `new InvalidMove(...)`
(string literals, template literals whose `${expr}` become `{p1}`, `{p2}`..., concatenations, and
conditionals between texts, which give one template per branch), and the display strings written into the
state (arguments of `log(...)`/`_log(...)`/`log.push(...)`/`msgs.push(...)`, assignments to `.log`, `.msg`,
`.message`, `.text`, `.reason` and variables called `msg`/`reason`, the properties `msg`, `text`, `label`,
`description`, `desc`, `banner`, `title`, `message`, `note`, `summary`, `reason`; a property whose value is
a single lowercase word is a code, such as `msg: 'refill'`, and is skipped). It adds them to the page's table
as `server_<words>` keys (a second run adds nothing, nothing else in the page changes) and writes a review
list (`--report`): templates whose placeholders touch each other or that have almost no fixed words, the
state texts to wrap with `tx(...)`, and what it could **not** read (a message taken from a variable). What it
cannot read is added by hand to `tools/server_texts_extra.json` after reading the server code. `--fetch-community
URL` saves the server code of the community games from the public record (read-only `GET /games/{id}`) next
to their pages as `<id>.original.server.js`, only when the record's version is the one the page was converted
from. Without `--write` it is a dry run.

Limits: the reader sees only what is written as text. A message from a variable (`new InvalidMove(err)`), text
assembled in a helper function, hand names built from several tables (poker's `showdown, won with {p1}` takes the
hand's own name as a value, which stays English) and a log line built from several statements cannot be
matched whole.

### New games

`game_text.lint(code, server_code=None)` also reads the server code: every `InvalidMove` text and every
player-visible server text it can read must match a template of the table, or the game is not accepted
(`translation.require_strings` gates all of them: every import passes the server code). `game_text.PROMPT_RULES` tells the agent to write its server texts this way,
with an example. Not affected: admin saves, the migration and audit-batch publications, example data, games
without a table, and edits that leave the client code unchanged, so a game from before the rule with
unmatched texts is still accepted.

## Which built-in games are translatable

A game is translatable when its client page has the `i18n-strings` block and uses the helper (checked by
`game_text.lint`, `tests/test_builtin_games_translatable.py`, and for what a player sees in another language,
`tests/web/translated-games.test.cjs`: it feeds every page `state_changed` messages whose texts are
`«key»` and fails if any English is left on the screen).

| Games | Folder |
|---|---|
| Tic-tac-toe, Poker | `games/` |
| Battleship, Beat the Landlord, Crazy Eights, Go Fish, Lost Cities, President | `games/audit-batch1/` |
| 3 Minute Chess, 4 Player Chess, Blokus, Guandan, Mini Golf Duels, Quoridor | `games/audit-batch2/` |
| Backgammon (and its copy), Brazilian Truco, ERS, Reversi, 6-Card Golf | `games/audit-batch3/` |
| Blackjack Table, Cheat (BS), Checkers, Hearts, Mancala, Rummy 500 | `games/audit-batch4/` |
| Chess, Guess Who?, Spades | `games/audit-batch5/` |
| Crazy Eights, Dots & Boxes, Reversi (the playroom pages) | `games/playroom/` |

Only the debug game (a developer protocol viewer) is not translatable.

Known limits (the same for every game above): a text that the game's **server code** writes into the match
state (a log line, a hand or result description, a reason such as "checkmate", the "last move" line of a
board) is shown as written, in English. It stays English until that server code stores codes instead of
sentences; the client pages were changed, the servers were not. Names of players, of the Guess Who
characters and card/piece codes are data and are not translated.

A game stored in the database only changes when a new version is published. To publish the changed pages
to a running server (the ids are in each folder's `manifest.json`; `tictactoe` and `poker` use their file name):

```bash
python tools/publish_game_code.py --target https://buildplay.fun --dry-run <ids>
python tools/publish_game_code.py --target https://buildplay.fun --password MASTER <ids>
```

## Not done yet

- **The game-test page's emulator** does not send translations: an author tests in the source
  language there. Translations are validated at import and served by the portal.
- **Games made by players before this have no block.** Options: ask the agent to "make this game translatable" as a
  new version, or translate the page's text from outside the game (which cannot work for text built from pieces).
  The built-in games are done (see above).

- **Games that exist today have no block.** Those in `games/community/` are converted and wait for the owner to
  publish them ("Converting an existing game"); for the others, ask the agent to "make this game translatable" as a
  new version, or convert them by hand the same way. Translating the page's text from outside the game cannot
  work for text built from pieces.
- **The Google calls were written against Google's documentation and tested with a fake HTTP layer; they have
  not been run against Google from here.** The first real request is the test: check
  `jsonPayload.event="translation_done"` (or `translation_failed`) in the log.
- Whether the AI follows the rules reliably is untested: it needs real generations, checked with `game_text.lint`.
