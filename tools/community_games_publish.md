# Publishing the converted community games

> **Completed one-off record.** The publish route this runbook used
> (`PUT /admin/games/{id}/code`, via `tools/publish_game_code.py`) was removed
> with the Builder, and the tool has been deleted. Client-code updates for
> these games now go through their owners (`PATCH /games/{id}`) or a fresh
> POST /games import.

`games/community/` has 21 games that players built with the game builder and that exist only in the production database. Each `<id>.html` is the same game as `<id>.original.html` (the code fetched from production) with an `i18n-strings` block, so the platform can translate its texts. **Nothing here is published until the owner runs the commands below** (they need the master password, which is not in this repository).

Review (optional): `node --test tests/web/community-games.test.cjs` shows that the English page is identical to the original for the same messages, and that a translation reaches every text.

## 1. Check that nobody changed the games since the conversion (read-only)

```bash
python tools/community_games_check.py --target https://buildplay.fun
```

A game that says *differs* was saved by its owner after the conversion: publishing the converted file would overwrite that change, so leave it out and convert the new version (`docs/game-translation.md`, "Converting an existing game").

## 2. See what would change (still read-only)

```bash
python tools/publish_game_code.py --target https://buildplay.fun --dry-run 4d15d9d7-0788-4304-9b30-9b5c2bd7f487 916ab616-6abf-4c92-83c5-43cbdd4c8ab9 a5a16425-bc14-4260-9946-763b11f0739b cbd19f63-bc51-49a9-bb45-858ec9b12828 7bed6e20-99b4-4749-888e-43b0e90ba866 8b87f4a0-3735-442b-bf9c-e1b24aaf2df8 c8039b20-7c3e-4993-bae1-f59dfacd1ccc 39a5e1f5-c20c-40b1-a633-a8457d273eaf b59b79d7-660b-4823-8a81-159e0a6a2809 4f49cbdc-cf96-4657-a50e-3082935e1cdf 571c1cc4-a48d-40be-88fd-df1d5cc21d10 79830aee-0a91-406d-a2f7-c103002203f7 788b39a9-6358-4598-9903-92ce97aa5502 569fac2e-82eb-486b-9446-6afae3984efe a1ca4c85-b8a5-4b63-a9dc-f01c87a0d65f 58bd6827-f156-4cd2-ac31-53953b6df61a 36e5f0d8-4806-439f-af08-b28c593347c1 aac01cd8-9436-456b-9e8b-a5f87b815e07 d00a8d7b-320e-43bc-824f-ff899ff93687 ad578d02-f485-4e11-a1d4-08bcd4f462a9 42d06892-449c-44d2-9251-7b9448ce4ddc
```

## 3. Publish, one game at a time

Replace `MASTER` with the master password. Each command saves the file as the game's next version (the server code and schemas are kept).

| Game | Fetched version | Texts | File | Command |
|---|---|---|---|---|
| 4x5 tictactoe | 3 | 12 | `games/community/4d15d9d7-0788-4304-9b30-9b5c2bd7f487.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 4d15d9d7-0788-4304-9b30-9b5c2bd7f487` |
| Bulls and Cows (Bulgarian) | 2 | 19 | `games/community/916ab616-6abf-4c92-83c5-43cbdd4c8ab9.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 916ab616-6abf-4c92-83c5-43cbdd4c8ab9` |
| Chopsticks | 1 | 41 | `games/community/a5a16425-bc14-4260-9946-763b11f0739b.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER a5a16425-bc14-4260-9946-763b11f0739b` |
| Chutes & Ladders | 4 | 16 | `games/community/cbd19f63-bc51-49a9-bb45-858ec9b12828.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER cbd19f63-bc51-49a9-bb45-858ec9b12828` |
| Connect Four | 2 | 21 | `games/community/7bed6e20-99b4-4749-888e-43b0e90ba866.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 7bed6e20-99b4-4749-888e-43b0e90ba866` |
| Dragonimo | 3 | 11 | `games/community/8b87f4a0-3735-442b-bf9c-e1b24aaf2df8.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 8b87f4a0-3735-442b-bf9c-e1b24aaf2df8` |
| Fox and Geese | 3 | 14 | `games/community/c8039b20-7c3e-4993-bae1-f59dfacd1ccc.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER c8039b20-7c3e-4993-bae1-f59dfacd1ccc` |
| Gomoku | 3 | 23 | `games/community/39a5e1f5-c20c-40b1-a633-a8457d273eaf.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 39a5e1f5-c20c-40b1-a633-a8457d273eaf` |
| Gomoku | 3 | 12 | `games/community/b59b79d7-660b-4823-8a81-159e0a6a2809.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER b59b79d7-660b-4823-8a81-159e0a6a2809` |
| Last Floe | 6 | 14 | `games/community/4f49cbdc-cf96-4657-a50e-3082935e1cdf.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 4f49cbdc-cf96-4657-a50e-3082935e1cdf` |
| Nim | 2 | 17 | `games/community/571c1cc4-a48d-40be-88fd-df1d5cc21d10.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 571c1cc4-a48d-40be-88fd-df1d5cc21d10` |
| Nine Stars | 3 | 18 | `games/community/79830aee-0a91-406d-a2f7-c103002203f7.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 79830aee-0a91-406d-a2f7-c103002203f7` |
| Nine Stars (Demo) | 4 | 12 | `games/community/788b39a9-6358-4598-9903-92ce97aa5502.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 788b39a9-6358-4598-9903-92ce97aa5502` |
| Solo Countdown (deployment check) | 3 | 9 | `games/community/569fac2e-82eb-486b-9446-6afae3984efe.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 569fac2e-82eb-486b-9446-6afae3984efe` |
| SOS | 2 | 16 | `games/community/a1ca4c85-b8a5-4b63-a9dc-f01c87a0d65f.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER a1ca4c85-b8a5-4b63-a9dc-f01c87a0d65f` |
| Spoons | 3 | 22 | `games/community/58bd6827-f156-4cd2-ac31-53953b6df61a.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 58bd6827-f156-4cd2-ac31-53953b6df61a` |
| Stack Duel | 8 | 17 | `games/community/36e5f0d8-4806-439f-af08-b28c593347c1.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 36e5f0d8-4806-439f-af08-b28c593347c1` |
| Star Count | 4 | 8 | `games/community/aac01cd8-9436-456b-9e8b-a5f87b815e07.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER aac01cd8-9436-456b-9e8b-a5f87b815e07` |
| Tap to 10 (TEST GAME) | 1 | 6 | `games/community/d00a8d7b-320e-43bc-824f-ff899ff93687.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER d00a8d7b-320e-43bc-824f-ff899ff93687` |
| Tower of Hanoi | 3 | 16 | `games/community/ad578d02-f485-4e11-a1d4-08bcd4f462a9.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER ad578d02-f485-4e11-a1d4-08bcd4f462a9` |
| War | 3 | 32 | `games/community/42d06892-449c-44d2-9251-7b9448ce4ddc.html` | `python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 42d06892-449c-44d2-9251-7b9448ce4ddc` |

Or all at once:

```bash
python tools/publish_game_code.py --target https://buildplay.fun --password MASTER 4d15d9d7-0788-4304-9b30-9b5c2bd7f487 916ab616-6abf-4c92-83c5-43cbdd4c8ab9 a5a16425-bc14-4260-9946-763b11f0739b cbd19f63-bc51-49a9-bb45-858ec9b12828 7bed6e20-99b4-4749-888e-43b0e90ba866 8b87f4a0-3735-442b-bf9c-e1b24aaf2df8 c8039b20-7c3e-4993-bae1-f59dfacd1ccc 39a5e1f5-c20c-40b1-a633-a8457d273eaf b59b79d7-660b-4823-8a81-159e0a6a2809 4f49cbdc-cf96-4657-a50e-3082935e1cdf 571c1cc4-a48d-40be-88fd-df1d5cc21d10 79830aee-0a91-406d-a2f7-c103002203f7 788b39a9-6358-4598-9903-92ce97aa5502 569fac2e-82eb-486b-9446-6afae3984efe a1ca4c85-b8a5-4b63-a9dc-f01c87a0d65f 58bd6827-f156-4cd2-ac31-53953b6df61a 36e5f0d8-4806-439f-af08-b28c593347c1 aac01cd8-9436-456b-9e8b-a5f87b815e07 d00a8d7b-320e-43bc-824f-ff899ff93687 ad578d02-f485-4e11-a1d4-08bcd4f462a9 42d06892-449c-44d2-9251-7b9448ce4ddc
```

## Texts the games' servers write into the match state (not translated)

- War (`42d06892-…`): `view.log` ("War begins! Both players flip.", "… has no cards to flip!", "Waiting for …", …).
- Chutes & Ladders (`cbd19f63-…`): the lines of `view.log` ("Roll-off to see who goes first! …", "… goes first! Order: …" and the chore messages).

These stay as the server writes them; changing them needs a new server version of those games.
