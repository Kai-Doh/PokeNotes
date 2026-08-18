-- Switches item icons from a per-file PokeAPI sprite URL (missing for ~21%
-- of held items -- PokeAPI's community sprite repo hasn't caught up on a
-- lot of Gen 8/9 competitive items, some quite common ones like Booster
-- Energy) to Showdown's own spritesheet, which is complete and always
-- current (it's what the real Showdown client renders). sprite_x/sprite_y
-- are the background-position offsets into that sheet.
ALTER TABLE items DROP COLUMN sprite;
ALTER TABLE items ADD COLUMN sprite_x INTEGER;
ALTER TABLE items ADD COLUMN sprite_y INTEGER;
