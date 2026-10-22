-- Workshop equipment lending schema, foundation version 1.
-- Keep integrity rules here as well as in the service layer so that a direct
-- SQL write cannot create records the application considers impossible.

CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    asset_tag TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(asset_tag)) > 0),
    category TEXT NOT NULL CHECK (length(trim(category)) > 0),
    notes TEXT
);

-- Asset tags identify one physical item and are compared without regard to case.
CREATE UNIQUE INDEX IF NOT EXISTS equipment_asset_tag_unique
    ON equipment (asset_tag COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS borrowers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    email TEXT NOT NULL CHECK (length(trim(email)) > 0),
    notes TEXT
);

CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY,
    equipment_id INTEGER NOT NULL REFERENCES equipment (id) ON DELETE RESTRICT,
    borrower_id INTEGER NOT NULL REFERENCES borrowers (id) ON DELETE RESTRICT,
    checkout_date TEXT NOT NULL CHECK (date(checkout_date) = checkout_date),
    due_date TEXT NOT NULL CHECK (date(due_date) = due_date),
    returned_date TEXT CHECK (returned_date IS NULL OR date(returned_date) = returned_date),
    CHECK (due_date >= checkout_date),
    CHECK (returned_date IS NULL OR returned_date >= checkout_date)
);

-- At most one active loan per physical item. Returned rows may accumulate as history.
CREATE UNIQUE INDEX IF NOT EXISTS loans_one_active_per_equipment
    ON loans (equipment_id) WHERE returned_date IS NULL;

CREATE INDEX IF NOT EXISTS loans_borrower_id ON loans (borrower_id);
CREATE INDEX IF NOT EXISTS loans_active_due ON loans (due_date) WHERE returned_date IS NULL;
