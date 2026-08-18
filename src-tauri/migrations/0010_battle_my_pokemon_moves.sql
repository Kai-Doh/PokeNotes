-- battle_my_pokemon already snapshots item/ability/tera_type by value (not a
-- live reference to team_members), so past battles stay linked to the exact
-- roster used even after the team changes later. Moves were the one field
-- missing from that snapshot.
ALTER TABLE battle_my_pokemon ADD COLUMN move1_id INTEGER REFERENCES moves(id);
ALTER TABLE battle_my_pokemon ADD COLUMN move2_id INTEGER REFERENCES moves(id);
ALTER TABLE battle_my_pokemon ADD COLUMN move3_id INTEGER REFERENCES moves(id);
ALTER TABLE battle_my_pokemon ADD COLUMN move4_id INTEGER REFERENCES moves(id);
