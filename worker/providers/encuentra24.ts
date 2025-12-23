// worker/providers/encuentra24.ts
import * as cheerio from "cheerio";

export type Listing = {
  external_id?: string;
  title?: string;
  url?: string;
  price?: string;
  city?: string;
  country?: string;
  raw: any;
};

export async function fetchEncuentra24Page(opts: {
  page: number;
  niche: string;      // "autos"
  country: string;    // "PA"
}): Promise<{ listings: Listing[]; hasMore: boolean }> {
  // OJO: aquí debes poner el URL real de búsqueda/paginación de Encuentra24.
  // Ejemplo placeholder:
  const url = `https://example.com/search?niche=${opts.niche}&country=${opts.country}&page=${opts.page}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "RevenueASI-LeadHunter/1.0",
      "Accept": "text/html",
    },
  });

  if (!res.ok) throw new Error(`fetch page failed ${res.status}`);
  const html = await res.text();

  const $ = cheerio.load(html);

  // ⚠️ Ajusta estos selectores a la realidad del DOM
  const cards = $(".listing-card").toArray();

  const listings: Listing[] = cards.map((el) => {
    const card = $(el);
    const href = card.find("a").attr("href") ?? "";
    const fullUrl = href.startsWith("http") ? href : `https://example.com${href}`;

    const title = card.find(".title").text().trim();
    const price = card.find(".price").text().trim();
    const external_id = card.attr("data-id") ?? undefined;

    return {
      external_id,
      title,
      url: fullUrl,
      price,
      city: undefined,
      country: opts.country,
      raw: { html_snippet: card.text().slice(0, 400) },
    };
  });

  const hasMore = listings.length > 0; // simple; luego lo mejoras con paginación real
  return { listings, hasMore };
}
