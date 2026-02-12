# Login Machine

AI-powered login automation. Uses Claude to classify login pages and Playwright (via BrowserBase) to interact with them.

## Stack

- Next.js 16 (App Router) + React 19 + Tailwind 4
- Anthropic Claude (`@ai-sdk/anthropic`) for page analysis
- BrowserBase + Playwright for cloud browser automation

## Setup

```bash
cp .env.example .env.local
# Fill in your API keys
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `BROWSERBASE_API_KEY` | BrowserBase API key |
| `BROWSERBASE_PROJECT_ID` | BrowserBase project ID |
