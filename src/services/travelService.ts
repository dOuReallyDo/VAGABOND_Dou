import Anthropic from "@anthropic-ai/sdk";
import { TravelInputs, TravelPlan, TravelPlanSchema } from "../shared/contract";

export type { TravelInputs };

export type ProgressCallback = (step: string, progress: number) => void;

async function getApiKey(): Promise<string> {
  let apiKey = "";

  // Try to get key from server (which reads process.env)
  try {
    const configRes = await fetch("/api/config");
    if (configRes.ok) {
      const config = await configRes.json();
      apiKey = config.apiKey;
    }
  } catch (e) {
    console.warn("Failed to fetch config from server", e);
  }

  // Fallback to Vite-injected env var
  if (!apiKey || apiKey.length < 20 || apiKey.startsWith("MY_")) {
    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey && envKey.length > 20 && !envKey.startsWith("MY_")) {
      apiKey = envKey;
    }
  }

  // Sanitize
  apiKey = apiKey?.trim() || "";
  if (
    (apiKey.startsWith('"') && apiKey.endsWith('"')) ||
    (apiKey.startsWith("'") && apiKey.endsWith("'"))
  ) {
    apiKey = apiKey.slice(1, -1);
  }

  if (!apiKey) {
    throw new Error(
      "Configurazione incompleta: API Key non trovata. Contatta l'amministratore."
    );
  }

  return apiKey;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  const block = content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return block?.text ?? "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function repairJson(jsonText: string): any {
  try {
    return JSON.parse(jsonText);
  } catch {
    // Try to fix truncated JSON by balancing braces/brackets
    let fixed = jsonText;
    const openBraces = (fixed.match(/\{/g) || []).length;
    const closeBraces = (fixed.match(/\}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) fixed += " ]".repeat(openBrackets - closeBrackets);
    if (openBraces > closeBraces) fixed += " }".repeat(openBraces - closeBraces);
    return JSON.parse(fixed);
  }
}

export const generateTravelPlan = async (
  inputs: TravelInputs,
  onProgress?: ProgressCallback
): Promise<TravelPlan> => {
  onProgress?.("Inizializzazione richiesta...", 5);

  try {
    onProgress?.("Verifica configurazione...", 10);
    const apiKey = await getApiKey();

    onProgress?.("Analizzo la destinazione e il periodo...", 20);

    const totalPeople = inputs.people.adults + inputs.people.children.length;
    const nights = Math.round(
      (new Date(inputs.endDate).getTime() - new Date(inputs.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const totalDays = nights + 1;

    const start = new Date(inputs.startDate);
    const dateList = Array.from({ length: totalDays })
      .map((_, i) => {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        return `- Giorno ${i + 1}: ${d.toLocaleDateString("it-IT", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}`;
      })
      .join("\n");

    onProgress?.("Preparazione prompt...", 30);

    let prompt = `
Sei un esperto agente di viaggi con profonda conoscenza locale. Il tuo obiettivo è pianificare un viaggio REALE, FATTIBILE e CONCRETO.

REGOLE CRITICHE PER VOLI E LOGISTICA:
1. VERIFICA VOLI (OBBLIGATORIO): Usa la ricerca web per verificare gli orari REALI dei voli su Google Flights per le date richieste.
   - Se la destinazione è Capo Verde (Boa Vista, Sal, etc.) e non ci sono voli diretti dalla città di partenza (${inputs.departureCity}), DEVI obbligatoriamente inserire uno STOPOVER (es. a Lisbona con TAP) e prevedere una notte di pernottamento nello scalo se la coincidenza è scomoda o l'arrivo è tardi.
   - NON inventare orari. Se non trovi voli, cambia le date o aggiungi tappe intermedie e spiegalo nel campo "budgetWarning".
   - Ogni segmento di volo deve avere orari precisi (es. 10:30) e il link al sito ufficiale della compagnia.
2. STOPOVER PROATTIVI: Se un volo dura più di 8 ore o se c'è un cambio fuso orario importante, inserisci una notte di riposo nella città di scalo.
3. COERENZA DATE E PERNOTTAMENTI: L'itinerario deve coprire esattamente dal ${inputs.startDate} al ${inputs.endDate}. Ogni giorno (tranne l'ultimo se si rientra in giornata) DEVE terminare con un'attività chiamata "Pernottamento: [Nome Hotel]" con il nome reale dell'hotel scelto. Il numero totale di notti deve corrispondere al periodo selezionato.
4. ALLOGGI E TAPPE: Per OGNI tappa del viaggio (inclusi eventuali stopover), DEVI creare un oggetto nell'array "accommodations". L'hotel inserito in "accommodations" deve essere lo STESSO hotel indicato nelle attività di "Pernottamento" dell'itinerario per quella specifica tappa. DEVI fornire i dettagli completi (nome, tipo, stelle, rating, reviewSummary, estimatedPricePerNight, bookingUrl, address, amenities) per l'hotel scelto. Assicurati che il numero di notti ("nights") per ogni tappa sia corretto e che la somma totale delle notti coincida con la durata del viaggio.

DETTAGLI VIAGGIO:
- Partenza: ${inputs.departureCity}
- Destinazione: ${inputs.destination}
- Stopover richiesto: ${inputs.stopover || "Nessuno"}
- Orario preferito: ${inputs.departureTimePreference || "Indifferente"}
- Budget: €${inputs.budget} per ${totalPeople} persone
- Note: ${inputs.notes || "nessuna"}

REGOLE DI FORMATO:
- Immagini: Usa la ricerca web per una heroImageUrl panoramica reale.
- Coordinate: Lat/Lng precise per ogni luogo.
- Hotel/Ristoranti: Solo strutture reali, aperte e verificate su Booking/TripAdvisor.
- Brevità: Descrizioni di massimo 5 parole. Sii telegrafico per evitare troncamenti.
- JSON: Restituisci SOLO il JSON senza commenti o markdown.

ITINERARIO GIORNALIERO:
${dateList}

Struttura JSON richiesta (DEVI riempire TUTTI i campi con dati reali):
{
  "budgetWarning": "Spiegazione eventuali modifiche voli/date",
  "destinationOverview": {
    "title": "Nome Destinazione",
    "description": "Breve descrizione",
    "tagline": "Slogan",
    "heroImageUrl": "URL immagine",
    "attractions": [
      { "name": "A", "description": "D", "category": "C", "estimatedVisitTime": "1h", "lat": 0, "lng": 0 }
    ]
  },
  "weatherInfo": {
    "summary": "S", "pros": "P", "cons": "C", "averageTemp": "20C", "packingTips": "T"
  },
  "safetyAndHealth": {
    "safetyWarnings": "W", "vaccinationsRequired": "V", "safetyLevel": "L", "emergencyNumbers": "N"
  },
  "itinerary": [
    {
      "day": 1,
      "title": "Data - Titolo",
      "theme": "Tema",
      "activities": [
        { "time": "08:00", "location": "L", "name": "N", "description": "D", "costEstimate": 0, "duration": "1h", "transport": "T", "travelTime": "10m", "tips": "T" },
        { "time": "22:00", "location": "L", "name": "Pernottamento: [Nome Hotel]", "description": "Riposo in hotel", "costEstimate": 0, "duration": "10h" }
      ]
    }
  ],
  "budgetBreakdown": {
    "flights": 0, "accommodation": 0, "activities": 0, "food": 0, "transport": 0, "misc": 0, "totalEstimated": 0, "perPersonPerDay": 0
  },
  "flights": [
    {
      "segmentName": "Volo 1",
      "options": [
        { "airline": "A", "route": "R", "estimatedPrice": 0, "date": "D", "departureTime": "00:00", "arrivalTime": "00:00", "duration": "1h", "bookingUrl": "U" }
      ]
    }
  ],
  "accommodations": [
    {
      "stopName": "Città 1",
      "nights": 2,
      "options": [
        { "name": "Hotel A", "type": "Hotel", "rating": 4.5, "reviewSummary": "Ottimo", "estimatedPricePerNight": 120, "bookingUrl": "U1", "address": "Indirizzo 1", "amenities": ["WiFi"], "stars": 4 }
      ]
    },
    {
      "stopName": "Città 2",
      "nights": 3,
      "options": [
        { "name": "Hotel B", "type": "Resort", "rating": 4.8, "reviewSummary": "Eccellente", "estimatedPricePerNight": 200, "bookingUrl": "U2", "address": "Indirizzo 2", "amenities": ["Piscina"], "stars": 5 }
      ]
    }
  ],
  "bestRestaurants": [
    {
      "stopName": "Città",
      "options": [
        { "name": "R", "cuisineType": "C", "rating": 5, "reviewSummary": "R", "priceRange": "€€", "address": "A", "mustTry": "P" }
      ]
    }
  ],
  "mapPoints": [
    { "lat": 0, "lng": 0, "label": "L", "type": "T" }
  ],
  "localTips": ["T1", "T2"],
  "transportInfo": {
    "localTransport": "T",
    "bestApps": ["A"],
    "estimatedLocalCost": "10E",
    "privateTransferLinks": [
      { "provider": "P", "url": "U", "description": "D" }
    ]
  },
  "travelBlogs": [
    { "title": "T", "url": "U", "description": "D" }
  ]
}
`;

    if (inputs.modificationRequest && inputs.previousPlan) {
      prompt = `
Sei un esperto agente di viaggi. Hai precedentemente generato questo piano di viaggio:
${JSON.stringify(inputs.previousPlan)}

L'utente ha richiesto le seguenti modifiche o aggiunte:
"${inputs.modificationRequest}"

Aggiorna il piano di viaggio tenendo conto di queste richieste. Mantieni la stessa struttura JSON esatta e le stesse REGOLE ASSOLUTE. DEVI includere TUTTI i campi (anche reviewSummary, rating, address, etc.).
CRITICO: Per evitare errori di troncamento del JSON: DEVI mantenere TUTTE le descrizioni (description, summary, reviewSummary, pros, cons) a MASSIMO 5 parole. Ometti i campi "sourceUrl", "imageUrl", "lat" e "lng" per le attività dell'itinerario. Se il viaggio supera i 4 giorni, riduci le attività giornaliere a 3 (Mattina, Pomeriggio, Sera) e ometti "sourceUrl" dai ristoranti e "bookingUrl" dagli hotel.
Restituisci SOLO il JSON aggiornato.
`;
    }

    onProgress?.(
      inputs.modificationRequest ? "Aggiorno l'itinerario..." : "Ricerca voli, alloggi e attrazioni...",
      45
    );

    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 12000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }] as any,
      messages: [
        {
          role: "user",
          content:
            prompt +
            "\n\nIMPORTANTE: Restituisci esclusivamente un oggetto JSON valido. Non includere testo prima o dopo il JSON. Non usare blocchi di codice markdown (```json). NON inserire citazioni o riferimenti bibliografici nel testo. NON spiegare il tuo ragionamento, non fare preamboli, non fare commenti finali. Restituisci SOLO il JSON.",
        },
      ],
    });

    onProgress?.("Elaborazione dati ricevuti...", 85);
    const text = extractText(response.content);

    const jsonStartIdx = text.indexOf("{");
    const jsonEndIdx = text.lastIndexOf("}");

    if (jsonStartIdx === -1 || jsonEndIdx === -1) {
      console.error("Nessun JSON trovato nel testo ricevuto:", text);
      throw new Error("L'AI non ha restituito un piano di viaggio valido. Riprova.");
    }

    const jsonText = text.substring(jsonStartIdx, jsonEndIdx + 1);

    let json: unknown;
    try {
      json = repairJson(jsonText);
    } catch {
      throw new Error(
        "L'AI ha interrotto la generazione dell'itinerario perché troppo lungo. Prova a ridurre la durata del viaggio o a essere più specifico nelle note."
      );
    }

    // Data Cleaning (Pre-validation)
    const j = json as Record<string, unknown>;
    if (j.transportInfo && Array.isArray((j.transportInfo as Record<string, unknown>).privateTransferLinks)) {
      (j.transportInfo as Record<string, unknown>).privateTransferLinks = (
        (j.transportInfo as Record<string, unknown>).privateTransferLinks as unknown[]
      ).filter(
        (link) =>
          link &&
          typeof link === "object" &&
          !Array.isArray(link) &&
          (link as Record<string, unknown>).provider &&
          (link as Record<string, unknown>).url
      );
    }
    if (Array.isArray(j.travelBlogs)) {
      j.travelBlogs = (j.travelBlogs as unknown[]).filter(
        (blog) =>
          blog &&
          typeof blog === "object" &&
          !Array.isArray(blog) &&
          (blog as Record<string, unknown>).title &&
          (blog as Record<string, unknown>).url
      );
    }
    if (Array.isArray(j.flights)) {
      (j.flights as unknown[]).forEach((segment) => {
        if (segment && Array.isArray((segment as Record<string, unknown>).options)) {
          (segment as Record<string, unknown>).options = (
            (segment as Record<string, unknown>).options as unknown[]
          ).filter(
            (opt) =>
              opt &&
              typeof opt === "object" &&
              !Array.isArray(opt) &&
              (opt as Record<string, unknown>).airline
          );
        }
      });
    }

    const validationResult = TravelPlanSchema.safeParse(json);
    if (!validationResult.success) {
      console.error("Validation Errors:", JSON.stringify(validationResult.error.issues, null, 2));
      throw new Error("Il piano generato non rispetta il formato richiesto. Riprova.");
    }

    return validationResult.data;
  } catch (error) {
    console.error("API call failed:", error);
    throw error;
  }
};

export const getDestinationCountries = async (destination: string): Promise<string[]> => {
  const apiKey = await getApiKey();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const prompt = `
In quale nazione si trova la destinazione "${destination}"?
Se il nome corrisponde a più luoghi in nazioni diverse (es. "Boa Vista" può essere a Capo Verde o in Brasile), elenca TUTTE le nazioni possibili.
Se corrisponde a una sola nazione, elenca solo quella.
Se la destinazione è già una nazione (es. "Islanda"), restituisci il nome della nazione in italiano.

Restituisci SOLO un array JSON di stringhe con i nomi delle nazioni in italiano. Esempio: ["Capo Verde", "Brasile"] oppure ["Francia"].
`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    let text = extractText(response.content);
    text = text.replace(/^```json\s*/, "").replace(/```$/, "").trim();

    // Extract array from text
    const arrStart = text.indexOf("[");
    const arrEnd = text.lastIndexOf("]");
    if (arrStart !== -1 && arrEnd !== -1) {
      text = text.substring(arrStart, arrEnd + 1);
    }

    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (e) {
    console.error("Errore nel recupero delle nazioni:", e);
    return [];
  }
};

export const summarizeAccommodationReviews = async (
  name: string,
  city: string,
  startDate: string,
  endDate: string,
  people: { adults: number; children: { age: number }[] }
) => {
  const apiKey = await getApiKey();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const totalPeople = people.adults + people.children.length;
  const prompt = `
Sei un assistente di viaggio esperto. Cerca informazioni, recensioni e PREZZI REALI per l'alloggio "${name}" a "${city}" su siti come Booking.com e TripAdvisor.
Verifica se l'alloggio esiste davvero in quella città.

DETTAGLI VIAGGIO:
- Date: ${startDate} -> ${endDate}
- Persone: ${people.adults} adulti, ${people.children.length} bambini (età: ${people.children.map((c) => c.age).join(", ") || "N/A"})

Restituisci SOLO JSON valido (zero markdown, zero commenti) con questa struttura esatta:
{
  "exists": true,
  "summary": "Riassunto delle recensioni (circa 3-4 frasi)",
  "pros": ["Pro 1", "Pro 2"],
  "cons": ["Contro 1", "Contro 2"],
  "estimatedPricePerNight": 150,
  "bookingUrl": "URL DI RICERCA DIRETTO SU BOOKING.COM PER LE DATE E PERSONE INDICATE"
}

Se l'alloggio NON esiste a "${city}", imposta "exists": false e lascia gli altri campi vuoti o con un messaggio di errore nel "summary".
Il prezzo "estimatedPricePerNight" deve essere il costo REALE PER NOTTE per TUTTE le ${totalPeople} persone (quindi il costo della camera/e necessarie) per il periodo indicato.

IMPORTANTE: Restituisci esclusivamente un oggetto JSON valido. Non includere testo prima o dopo il JSON. Non usare blocchi di codice markdown.
`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }] as any,
    messages: [{ role: "user", content: prompt }],
  });

  const text = extractText(response.content);

  const jsonStartIdx = text.indexOf("{");
  const jsonEndIdx = text.lastIndexOf("}");

  if (jsonStartIdx === -1 || jsonEndIdx === -1) {
    console.error("Nessun JSON trovato nelle recensioni:", text);
    throw new Error("L'AI non ha restituito recensioni valide.");
  }

  try {
    return repairJson(text.substring(jsonStartIdx, jsonEndIdx + 1));
  } catch {
    throw new Error("L'AI non ha restituito un JSON valido per le recensioni.");
  }
};
