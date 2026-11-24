# Keyword cannibalization checker

Finds pages on a website that compete for the same keywords, groups pages that cover the same topic, and checks whether a new topic is already covered. Every user brings their own Moz API token (optionally a Claude API key, and a Search Console + GA4 export from Google Sheets), so it works for any site.

**Tabs**

- **Library**: every URL with its section, topic cluster, target keyword, volume, ranking status, clicks, impressions, sessions and overlap type. Filter by any column, copy rows, download the whole library as .xlsx.
- **Cannibalized**: by keyword (every keyword where 2+ of your pages rank, with severity, a rule-based fix per URL and an optional Claude review) or by topic (pages covering the same topic).
- **Topic check**: type a topic or working title; see the closest existing pages and ranking keywords, a write / refresh / differentiate verdict, and Claude's verdict.
- **Settings**: keys, Search Console + GA4 upload (or a whole library), domain and paths, library size and cost estimate, build / rebuild.

**Data sources**

| Source | What it adds | Needed? |
| --- | --- | --- |
| Moz API | Keywords the site ranks for, ranking page, position, search volume, difficulty, intent | Yes (user's token) |
| Site crawl | Page titles, publish dates, sections (sitemap, respects robots.txt) | Automatic |
| Google Search Console | Every page that shows for each query, clicks, impressions, avg position (last 3 months) | Recommended: uploaded as .xlsx/.csv from Google Sheets ([how-to](public/how-to-library.html), Claude skill in `public/skills/`) |
| GA4 | Sessions per page (last 12 months) | Recommended: same upload |
| Claude | Reviews and verdicts | Optional (user's key) |

**Privacy**: keys live in the user's browser. Uploaded Search Console / GA4 data is processed in memory and returned to the browser; the library, reviews and checks are stored in the browser (IndexedDB) only. The only server-side storage is the public-page site index in Vercel Blob. See `/privacy.html`.

## Deploy

1. Import the repo in Vercel (framework: Next.js).
2. Storage -> Blob -> create a store (Public) and connect it to the project, then redeploy.
3. Optional, not switched on: direct Google sign-in (Search Console + GA4 via OAuth) is built in (`app/api/google/*`, `lib/google.ts`) but disabled in the UI (`GOOGLE_ENABLED` in `ui/bottom.js`). Turning it on needs a Google Cloud OAuth client and, for public use, Google's app verification.

## Local

```
npm install
MOCK=1 npm run dev   # canned Moz / Claude / Google data, no keys needed
```

The UI is plain HTML/JS in `public/` (built from `ui/` with `python3 ui/build.py`). API routes are in `app/api/`.
