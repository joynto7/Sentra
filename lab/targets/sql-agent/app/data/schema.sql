-- The synthetic database of the fictional Halcyon Bank that the assistant answers from
-- (FR-11.1). It is built again from this file and seed.sql at every start and every reset
-- (UC-11.2), so a reset always gives the same starting point.
CREATE TABLE customers (
    reference TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    email     TEXT NOT NULL,
    city      TEXT NOT NULL
);

CREATE TABLE accounts (
    reference TEXT PRIMARY KEY,
    customer  TEXT NOT NULL REFERENCES customers (reference),
    kind      TEXT NOT NULL,
    balance   REAL NOT NULL,
    note      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE payments (
    id          INTEGER PRIMARY KEY,
    account     TEXT NOT NULL REFERENCES accounts (reference),
    description TEXT NOT NULL,
    amount      REAL NOT NULL,
    paid_on     TEXT NOT NULL
);
