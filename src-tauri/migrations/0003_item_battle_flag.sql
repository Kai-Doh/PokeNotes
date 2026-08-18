-- Flags items that are plausible competitive held items (held-items, choice
-- items, berries, plates, mega stones, z-crystals, etc.), as opposed to key
-- items, medicine, TMs, mail, Poke Balls, and other non-battle categories
-- that would otherwise clutter the team builder's item picker.
ALTER TABLE items ADD COLUMN is_battle_item INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_items_battle ON items(is_battle_item);
