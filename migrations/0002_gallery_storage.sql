ALTER TABLE gallery_images
  ADD COLUMN storage TEXT NOT NULL DEFAULT 'imgur';

UPDATE gallery_images
  SET storage = 'r2'
  WHERE link LIKE '%/v2/%';
