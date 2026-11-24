# Keyword cannibalization checker

Finds pages on a website that compete for the same keywords, groups pages that cover the same topic, and checks whether a new topic is already covered. Every user brings their own Moz API token (and optionally a Claude API key and a Google sign-in), so it works for any site.

**Tabs**

- **Library**: every URL with its section, topic cluster, target keyword, volume, ranking status, clicks, impressions, sessions and overlap type. Filter by any column, copy rows, download the whole library as .xlsx.
- **Cannibalized**: by keyword (every keyword where 2+ of your pages rank, with severity, a rule-based fix per URL and an optional Claude review) or by topic (pages covering the same topic).
- **Topic check**: type a topic or working title; see the closest existing pages and ranking keywords, a write / refresh / differentiate verdict, and Claude's verdict.
- **Settings**: keys, domain, Google connection (Search Console + GA4), library size and cost estimate, build / rebuild.

**Data sources**

| Source | What it adds | Needed? |
| --- | --- | --- |
| Moz API | Keywords the site ranks for, ranking page, position, search volume, difficulty, intent | Yes (user's token) |
| Site crawl | Page titles, publish dates, sections (sitemap, respects robots.txt) | Automatic |
| Google Search Console | Every page that shows for each query, clicks, impressions, avg position (last 3 months) | Yes (each user signs in with their own Google account); Moz-only fallback available |
| GA4 | Sessions per page (last 12 months) | Yes (same Google sign-in) |
| Claude | Reviews and verdicts | Optional (user's key) |

**Privacy**: keys live in the user's browser. Google tokens live in an encrypted HTTP-only cookie. Search Console / GA4 data is processed in memory and returned to the browser; the library, reviews and checks are stored in the browser (IndexedDB) only. The only server-side storage is the public-page site index in Vercel Blob. See `/privacy.html`.

## Deploy

1. Import the repo in Vercel (framework: Next.js).
2. Storage -> Blob -> create a store (Public) and connect it to the project, then redeploy.
3. Google sign-in (needed for Search Console + GA4): in Google Cloud, enable the **Google Search Console API**, **Google Analytics Data API** and **Google Analytics Admin API**; configure the OAuth consent screen (External; scopes `webmasters.readonly`, `analytics.readonly`, `openid`, `email`; add test users while in Testing); create an OAuth client (Web application) with redirect URI `https://<your-app>.vercel.app/api/google/callback`. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to the Vercel project and redeploy.
   - In Testing mode, up to 100 test users can connect. For anyone to connect, submit the app for Google verification (sensitive scopes; needs the privacy page, a homepage and a short demo video).

## Local

```
npm install
MOCK=1 npm run dev   # canned Moz / Claude / Google data, no keys needed
```

The UI is plain HTML/JS in `public/` (built from `ui/` with `python3 ui/build.py`). API routes are in `app/api/`.
