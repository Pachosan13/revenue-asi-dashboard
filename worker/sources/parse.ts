import * as fs from "node:fs";
import * as path from "node:path";
import * as cheerio from "cheerio";

type Listing = {
  adid: number;
  price?: number;
  make?: string;
  model?: string;
  fuel?: string;
  trans?: string;
  category?: string;
  location?: string;
  feature?: string;
};

function parseGa4Addata(html: string): Record<number, any> {
  // match: ga4addata[31437579] = {...}
  const re = /ga4addata\[(\d+)\]\s*=\s*(\{.*?\})<\/script>/gs;
  const out: Record<number, any> = {};
  let m: RegExpExecArray | null;

  while ((m = re.exec(html))) {
    const id = Number(m[1]);
    const json = m[2];
    try {
      out[id] = JSON.parse(json);
    } catch {
      // ignora si algo raro
    }
  }
  return out;
}

export function parseEncuentra24Html(html: string): Listing[] {
  const $ = cheerio.load(html);
  const ga4 = parseGa4Addata(html);

  const listings: Listing[] = [];

  $(".d3-ad-tile").each((_, el) => {
    const fav = $(el).find("a.tool-favorite[data-adid]").first();
    const adidStr = fav.attr("data-adid");
    if (!adidStr) return;

    const adid = Number(adidStr);
    const priceStr = fav.attr("data-price");
    const price = priceStr ? Number(priceStr) : undefined;

    const g = ga4[adid] || {};

    listings.push({
      adid,
      price,
      category: g.category,
      location: g.location,
      feature: g.feature,
      make: g.f_make,
      model: g.f_model,
      fuel: g.f_fuel,
      trans: g.f_trans,
    });
  });

  // de-dup por si hay basura/repe
  const map = new Map<number, Listing>();
  for (const l of listings) map.set(l.adid, l);
  return [...map.values()];
}

// CLI local test
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] || path.join(process.cwd(), "encuentra24html.html");
  const html = fs.readFileSync(file, "utf8");
  const rows = parseEncuentra24Html(html);
  console.log("count:", rows.length);
  console.log(rows.slice(0, 5));
}
