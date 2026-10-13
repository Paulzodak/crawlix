# Qlarety web scraper

Local service that finds a requested page on a website and returns normalized content for legal-document analysis. The process listens on loopback.

## Setup

```bash
npm install
```

Create a `.env` file:

```env
PORT=8001
DATABASE_URL=postgresql://user:password@localhost:5432/scraper
OPENAI_API_KEY=your_openai_api_key
# OPENAI_MODEL=gpt-4o-mini
# WEBSITE_NAVIGATION_TIMEOUT_MS=45000
# WEBSITE_REQUEST_TIMEOUT_MS=30000
# WEBSITE_MAX_REDIRECTS=5
# WEBSITE_MAX_CANDIDATES=12
# WEBSITE_MAX_SITEMAP_URLS=500
# WEBSITE_MAX_CONTENT_CHARS=100000
# WEBSITE_CACHE_TTL_SECONDS=86400
# WEBSITE_MAX_CONCURRENT_PAGES=2
```

`DATABASE_URL` is used when Prisma client types are generated. `OPENAI_API_KEY` is required for LLM ranking/verification. Website discovery timeouts and limits are optional and have defaults.

## Run

```bash
npm run dev
```

The process binds to `127.0.0.1`. Set `HOST=0.0.0.0` only when a local Docker port mapping needs to reach the process.

## API

Interactive docs are at [http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs). The OpenAPI document is at `/docs.json`.

### Health

```
GET /health
```

### Find a website page

```
POST /api/website/page
Content-Type: application/json

{
  "websiteUrl": "https://example.com",
  "pageRequest": "privacy policy"
}
```

Success:

```json
{
  "success": true,
  "page": {
    "title": "Privacy Policy",
    "url": "https://example.com/privacy-policy",
    "type": "privacy_policy",
    "content": "...",
    "confidence": 0.97
  }
}
```

Not found:

```json
{
  "success": false,
  "error": {
    "code": "PAGE_NOT_FOUND",
    "message": "Could not find a page matching the requested content."
  }
}
```

### Render HTML

```
POST /api/pdf/render
Content-Type: application/json

{
  "html": "<html><body><h1>Hello</h1></body></html>",
  "output": "pdf"
}
```

`output` may be `pdf`, `png`, or `jpeg`. The response is the rendered file.

## Tests

```bash
npm test
```

Unit coverage includes SSRF checks, request classification, candidate URLs, relevance scoring, URL helpers, LLM verdict parsing, and cache single-flight.
