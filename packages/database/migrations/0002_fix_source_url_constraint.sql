ALTER TABLE materials
  DROP CONSTRAINT IF EXISTS materials_source_url_check;

ALTER TABLE materials
  ADD CONSTRAINT materials_source_url_check
  CHECK (source_url ~ '^https://(x[.]com|twitter[.]com)/[^/]+/status/[0-9]+([/?#].*)?$');
