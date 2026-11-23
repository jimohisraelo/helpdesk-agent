-- Runs automatically the first time the Postgres container starts
-- (files in /docker-entrypoint-initdb.d run in alphabetical order).

CREATE TABLE customers (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL
);

CREATE TABLE orders (
  id           TEXT PRIMARY KEY,               -- e.g. KM-10421
  customer_id  INT  NOT NULL REFERENCES customers(id),
  status       TEXT NOT NULL CHECK (status IN ('processing', 'shipped', 'delivered', 'cancelled', 'returned')),
  items        JSONB NOT NULL,                 -- [{ "name": ..., "qty": ..., "price_ngn": ... }]
  total_ngn    INT  NOT NULL,
  eta          DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Help-centre articles, searched with Postgres full-text search.
CREATE TABLE help_articles (
  id      SERIAL PRIMARY KEY,
  slug    TEXT NOT NULL UNIQUE,
  title   TEXT NOT NULL,
  body    TEXT NOT NULL,
  search  TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED
);
CREATE INDEX help_articles_search_idx ON help_articles USING GIN (search);

CREATE TABLE tickets (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  summary     TEXT NOT NULL,
  priority    TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Full agent transcripts (including tool calls), so a chat can continue across requests.
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  messages    JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
