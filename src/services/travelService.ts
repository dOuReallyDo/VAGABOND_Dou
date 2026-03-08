import { TravelInputs, TravelPlan, TravelPlanSchema } from "../shared/contract";
import { GoogleGenAI } from "@google/genai";

export type { TravelInputs };

export type ProgressCallback = (step: string, progress: number) => void;

export const generateTravelPlan = async (
  inputs: TravelInputs,
  onProgress?: ProgressCallback
): Promise<TravelPlan> => {
  onProgress?.("Inizializzazione richiesta...", 5);

  try {
    // 1. Get API Key
    onProgress?.("Verifica configurazione...", 10);
    
    // First try to get key from server (which reads process.env)
    let apiKey = "";
    try {
      const configRes = await fetch("/api/config");
      if (configRes.ok) {
        const config = await configRes.json();
        apiKey = config.apiKey;
      }
    } catch (e) {
      console.warn("Failed to fetch config from server", e);
    }

    // If server key is missing or looks like a placeholder, try client-side injection
    if (!apiKey || apiKey.length < 20 || apiKey.startsWith("MY_G")) {
       // Try process.env injected by Vite (if any)
       const envKey = process.env.GEMINI_API_KEY;
       if (envKey && envKey.length > 20 && !envKey.startsWith("MY_G")) {
         apiKey = envKey;
       }
    }

    // Sanitize key
    apiKey = apiKey?.trim() || "";
    if ((apiKey.startsWith('"') && apiKey.endsWith('"')) || (apiKey.startsWith("'") && apiKey.endsWith("'"))) {
      apiKey = apiKey.slice(1, -1);
    }

    // If still missing/invalid, we cannot proceed, but we won't prompt the user.
    // We'll try to use what we have, or throw a clear error if it's completely empty.
    if (!apiKey || apiKey.length < 20) {
        console.warn("API Key might be invalid or missing. Attempting to use what is available.");
        // If it's completely empty, we can't instantiate GoogleGenAI.
        // However, the user asked to "not ask for api keys".
        // If the environment is not set up, we can't magically make it work.
        // But maybe there's a default key injected by the platform that we missed?
        // Let's check process.env.API_KEY again.
        if (process.env.API_KEY && process.env.API_KEY.length > 20) {
            apiKey = process.env.API_KEY;
        }
    }

    if (!apiKey) {
         throw new Error("Configurazione incompleta: API Key non trovata. Contatta l'amministratore.");
    }

    onProgress?.("Analizzo la destinazione e il periodo...", 20);

    const ai = new GoogleGenAI({ apiKey });

    // 3. Construct Prompt
    const totalPeople = inputs.people.adults + inputs.people.children.length;
    const nights = Math.round(
      (new Date(inputs.endDate).getTime() - new Date(inputs.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const totalDays = nights + 1;

    const start = new Date(inputs.startDate);
    const dateList = Array.from({ length: totalDays }).map((_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return `- Giorno ${i + 1}: ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    }).join('\n');

    onProgress?.("Preparazione prompt...", 30);

    let prompt = `
Sei un esperto agente di viaggi con profonda conoscenza locale. Pianifica un viaggio REALE e CONCRETO.

VIAGGIO:
- Partenza: ${inputs.departureCity}
- Destinazione: ${inputs.destination}
- Stopover (Tappa intermedia): ${inputs.stopover || "Nessuno"}
- Orario partenza preferito: ${inputs.departureTimePreference || "Indifferente"}
- Periodo: ${inputs.startDate} -> ${inputs.endDate} (${nights} notti, ${totalDays} giorni)
- Date flessibili: ${inputs.isPeriodFlexible ? "Sì" : "No"}
- Gruppo: ${inputs.people.adults} adulti, ${inputs.people.children.length} bambini (età: ${inputs.people.children.map((c) => c.age).join(", ") || "N/A"})
- Budget TOTALE: €${inputs.budget} per ${totalPeople} persone
- Alloggio preferito: ${inputs.accommodationType}
- Note: ${inputs.notes || "nessuna"}

REGOLE ASSOLUTE:
1. IMMAGINI: Usa il tool Google Search per trovare un'immagine panoramica REALE, pubblica e ad ALTA RISOLUZIONE della destinazione principale. Inserisci l'URL diretto dell'immagine nel campo \`heroImageUrl\`. Cerca di preferire link da Wikimedia Commons, Unsplash o siti di fotografia che permettano il hotlinking. NON inserire immagini per attrazioni, attività, hotel o ristoranti.
2. LINK: Usa SOLO URL affidabili e reali.
3. COORDINATE E MAPPA: Ogni luogo DEVE avere lat/lng precise. Nel campo \`mapPoints\`, DEVI includere obbligatoriamente anche la città di partenza (${inputs.departureCity}) e la destinazione principale (${inputs.destination}).
4. COSTI: Realistici. Totale non superiore a €${inputs.budget}.
5. HOTEL E RISTORANTI REALI: Solo strutture che esistono davvero con nomi precisi. DEVI verificare l'effettiva DISPONIBILITÀ, lo STATO di apertura (NON proporre strutture "temporaneamente chiuse" su Google) e i prezzi reali per notte su Booking.com o TripAdvisor per le date specifiche di ogni tappa. Se una struttura non è disponibile o chiusa, proponine un'altra valida. Fornisci 2 opzioni di alloggio per OGNI tappa e ALMENO 2 opzioni per i ristoranti per OGNI tappa.
6. ITALIANO CORRETTO: Grammatica italiana perfetta.
7. VELOCITÀ: Sii conciso nelle descrizioni.

8. ITINERARIO COMPLETO E DETTAGLIATO: L'itinerario DEVE coprire TUTTI I ${totalDays} GIORNI del viaggio, senza saltarne nessuno.
Ecco le date esatte per cui DEVI generare l'itinerario:
${dateList}

Per OGNI SINGOLO GIORNO dell'elenco qui sopra, DEVI creare un oggetto nell'array "itinerary" (quindi l'array "itinerary" DEVE avere esattamente ${totalDays} elementi).
Il campo "title" di ogni giorno DEVE includere la data esatta (es. "1 aprile 2026 - Arrivo e prima esplorazione").
Per ogni giorno, DEVI pianificare dettagliatamente:
- Cosa fare la mattina
- Dove pranzare
- Cosa fare il pomeriggio
- Dove cenare
- Cosa fare la sera
Per ogni singola attività (inclusi i pasti) devi specificare l'orario esatto, la durata, i mezzi di trasporto e i tempi di percorrenza. Includi attività principali turistiche e non turistiche a seconda di quanto richiesto nelle note. Se l'attività è un volo (es. volo di andata o ritorno), imposta costEstimate: 0.

9. METEO (CLIMA E VIAGGI): Per la sezione "weatherInfo", DEVI cercare su Google "clima e viaggi ${inputs.destination}" ed estrarre le informazioni ESATTE da quel sito per il mese del viaggio. Riassumi le temperature, il clima, i pro e i contro basandoti esclusivamente su quella fonte.

10. VOLI: Se l'itinerario prevede più voli (es. stopover, voli interni, multi-tratta), DEVI coprire l'INTERO viaggio assicurandoti che l'utente possa SEMPRE ritornare alla città di partenza (${inputs.departureCity}). Per ogni segmento di volo (es. 'Volo 1: Milano - Lisbona', 'Volo 2: Lisbona - Boa Vista'), fornisci i dettagli di ANDATA e, se l'itinerario prevede il ritorno in quella città, anche del RITORNO. Se l'itinerario è circolare o multi-tappa senza ritorni intermedi, usa voli 'Solo andata' per ogni tratta fino al rientro finale a ${inputs.departureCity}. Esempio: se fai Milano-Lisbona-Boa Vista-Milano, puoi presentare 3 voli solo andata oppure 2 voli andata/ritorno se la logica lo consente (es. MIL-LIS A/R e LIS-BVC A/R). Scegli la struttura più logica per l'itinerario proposto. Ogni segmento DEVE avere ESATTAMENTE 1 opzione reale (la migliore per rapporto qualità/prezzo). Per l'opzione di volo DEVI specificare obbligatoriamente la DATA prevista del volo nel campo "date" (formato DD/MM/YYYY). DEVI VERIFICARE gli ORARI ESATTI e i GIORNI DI OPERATIVITÀ sul sito della compagnia aerea scelta per quel giorno specifico (es. TAP Portugal vola su Boa Vista SOLO il Martedì e il Sabato). Se non ci sono voli nei giorni richiesti, DEVI modificare l'itinerario aggiungendo uno stopover o cambiando le date e spiegare chiaramente la modifica nel campo "budgetWarning" (es. "Ho aggiunto un giorno di stopover a Lisbona perché il volo TAP per Boa Vista opera solo il Martedì e il Sabato"). Il link "bookingUrl" DEVE ESSERE il link diretto al sito ufficiale della compagnia aerea specifica (es. https://www.ita-airways.com, https://www.flytap.com, https://www.ryanair.com, etc.) e NON a Google Flights o altri aggregatori. Tieni conto dell'orario di partenza preferito (${inputs.departureTimePreference}) se specificato.

11. ALLOGGI E NOTTI: Per ogni tappa in "accommodations", DEVI specificare il numero di notti ("nights") che hai stimato per quella tappa. ATTENZIONE: La somma totale delle notti in hotel + le eventuali notti in volo (es. volo notturno) DEVE COINCIDERE ESATTAMENTE con il numero di notti del periodo specificato (${totalDays - 1} notti totali). Deve essere chiarissimo dove l'utente pernotta ogni singola notte del viaggio. Per questo motivo, OGNI GIORNO dell'itinerario (tranne l'ultimo se si rientra in giornata) DEVE terminare con un'attività chiamata "Pernottamento: [Nome Hotel]" (es. "Pernottamento: Hotel Ritz"). Il nome dell'hotel deve essere reale e specifico. Nella sezione "accommodations", DEVI inserire come UNICA opzione per ogni tappa proprio l'hotel che hai scelto per il pernottamento nell'itinerario giornaliero di quella tappa. Se si ipotizza di stare più notti nella stessa tappa, l'hotel resta lo stesso. I PREZZI e la DISPONIBILITÀ degli alloggi devono essere VERIFICATI e REALI per le date esatte di ogni tappa, usando come riferimento Booking.com o TripAdvisor. DEVI assicurarti che la struttura sia APERTA e operativa (verifica lo stato su Google). Se l'hotel scelto non è disponibile o risulta chiuso per quelle date, DEVI cercarne e proporne uno alternativo che sia aperto e disponibile.

12. COSTI: I costi di voli, treni e attività devono essere indicati PER PERSONA. Il costo degli hotel deve essere indicato PER CAMERA a notte. Il budget totale ("budgetBreakdown") deve tenere conto del numero di persone (${inputs.people.adults} adulti e ${inputs.people.children.length} bambini). IMPORTANTE: Se inserisci il volo come attività nell'itinerario giornaliero (es. "Volo di andata"), DEVI impostare il suo "costEstimate" a 0 e nel campo "tips" o "description" DEVI scrivere ESATTAMENTE "vedi costo nella sezione voli". Il costo reale del volo deve essere valorizzato ESCLUSIVAMENTE nella sezione finale "flights" e nel "budgetBreakdown" per evitare che venga conteggiato due volte.

13. LUOGO ATTIVITÀ: Per ogni attività nell'itinerario, DEVI specificare il luogo esatto ("location") in cui si svolge (es. "Milano", "Roma", "Parigi").

14. BREVITÀ ESTREMA (CRITICO): Per evitare errori di troncamento del JSON:
- Mantieni TUTTE le descrizioni (description, summary, reviewSummary, pros, cons) a MASSIMO 3 parole. Sii telegrafico.
- Limita le "attractions" a massimo 2.
- Limita i "travelBlogs" a massimo 1.
- Limita i "localTips" a massimo 2.
- Ometti i campi "sourceUrl", "imageUrl", "lat" e "lng" per le attività dell'itinerario.
- Se il viaggio supera i 3 giorni: riduci le attività giornaliere a 2 (Mattina, Sera) accorpando i pasti; ometti i ristoranti dall'itinerario giornaliero; ometti "sourceUrl" dai ristoranti e "bookingUrl" dagli hotel.
- Non aggiungere mai commenti o testo extra fuori dal JSON.

Restituisci SOLO JSON valido (zero markdown, zero commenti) con questa struttura esatta:
{
  "budgetWarning": null,
  "destinationOverview": {
    "title": "Nome Destinazione",
    "country": "SOLO il nome della nazione in italiano (es. Francia, Giappone). NON inserire la città.",
    "tagline": "Frase ispirazionale breve",
    "description": "Descrizione evocativa 2-3 frasi",
    "heroImageUrl": "URL immagine reale",
    "attractions": [
      {
        "name": "Nome Attrazione",
        "description": "Descrizione 2 righe con dettagli pratici",
        "sourceUrl": "URL reale",
        "lat": 0.0000,
        "lng": 0.0000,
        "category": "Cultura",
        "estimatedVisitTime": "2 ore"
      }
    ]
  },
  "weatherInfo": {
    "summary": "Meteo per il periodo specifico",
    "averageTemp": "22°C",
    "pros": "Aspetti positivi della stagione",
    "cons": "Aspetti negativi della stagione",
    "packingTips": "Cosa portare in valigia"
  },
  "safetyAndHealth": {
    "safetyLevel": "Alto",
    "safetyWarnings": "Avvertenze di sicurezza",
    "vaccinationsRequired": "Vaccinazioni necessarie o nessuna",
    "emergencyNumbers": "112 - Emergenze generali",
    "travelInsuranceTip": "Consiglio assicurazione viaggio"
  },
  "itinerary": [
    {
      "day": 1,
      "title": "Titolo Giornata",
      "theme": "Tema della giornata",
      "activities": [
        {
          "time": "09:00",
          "location": "Milano",
          "name": "Nome Attività",
          "description": "Max 5 parole",
          "costEstimate": 25,
          "duration": "2 ore",
          "transport": "Metro Linea 1",
          "travelTime": "15 min",
          "tips": "Consiglio insider"
        }
      ]
    }
  ],
  "budgetBreakdown": {
    "flights": 400,
    "accommodation": 800,
    "activities": 300,
    "food": 300,
    "transport": 100,
    "misc": 100,
    "totalEstimated": 2000,
    "perPersonPerDay": 66
  },
  "flights": [
    {
      "segmentName": "Volo 1: Internazionale",
      "options": [
        {
          "airline": "ITA Airways",
          "route": "MXP -> JFK",
          "estimatedPrice": 450,
          "departureTime": "10:30",
          "arrivalTime": "14:00",
          "duration": "9h 30m",
          "returnDepartureTime": "18:00",
          "returnArrivalTime": "08:00 (+1)",
          "returnDuration": "8h 00m",
          "type": "Più economico",
          "bookingUrl": "https://www.google.com/flights?q=flights+from+MXP+to+JFK+on+2026-04-01+return+2026-04-08",
          "options": ["Bagaglio a mano incluso", "Cancellazione con penale"]
        },
        {
          "airline": "Delta Air Lines",
          "route": "MXP -> JFK",
          "estimatedPrice": 520,
          "departureTime": "12:00",
          "arrivalTime": "15:30",
          "duration": "9h 30m",
          "returnDepartureTime": "20:00",
          "returnArrivalTime": "10:00 (+1)",
          "returnDuration": "8h 00m",
          "type": "Consigliato",
          "bookingUrl": "https://www.google.com/flights?q=flights+from+MXP+to+JFK+on+2026-04-01+return+2026-04-08",
          "options": ["Pasti inclusi", "Wi-Fi a bordo"]
        }
      ]
    },
    {
      "segmentName": "Volo 2: Interno",
      "options": [
        {
          "airline": "JetBlue",
          "route": "JFK -> LAX",
          "estimatedPrice": 150,
          "departureTime": "09:00",
          "arrivalTime": "12:00",
          "duration": "6h 00m",
          "type": "Più economico",
          "bookingUrl": "https://www.google.com/flights?q=flights+from+JFK+to+LAX+on+2026-04-05",
          "options": ["Diretto"]
        },
        {
          "airline": "United Airlines",
          "route": "JFK -> LAX",
          "estimatedPrice": 180,
          "departureTime": "11:00",
          "arrivalTime": "14:00",
          "duration": "6h 00m",
          "type": "Consigliato",
          "bookingUrl": "https://www.google.com/flights?q=flights+from+JFK+to+LAX+on+2026-04-05",
          "options": ["Wi-Fi incluso"]
        }
      ]
    }
  ],
  "accommodations": [
    {
      "stopName": "Nome città tappa",
      "nights": 3,
      "options": [
        {
          "name": "Nome Hotel Reale",
          "type": "Boutique Hotel",
          "stars": 4,
          "rating": 8.9,
          "reviewSummary": "Max 10 parole",
          "estimatedPricePerNight": 150,
          "bookingUrl": "URL reale",
          "lat": 0.0000,
          "lng": 0.0000,
          "address": "Indirizzo reale",
          "amenities": ["WiFi", "Colazione inclusa"]
        }
      ]
    }
  ],
  "bestRestaurants": [
    {
      "stopName": "Nome città tappa",
      "options": [
        {
          "name": "Nome Ristorante Reale",
          "cuisineType": "Cucina locale",
          "rating": 9.0,
          "reviewSummary": "Max 10 parole",
          "sourceUrl": "URL reale",
          "priceRange": "€€",
          "address": "Indirizzo reale",
          "mustTry": "Piatto da non perdere",
          "lat": 0.0000,
          "lng": 0.0000
        }
      ]
    }
  ],
  "mapPoints": [
    { "lat": 0.0000, "lng": 0.0000, "label": "Nome punto", "type": "attraction" }
  ],
  "localTips": ["Consiglio locale 1", "Consiglio locale 2", "Consiglio locale 3"],
  "transportInfo": {
    "localTransport": "Come muoversi in loco",
    "bestApps": ["App utile 1", "App utile 2"],
    "estimatedLocalCost": "5-10€/giorno"
  },
  "travelBlogs": [
    {
      "title": "Titolo dell'articolo o del blog",
      "url": "URL reale e funzionante",
      "description": "Breve descrizione di cosa tratta l'articolo"
    }
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

    onProgress?.(inputs.modificationRequest ? "Aggiorno l'itinerario..." : "Ricerca voli, alloggi e attrazioni...", 45);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt + "\n\nIMPORTANTE: Restituisci esclusivamente un oggetto JSON valido. Non includere testo prima o dopo il JSON. Non usare blocchi di codice markdown (```json). NON inserire citazioni o riferimenti bibliografici nel testo. NON spiegare il tuo ragionamento, non fare preamboli, non fare commenti finali. Restituisci SOLO il JSON.",
      config: {
        temperature: 0.1,
        tools: [{ googleSearch: {} }],
      },
    });

    onProgress?.("Elaborazione dati ricevuti...", 85);
    let text = response.text || "";
    
    // Pulizia robusta del testo: estraiamo solo la parte tra il primo { e l'ultimo }
    const jsonStartIdx = text.indexOf("{");
    const jsonEndIdx = text.lastIndexOf("}");
    
    if (jsonStartIdx === -1 || jsonEndIdx === -1) {
      console.error("Nessun JSON trovato nel testo ricevuto:", text);
      throw new Error("L'AI non ha restituito un piano di viaggio valido. Riprova.");
    }

    let jsonText = text.substring(jsonStartIdx, jsonEndIdx + 1);
    
    let json;
    try {
      json = JSON.parse(jsonText);
    } catch (e) {
      console.error("Errore parsing JSON AI. Testo estratto:", jsonText);
      
      // Tentativo di riparazione per JSON troncato
      try {
        let fixedText = jsonText;
        const openBraces = (fixedText.match(/\{/g) || []).length;
        const closeBraces = (fixedText.match(/\}/g) || []).length;
        const openBrackets = (fixedText.match(/\[/g) || []).length;
        const closeBrackets = (fixedText.match(/\]/g) || []).length;
        
        // Se mancano chiusure, proviamo a chiudere gli array e gli oggetti aperti
        if (openBrackets > closeBrackets) fixedText += ' ]'.repeat(openBrackets - closeBrackets);
        if (openBraces > closeBraces) fixedText += ' }'.repeat(openBraces - closeBraces);
        
        json = JSON.parse(fixedText);
      } catch (e2) {
        throw new Error("L'AI ha interrotto la generazione dell'itinerario perché troppo lungo. Prova a ridurre la durata del viaggio o a essere più specifico nelle note.");
      }
    }
    
    onProgress?.("Finalizzazione piano di viaggio...", 95);

    // 4. Validate Output
    const validationResult = TravelPlanSchema.safeParse(json);
    
    if (!validationResult.success) {
      console.error("Validation Error:", validationResult.error);
      throw new Error("Il piano generato non rispetta il formato richiesto. Riprova.");
    }
    
    return validationResult.data;

  } catch (error) {
    console.error("API call failed:", error);
    throw error;
  }
};

export const getDestinationCountries = async (destination: string): Promise<string[]> => {
  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    if (process.env.API_KEY && process.env.API_KEY.length > 20) {
      apiKey = process.env.API_KEY;
    }
  }
  if (!apiKey) {
    throw new Error("API Key non trovata.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
In quale nazione si trova la destinazione "${destination}"?
Se il nome corrisponde a più luoghi in nazioni diverse (es. "Boa Vista" può essere a Capo Verde o in Brasile), elenca TUTTE le nazioni possibili.
Se corrisponde a una sola nazione, elenca solo quella.
Se la destinazione è già una nazione (es. "Islanda"), restituisci il nome della nazione in italiano.

Restituisci SOLO un array JSON di stringhe con i nomi delle nazioni in italiano. Esempio: ["Capo Verde", "Brasile"] oppure ["Francia"].
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    let text = response.text || "";
    text = text.replace(/^```json\s*/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (e) {
    console.error("Errore nel recupero delle nazioni:", e);
    return [];
  }
};

export const summarizeAccommodationReviews = async (name: string, city: string, startDate: string, endDate: string, people: { adults: number, children: { age: number }[] }) => {
  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    if (process.env.API_KEY && process.env.API_KEY.length > 20) {
      apiKey = process.env.API_KEY;
    }
  }
  if (!apiKey) {
    throw new Error("API Key non trovata.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const totalPeople = people.adults + people.children.length;
  const prompt = `
Sei un assistente di viaggio esperto. Cerca informazioni, recensioni e PREZZI REALI per l'alloggio "${name}" a "${city}" su siti come Booking.com e TripAdvisor.
Verifica se l'alloggio esiste davvero in quella città.

DETTAGLI VIAGGIO:
- Date: ${startDate} -> ${endDate}
- Persone: ${people.adults} adulti, ${people.children.length} bambini (età: ${people.children.map(c => c.age).join(', ') || 'N/A'})

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
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt + "\n\nIMPORTANTE: Restituisci esclusivamente un oggetto JSON valido. Non includere testo prima o dopo il JSON. Non usare blocchi di codice markdown (```json).",
    config: {
      temperature: 0.3,
      tools: [{ googleSearch: {} }],
    },
  });

  let text = response.text || "";
  
  // Pulizia robusta del testo: estraiamo solo la parte tra il primo { e l'ultimo }
  const jsonStartIdx = text.indexOf("{");
  const jsonEndIdx = text.lastIndexOf("}");
  
  if (jsonStartIdx === -1 || jsonEndIdx === -1) {
    console.error("Nessun JSON trovato nelle recensioni:", text);
    throw new Error("L'AI non ha restituito recensioni valide.");
  }

  let jsonText = text.substring(jsonStartIdx, jsonEndIdx + 1);
  
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    console.error("Errore parsing JSON recensioni. Testo estratto:", jsonText);
    
    // Tentativo di riparazione per JSON troncato
    try {
      let fixedText = jsonText;
      const openBraces = (fixedText.match(/\{/g) || []).length;
      const closeBraces = (fixedText.match(/\}/g) || []).length;
      const openBrackets = (fixedText.match(/\[/g) || []).length;
      const closeBrackets = (fixedText.match(/\]/g) || []).length;
      
      if (openBrackets > closeBrackets) fixedText += ' ]'.repeat(openBrackets - closeBrackets);
      if (openBraces > closeBraces) fixedText += ' }'.repeat(openBraces - closeBraces);
      
      return JSON.parse(fixedText);
    } catch (e2) {
      throw new Error("L'AI non ha restituito un JSON valido per le recensioni.");
    }
  }
};
