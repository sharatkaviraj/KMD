-- The private bucket student documents live in.
--
-- A migration rather than a dashboard click, because it has to exist on the
-- live project at cutover too and a setting nobody wrote down is a setting
-- somebody has to rediscover.
--
-- Named `vppsone-` so it cannot collide with the fee app's four buckets on the
-- same project. Private: a document is served through a signed URL minted
-- after a permission check, never by a public path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vppsone-documents',
  'vppsone-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
  set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
