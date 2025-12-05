import OpenAI from "https://esm.sh/openai@4.20.0";

const client = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

export async function generateEmailCopy({
  name,
  business,
  pain,
  offer,
  icp,
}: {
  name: string | null;
  business: string | null;
  pain: string;
  offer: string;
  icp: string;
}) {
  const prompt = `
Actúa como un copywriter experto en cold email con estilo directo, cortante, cero bullshit.

Genera:

1. SUBJECT (máximo 6 palabras, estilo humano)
2. BODY (70-120 palabras, directo, coloquial, específico al ICP)

Contexto del lead:
- Nombre: ${name || "amigo"}
- Negocio: ${business || "tu negocio"}
- ICP: ${icp}
- Pain principal: ${pain}
- Oferta: ${offer}

Tono: Conversacional, sin adornos, sin frases cliché, orientado a dolor y beneficio.

Devuélvelo en JSON:
{
  "subject": "...",
  "body": "..."
}
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 300,
  });

  try {
    return JSON.parse(completion.choices[0].message.content);
  } catch {
    return {
      subject: "Consulta rápida",
      body: "Hola — quería comentarte algo que puede mejorar tus resultados. ¿Tienes 30 segundos esta semana?",
    };
  }
}
