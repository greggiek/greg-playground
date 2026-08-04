// server-example.js
// Illustrative only. Do not put Shopify Admin credentials in browser code.

import express from "express";

const app = express();
app.use(express.json());

app.get("/api/products", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();

    const response = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2026-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query ProductVariants($query: String!) {
              productVariants(first: 25, query: $query) {
                nodes {
                  id
                  title
                  sku
                  price
                  product { title }
                }
              }
            }
          `,
          variables: {
            query: search ? `title:*${search}* OR sku:*${search}*` : ""
          }
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Shopify responded with ${response.status}`);
    }

    const body = await response.json();

    if (body.errors) {
      return res.status(400).json({ errors: body.errors });
    }

    const products = body.data.productVariants.nodes.map((variant) => ({
      id: variant.id,
      title: variant.product.title,
      variant: variant.title,
      sku: variant.sku,
      price: Number(variant.price),
    }));

    res.json({ products });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load Shopify products." });
  }
});

app.listen(3000, () => {
  console.log("CRM API running on http://localhost:3000");
});
