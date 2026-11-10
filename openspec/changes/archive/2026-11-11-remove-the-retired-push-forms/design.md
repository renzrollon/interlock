# Design

## D1. Refuse by the existing unknown-flag path, and say why

`--notify` leaves `run close`'s flag table and the boolean-flag list, so `firstUnknownFlag` refuses it by name, exit 2, before the dispatch. For `run close --notify` and `notify --title|--body|--priority` the message carries one clause naming the retired request and telling the reader to update the plugin: the only reader of the refusal is an older driver's relay, and it prints the message verbatim. No new exit code.

## D2. Keep `notify` as an empty leaf

`notify: []` stays in the table so a retired flag is refused by name rather than falling through as an unknown subcommand. Any `notify` word other than `checkpoint` exits 1 with the one remaining form.

## D3. A refused close writes nothing

The refusal happens before any manifest read. An older driver's refused close therefore records no receipt and leaves the run and its stage marker in place; `interlock run close` without the flag closes it. This is the cost of the removal, and the upgrade notes say it.

## D4. A standing pin replaces the dated one

The version-gated test that went red at 1.16.0 becomes an unconditional one: the flag table lacks the flags, and the retired names are gone from `lib/receipt.mjs` and `cli/interlock`.
