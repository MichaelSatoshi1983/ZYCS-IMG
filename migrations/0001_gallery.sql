CREATE TABLE IF NOT EXISTS gallery_images (
  imgur_id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  link TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS gallery_images_uploaded_at_idx
  ON gallery_images(uploaded_at DESC);
