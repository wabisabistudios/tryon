/**
 * Demo source for development / when real scrapers are blocked.
 * Returns realistic sample listings so the scoring UI can be validated.
 */

const AMAZON_SOURCE = "amazon_in";
const FLIPKART_SOURCE = "flipkart";
const OLX_SOURCE = "olx_in";

const SAMPLES = [
  // new / retail style
  { source: AMAZON_SOURCE, title: "LG 27 Inch UltraGear QHD IPS 144Hz Gaming Monitor 27GL850", price: 18999, list_price: 34999, rating: 4.5, review_count: 1240, image: "https://via.placeholder.com/300x200?text=LG+Monitor" },
  { source: FLIPKART_SOURCE, title: "Samsung 27-inch Odyssey G5 1000R Curved Gaming Monitor 144Hz", price: 21999, list_price: 38999, rating: 4.4, review_count: 890, image: "https://via.placeholder.com/300x200?text=Samsung+Monitor" },
  { source: AMAZON_SOURCE, title: "Acer Nitro VG270U 27 Inch WQHD IPS 144Hz Gaming Monitor", price: 15999, list_price: 25999, rating: 4.3, review_count: 560, image: "https://via.placeholder.com/300x200?text=Acer+Monitor" },
  { source: FLIPKART_SOURCE, title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones", price: 24999, list_price: 34999, rating: 4.6, review_count: 3200, image: "https://via.placeholder.com/300x200?text=Sony+Headphones" },
  { source: AMAZON_SOURCE, title: "Apple MacBook Air M3 13-inch 8GB RAM 256GB SSD", price: 89999, list_price: 114900, rating: 4.7, review_count: 1500, image: "https://via.placeholder.com/300x200?text=MacBook+Air" },
  { source: FLIPKART_SOURCE, title: "Samsung Galaxy S24 5G 256GB", price: 54999, list_price: 79999, rating: 4.5, review_count: 2100, image: "https://via.placeholder.com/300x200?text=Galaxy+S24" },
  { source: AMAZON_SOURCE, title: "Dell S2722DGM 27 Inch 2K 165Hz Curved Gaming Monitor", price: 16999, list_price: 28999, rating: 4.2, review_count: 430, image: "https://via.placeholder.com/300x200?text=Dell+Monitor" },
  { source: FLIPKART_SOURCE, title: "Logitech MX Master 3S Wireless Mouse", price: 6499, list_price: 10995, rating: 4.7, review_count: 7800, image: "https://via.placeholder.com/300x200?text=MX+Master+3S" },
  { source: AMAZON_SOURCE, title: "Canon EOS R50 Mirrorless Camera Body with RF-S 18-45mm Lens", price: 51999, list_price: 72995, rating: 4.6, review_count: 340, image: "https://via.placeholder.com/300x200?text=Canon+R50" },
  { source: FLIPKART_SOURCE, title: "Nintendo Switch OLED Model White", price: 27999, list_price: 34999, rating: 4.8, review_count: 5200, image: "https://via.placeholder.com/300x200?text=Switch+OLED" },
  // used / OLX style
  { source: OLX_SOURCE, title: "LG 27GL850 27 inch 144Hz QHD monitor — 6 months old", price: 11500, list_price: 34999, condition: "used", seller: "Bangalore, KA", availability: "2 days ago", image: "https://via.placeholder.com/300x200?text=LG+Monitor+Used" },
  { source: OLX_SOURCE, title: "MacBook Air M3 256GB barely used with box", price: 72000, list_price: 114900, condition: "used", seller: "Mumbai, MH", availability: "5 hours ago", image: "https://via.placeholder.com/300x200?text=MacBook+Used" },
  { source: OLX_SOURCE, title: "Sony WH-1000XM5 excellent condition", price: 15500, list_price: 34999, condition: "used", seller: "Hyderabad, TS", availability: "1 day ago", image: "https://via.placeholder.com/300x200?text=Sony+Used" },
  { source: OLX_SOURCE, title: "Samsung Odyssey G5 27 inch curved 144Hz", price: 14000, list_price: 38999, condition: "used", seller: "Chennai, TN", availability: "3 days ago", image: "https://via.placeholder.com/300x200?text=Samsung+Used" },
];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function keywordMatches(query, title) {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  const t = title.toLowerCase();
  return q.every((word) => t.includes(word));
}

export async function searchDemo(query) {
  const q = (query || "").trim();
  const matches = SAMPLES.filter((s) => keywordMatches(q, s.title));

  // If the query is very generic, return a few varied items.
  const items = matches.length ? matches : SAMPLES.slice(0, 8);

  return {
    ok: true,
    source: "demo_all",
    demo: true,
    count: items.length,
    items: items.map((s) => {
      const sourceId = hashString(s.title);
      const isOlx = s.source === OLX_SOURCE;
      // Generate a deterministic "history" so anomaly detection triggers.
      // Current price is the sample price; history is higher.
      const historyBase = s.list_price || s.price * 1.25;
      return {
        source: s.source,
        source_id: sourceId,
        title: s.title,
        url: isOlx
          ? `https://www.olx.in/item/${sourceId}-demo`
          : `https://www.amazon.in/s?k=${encodeURIComponent(s.title)}&demo=1`,
        image: s.image || null,
        brand: null,
        model: null,
        specs_json: null,
        rating: s.rating || null,
        review_count: s.review_count || null,
        price: s.price,
        list_price: s.list_price || Math.round(s.price * 1.25),
        currency: "INR",
        availability: s.availability || "In stock",
        seller: s.seller || "Demo Seller",
        is_fulfilled: isOlx ? 0 : 1,
        condition: s.condition || "new",
        // Attach fake history directly for the engine to consume.
        demo_history: [historyBase, historyBase * 0.98, historyBase * 0.97, historyBase * 0.95, s.price * 1.05],
      };
    }),
  };
}
