-- Tabla de hojas de Google Sheets por regional.
-- Ya está creada en la base "magic-night-hojas". Este archivo queda como respaldo.
CREATE TABLE IF NOT EXISTS hojas (
  id       TEXT PRIMARY KEY,
  regional TEXT NOT NULL,
  titulo   TEXT NOT NULL,
  url      TEXT NOT NULL,
  creado   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hojas_regional ON hojas (regional, creado);
