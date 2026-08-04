# Bargain Prospect CRM

A lightweight, mobile-first prospecting CRM built around one simple lifecycle:

**Prospect → Customer**

## Included

- Add a prospect with:
  - Company name
  - Phone number
  - Address
  - Notes
- Automatic time-stamped activity timeline
- Add notes without overwriting prior history
- Optional follow-up reminders
- Today's follow-up list
- Search prospects
- Pipeline stages, owners, estimated opportunity value, and dashboard totals
- Filter prospects by stage and export the CRM as CSV
- Edit prospect contact and pipeline details
- Search live Shopify product variants by title, SKU, or option
- Enter quantity and calculate line totals / quote total
- Push quotes into Shopify as Draft Orders
- Save Shopify Draft Order references and invoice links to the prospect timeline
- Demo “Convert to Customer” action
- Browser localStorage persistence

## Run it

No installation is required.

1. Open `index.html` in a modern browser.
2. Add prospects and test the workflow.

For best results during development, run a simple local server:

```bash
python3 -m http.server 8080
```

Then visit:

```text
http://localhost:8080
```

## Shopify connection

The Vercel API routes use Shopify Admin GraphQL API `2026-07` and the client-credentials grant. Configure these environment variables in Vercel:

```text
SHOPIFY_STORE_DOMAIN=eh1h8t-4b.myshopify.com
SHOPIFY_CLIENT_ID=from Shopify Dev Dashboard
SHOPIFY_CLIENT_SECRET=from Shopify Dev Dashboard
```

Endpoints:

- `GET /api/products?search=shaker` searches active Shopify variants.
- `POST /api/draft-orders` creates a Shopify Draft Order.
- `GET /api/health` confirms deployment and environment configuration.

Never expose Shopify credentials in browser JavaScript or commit them to GitHub.

## Recommended next production step

Move data from localStorage into a small database and add user login. A simple production stack could be:

- Front end: this app or React / Next.js
- API: Next.js API routes, Node/Express, or Supabase Edge Functions
- Database: PostgreSQL / Supabase
- Authentication: Google Workspace login or Supabase Auth
- Shopify: Admin GraphQL API through the server only
