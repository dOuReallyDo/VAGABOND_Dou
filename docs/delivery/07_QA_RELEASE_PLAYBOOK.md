# QA & Release Playbook

## Minimum tests
- schema validation tests (happy path + bad inputs)
- 5 golden test cases (seasonality/budget/constraints variations)
- UI: loading/error/retry states
- link/map clickability checks
- mobile responsiveness

### URL Safety tests (`npm test`)
Unit tests in `src/__tests__/urlSafety.test.ts` cover:
- Whitelisted domains pass through unchanged
- IP address URLs are blocked and replaced
- URL shorteners (bit.ly, tinyurl, etc.) are blocked
- Suspicious TLDs (.xyz, .top, etc.) are blocked
- HTTP (non-HTTPS) URLs are blocked
- URLs with tracking parameters are cleaned or replaced
- Safe alternatives are correctly generated (Booking.com, TripAdvisor, Google Maps)
- `sanitizeTravelPlan()` processes TravelPlan objects end-to-end
- Google Safe Browsing API integration (with cache)

Run: `npm test` or `npm run test:watch`

## Release checklist
- staging smoke test
- env vars set (including `GOOGLE_SAFE_BROWSING_API_KEY` if using Safe Browsing API)
- rate limit on
- logs on
- monitor errors post-deploy
- verify URL sanitization works (generate a plan, inspect all outbound URLs are HTTPS + whitelisted domains)
