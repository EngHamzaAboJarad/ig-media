# ig-media

Media and publishing schedule for @hamza_abojarad.

- `schedule.json`: each item has `id`, `type` (image / carousel / story / reel), `media` (paths in this repo), `caption`, `at`, `status`.
- `.github/workflows/publish.yml`: runs every 10 minutes and publishes items whose time has come.
- Secret `IG_TOKEN`: Instagram API (Instagram Login) token with `instagram_business_content_publish`.
