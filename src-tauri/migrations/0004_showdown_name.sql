-- The exact display string Showdown itself uses for this species/form (e.g.
-- "Charizard-Mega-X", "Necrozma-Dusk-Mane"), needed verbatim so a team
-- export/import round-trips correctly -- our own display_name + form_label
-- wording doesn't reliably reconstruct Showdown's naming convention.
ALTER TABLE pokemon ADD COLUMN showdown_name TEXT;
