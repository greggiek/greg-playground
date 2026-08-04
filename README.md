README
Bargain Prospect CRM — MVP Prototype
A lightweight, mobile-first prospecting CRM built around one simple lifecycle:
Prospect → Customer
Included
Add a prospect with:
Company name
Phone number
Address
Notes
Automatic time-stamped activity timeline
Add notes without overwriting prior history
Optional follow-up reminders
Today's follow-up list
Search prospects
Build a quote from Shopify-style product line items
Enter quantity and calculate line totals / quote total
Save quotes to the prospect timeline
Demo “Convert to Customer” action
Browser localStorage persistence
Run it
No installation is required.
Open index.html in a modern browser.
Add prospects and test the workflow.
For best results during development, run a simple local server:
python3 -m http.server 8080
​
Then visit:
<http://localhost:8080>
​
Shopify integration points
The prototype currently uses mockShopifyProducts in app.js.
For production:
Create a secure backend endpoint that queries Shopify Admin GraphQL.
Replace mockShopifyProducts with a call such as:
GET /api/products?search=shaker
Return only the fields needed by the CRM:
Variant ID
Product title
Variant title
SKU
Price
When a prospect makes the first purchase:
Create or match the Shopify customer
Save the returned Shopify customer ID
Create a draft order or order from the accepted quote
Never expose the Shopify Admin API token in browser JavaScript.
Recommended next production step
Move data from localStorage into a small database and add user login. A simple production stack could be:
Front end: this app or React / Next.js
API: Next.js API routes, Node/Express, or Supabase Edge Functions
Database: PostgreSQL / Supabase
Authentication: Google Workspace login or Supabase Auth
Shopify: Admin GraphQL API through the server only
