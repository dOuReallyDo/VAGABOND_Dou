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

    // Build traveler profile section
    const profileSection = inputs.travelerProfile ? `
PROFILO VIAGGIATORE:
- Fascia d'età: ${inputs.travelerProfile.ageRange || 'Non specificata'}
- Tipo di viaggio: ${inputs.travelerProfile.travelerType || 'Non specificato'}
- Interessi: ${inputs.travelerProfile.interests?.length ? inputs.travelerProfile.interests.join(', ') : 'Non specificati'}
- Stile di viaggio: ${inputs.travelerProfile.pace || 'Equilibrato'}
- Mobilità: ${inputs.travelerProfile.mobility || 'Nessuna limitazione'}
- Conoscenza destinazione: ${inputs.travelerProfile.familiarity || 'Prima volta'}

REGOLE BASATE SUL PROFILO:
${inputs.travelerProfile.pace === 'Slow & relax' ? '- Rallenta il ritmo: MAX 2-3 attività al giorno. Includi pranzi lunghi, pause caffè, tempo libero per esplorare senza fretta.\n- Suggerisci esperienze rilassanti: terme, passeggiate, mercati locali, aperitivi al tramonto.\n- Evita itinerari fitti: meglio approfondire meno cose con più tempo per ognuna.' : ''}
${inputs.travelerProfile.pace === 'Avventura intensa' ? '- Ritmo intenso: 4-5 attività al giorno. Alzata all\'alba, giorno pieno, serale con vita notturna.\n- Includi esperienze adrenaliniche: escursioni, sport, tour guidati mattina presto.\n- Suggerisci sia attrazioni imperdibili che esperienze fuori dai sentieri battuti.' : ''}
${inputs.travelerProfile.travelerType?.includes('Coppia romantica') ? '- Questo è un viaggio ROMANTICO. Suggerisci: ristoranti intimi con candele, esperienze per due (cena sul tetto, gita in barca al tramonto), alloggi con vista o jacuzzi.\n- Evita: ostelli-party, attrazioni per famiglie rumorose, alberghi troppo economici.\n- Nel "localTips" aggiungi consigli specifici per coppie.' : ''}
${inputs.travelerProfile.travelerType?.includes('bimbi piccoli') ? '- Questo viaggio include BAMBINI PICCOLI. Regole fondamentali:\n  a) Orari flessibili per pisolini (2-3h di pausa dopo pranzo).\n  b) Attrazioni kid-friendly: parchi giochi, spiagge con acqua bassa, zoo, musei interattivi.\n  c) Ristoranti family-friendly con menù bambini e seggioloni.\n  d) Hotel con piscina, giardino, camere spaziose (family room).\n  e) Includi sempre un\'attività indoor per giorni di pioggia.\n  f) Nel budget, considera che i bambini piccoli spesso non pagano o pagano meno.\n- Nel "localTips" aggiungi consigli per famiglie con bambini.' : ''}
${inputs.travelerProfile.travelerType?.includes('ragazzi') ? '- Questo viaggio include RAGAZZI (6-17 anni). Suggerisci: avventura, sport acquatici, attrazioni interattive, food tour.\n- Orari più flessibili ma attivi. Includi attività che tengono occupati i ragazzi.\n- Nel budget, i ragazzi spesso hanno tariffe ridotte.' : ''}
${inputs.travelerProfile.travelerType === 'Solo/a' ? '- Il viaggiatore è SOLO. Suggerisci: ostelli sociali (per conoscere gente), free walking tour, attività di gruppo, ristoranti con bancone.\n- Includi esperienze per singoli: tour privati, cooking class, spettacoli.\n- Consiglia alloggi dove è facile socializzare.' : ''}
${inputs.travelerProfile.travelerType === 'Gruppo di amici' ? '- Questo è un viaggio di GRUPPO. Suggerisci: alloggi spaziosi (ville, appartamenti), attività di gruppo, ristoranti per gruppi.\n- Includi serate divertenti: birrerie, locali live, escursioni in gruppo.\n- Il budget per persona può essere inferiore (gruppi = sconti su alloggi e attività).' : ''}
${inputs.travelerProfile.travelerType === 'Viaggio di lavoro' ? '- Questo è un viaggio di BUSINESS. Suggerisci: hotel centrali con WiFi veloce, coworking spaces, ristoranti per meeting.\n- Includi una o due attività leisure compatibili con orari di lavoro.\n- Consiglia bar/caffè con buon WiFi per smart working.' : ''}
${inputs.travelerProfile.interests?.length ? `
REGOLE PER GLI INTERESSI SELEZIONATI:
${inputs.travelerProfile.interests.includes('Cultura') ? '- Cultura: Includi almeno 1 museo/sito storico per giorno. Suggerisci musei meno conosciuti ma imperdibili.' : ''}
${inputs.travelerProfile.interests.includes('Mare') ? '- Mare: Includi attività costiere ogni giorno possibile. Spiagge attrezzate per famiglie o incontaminate per coppie.' : ''}
${inputs.travelerProfile.interests.includes('Food & Wine') ? '- Food & Wine: Includi almeno 1 esperienza culinaria al giorno (food tour, mercato locale, cooking class, ristorante tipico). Suggerisci piatti locali tipici.' : ''}
${inputs.travelerProfile.interests.includes('Natura') ? '- Natura: Includi escursioni, parchi naturali, sentieri. Suggerisci orari migliori per evitare caldo/calore.' : ''}
${inputs.travelerProfile.interests.includes('Sport') ? '- Sport: Includi attività sportive (surf, trekking, ciclismo, diving). Verifica stagionalità.' : ''}
${inputs.travelerProfile.interests.includes('Shopping') ? '- Shopping: Includi mercati locali, outlet, mercatini dell\'usato, negozi artigianali. Suggerisci i migliori per souvenir.' : ''}
${inputs.travelerProfile.interests.includes('Nightlife') ? '- Nightlife: Includi bar, locali live, discoteche, rooftop bar. Suggerisci serate divertenti e zone della vita notturna.' : ''}
${inputs.travelerProfile.interests.includes('Benessere') ? '- Benessere: Includi termi, spa, yoga, massaggi. Suggerisci hotel con wellness center.' : ''}
${inputs.travelerProfile.interests.includes('Foto') ? '- Fotografia: Includi viewpoints, golden hour spots, luoghi instagrammabili. Suggerisci orari migliori per foto.' : ''}
${inputs.travelerProfile.interests.includes('Intrattenimento') ? '- Intrattenimento: Includi spettacoli, concerti, teatro, cinema locale. Suggerisci eventi stagionali.' : ''}
${inputs.travelerProfile.interests.includes('Avventura') ? '- Avventura: Includi sport estremi, escursioni fuoripista, esperienze uniche (parapendio, diving, safari).' : ''}
${inputs.travelerProfile.interests.includes('Storia') ? '- Storia: Includi siti storici, monumenti, musei archeologici, tour guidati storici. Contestualizza con aneddoti.' : ''}
` : ''}
${inputs.travelerProfile.mobility?.includes('Ridotta') || inputs.travelerProfile.mobility?.includes('carrozzina') ? '- MOBILITÀ RIDOTTA/ASSENTE: Suggerisci SOLO attrazioni accessibili (ascensore, rampe, no scale). Evita luoghi con barriere architettoniche.\n- Consiglia hotel con ascensore e camere al piano terra.\n- Nel "localTips" aggiungi info specifiche su accessibilità.' : ''}
${inputs.travelerProfile.familiarity?.includes('già stato') || inputs.travelerProfile.familiarity?.includes('Esperto') ? '- Il viaggiatore CONOSCE GIÀ la destinazione. Evita le attrazioni più ovvie e turistiche.\n- Suggerisci esperienze fuori dai sentieri battuti, quartieri locali, ristoranti nascosti.\n- Nel "localTips" includi consigli per chi vuole vedere cose nuove.' : ''}
` : '';

    let prompt = `
Sei un esperto agente di viaggi con profonda conoscenza locale. Il tuo obiettivo è pianificare un viaggio REALE, FATTIBILE e CONCRETO.
${profileSection}
REGOLE CRITICHE PER VOLI E LOGISTICA:
1. VERIFICA VOLI:
   a) Usa la ricerca web per confermare QUALI COMPAGNIE AEREE operano realmente ogni tratta (es. "chi vola Milano Lisbona", "voli Lisbona Boa Vista compagnie"). Cerca usando i codici IATA: MXP/LIN per Milano, LIS per Lisbona, BVC per Boa Vista, ecc.
   b) NON inventare orari di partenza/arrivo specifici — gli orari cambiano continuamente e non puoi verificarli. Imposta SEMPRE departureTime e arrivalTime a null.
   c) Per "estimatedPrice" usa una stima realistica basata su range storici per quella rotta. Il costo TOTALE dei voli (estimatedPrice × ${totalPeople} persone) NON deve superare il 40% del budget totale (€${inputs.budget}), quindi max €${Math.round(inputs.budget * 0.4)} per tutti i voli. Se le compagnie principali superano questo limite, proponi alternative più economiche (low-cost, scali, date vicine). Se è impossibile restare nel budget segnalalo nel budgetWarning.
   d) Per "bookingUrl" usa il link al sito ufficiale della compagnia aerea che proponi (es. https://www.tap.pt per TAP, https://www.ryanair.com per Ryanair, https://www.easyjet.com per easyJet, ecc.). NON usare Google Flights come bookingUrl.
   e) Imposta "verified": false su tutti i voli — gli orari precisi vanno sempre verificati dal viaggiatore direttamente sul sito della compagnia.
2. STOPOVER PROATTIVI: Se un volo dura più di 8 ore o se c'è un cambio fuso orario importante, inserisci una notte di riposo nella città di scalo.
3. COERENZA DATE E PERNOTTAMENTI: L'itinerario deve coprire esattamente dal ${inputs.startDate} al ${inputs.endDate}. Ogni giorno (tranne l'ultimo se si rientra in giornata) DEVE terminare con un'attività chiamata "Pernottamento: [Nome Hotel]" con il nome reale dell'hotel scelto. Il numero totale di notti deve corrispondere al periodo selezionato.
4. ALLOGGI E TAPPE: Per OGNI tappa del viaggio (inclusi eventuali stopover), DEVI creare un oggetto nell'array "accommodations". Il PRIMO hotel nell'array "options" deve essere lo STESSO hotel indicato nelle attività di "Pernottamento" dell'itinerario per quella tappa. DEVI proporre ALMENO 2 opzioni di alloggio per ogni tappa (idealmente 3), così il viaggiatore può scegliere. DEVI fornire i dettagli completi (nome, tipo, stelle, rating, reviewSummary, estimatedPricePerNight, bookingUrl, address, amenities) per ogni opzione. Assicurati che il numero di notti ("nights") per ogni tappa sia corretto e che la somma totale delle notti coincida con la durata del viaggio.
   LINK UFFICIALE HOTEL (OBBLIGATORIO): Per ogni hotel proposto devi trovare il sito web ufficiale con questa procedura:
   1. Fai una ricerca web con query esatta: "[nome hotel] [città]" (es. "Hotel Danieli Venezia")
   2. Nei risultati Google, il pannello di destra (Knowledge Panel) mostra il sito ufficiale dell'hotel — è il link diretto alla homepage dell'hotel (es. https://www.hoteldanieli.com). Prendi QUELL'URL.
   3. Se il Knowledge Panel non appare o non c'è il link ufficiale, cerca anche "[nome hotel] [città] sito ufficiale" e prendi il primo risultato che è il sito dell'hotel stesso (non Booking, non TripAdvisor).
   4. Inserisci questo URL nel campo "bookingUrl".
   5. CRITICO: Se dopo la ricerca non trovi il sito ufficiale dell'hotel (l'hotel non esiste, è chiuso, o non ha sito), NON inserire quell'hotel. Scegline uno diverso e ripeti la procedura finché trovi un hotel con sito ufficiale verificato.
   TIPOLOGIE ALLOGGIO: Il viaggiatore ha scelto: "${inputs.accommodationType}". Proponi strutture che rientrano ESCLUSIVAMENTE nelle tipologie indicate. Se sono selezionate più tipologie, distribuisci le opzioni tra le categorie scelte.
   QUALITÀ: Proponi SOLO strutture con ottime recensioni (rating minimo 8.0/10 su Booking o 4.2/5 su TripAdvisor). Nel campo "reviewSummary" riporta un estratto reale o rappresentativo delle recensioni dei clienti, evidenziando i punti di forza.
   PREZZO REALE: Per ogni hotel scelto, usa la web search per cercare: "[nome hotel] [città] prezzo ${inputs.startDate} booking.com". Leggi il prezzo che appare nei risultati Google o su Booking.com e usa quello come "estimatedPricePerNight". In alternativa cerca "[nome hotel] [città] booking prezzo ${new Date(inputs.startDate).toLocaleString('it-IT', {month:'long', year:'numeric'})}". Se non trovi un prezzo reale, indica nella descrizione "prezzo da verificare su Booking". Se il prezzo trovato supera il budget, scegli un'alternativa della stessa categoria.
   IMPORTANTE: "estimatedPricePerNight" è il costo TOTALE per notte della camera per TUTTE le ${totalPeople} persone, NON per persona. Deve essere il prezzo REALE trovato su Booking.com per le date indicate, non una stima generica.

🔗 SICUREZZA DEI LINK (OBBLIGATORIO):
Per TUTTI i campi URL nel piano di viaggio (bookingUrl, sourceUrl, url, imageUrl, heroImageUrl), segui queste regole di sicurezza:
- USA SOLO link a siti noti e affidabili. Domini ammessi: booking.com, tripadvisor.it/.com, airbnb.com, hotels.com, expedia.it, agoda.com, hostelworld.com, lonelyplanet.com, rome2rio.com, siti ufficiali di compagnie aeree (tap.pt, ryanair.com, easyjet.com, trenitalia.com, italotreno.it, ecc.), viaggiaresicuri.it, esteri.it, google.com/maps, uber.com, flixbus.it, trainline.eu, skyscanner.it, kayak.it.
- Per gli hotel: il campo "bookingUrl" DEVE essere il link diretto su Booking.com (es. https://www.booking.com/hotel/it/nome-hotel.html) oppure il sito ufficiale dell'hotel SE è un dominio verificato e affidabile. Se non trovi il sito ufficiale, usa il link Booking.com.
- Per le attrazioni e i ristoranti (sourceUrl): usa tripadvisor.it, booking.com/attractions, o il sito ufficiale dell'attrazione SE è un dominio noto e affidabile.
- NON usare MAI: URL shortener (bit.ly, tinyurl, ecc.), link a siti sconosciuti con TLD sospetti (.tk, .ml, .xyz, .top, .buzz, .icu), link HTTP (solo HTTPS), link con IP address, link con parametri di redirect (redirect=, url=, dest=).
- Se non riesci a trovare un link sicuro per una risorsa, lascia il campo URL vuoto (undefined/null) piuttosto che inserire un link dubbio. La sicurezza dell'utente viene PRIMA di avere un link.

DETTAGLI VIAGGIO:
- Partenza: ${inputs.departureCity}${inputs.departureCountry ? ` (${inputs.departureCountry})` : ''}
- Destinazione: ${inputs.destination}${inputs.country ? ` (${inputs.country})` : ''}
- Stopover richiesto: ${inputs.stopover || "Nessuno"}
- Orario preferito: ${inputs.departureTimePreference || "Indifferente"}
- Mezzo di trasporto preferito: ${inputs.flightPreference || "Volo diretto"}
- Tipologie alloggio richieste: ${inputs.accommodationType}
- Budget TOTALE: €${inputs.budget} per ${totalPeople} persone (già moltiplicato per le persone)
- Note: ${inputs.notes || "nessuna"}

REGOLE PER IL MEZZO DI TRASPORTO:
Il viaggiatore ha richiesto: "${inputs.flightPreference || 'Volo diretto'}"

PRIMA DI TUTTO verifica se il mezzo scelto è compatibile con la tratta ${inputs.departureCity} → ${inputs.destination} nei giorni disponibili (${inputs.startDate} - ${inputs.endDate}):
- AUTO PRIVATA: inadatta se la distanza supera ~1.500 km o se richiede attraversamento di oceani/mari non collegati da traghetto. Adatta per destinazioni europee raggiungibili in meno di 15 ore di guida.
- TRENO: inadatto per destinazioni intercontinentali o isole non raggiungibili via ferrovia. Adatto per destinazioni europee con buoni collegamenti ferroviari.
- VOLO DIRETTO: inadatto se non esiste un volo diretto sulla tratta. In tal caso proponi il minimo di scali.
- VOLO ECONOMICO: sempre compatibile, ma segnala se i tempi di percorrenza con scali sono eccessivi.

SE IL MEZZO SCELTO NON È COMPATIBILE:
1. Segnalalo CHIARAMENTE nel campo "budgetWarning" con una spiegazione semplice (es. "Hai scelto l'auto privata ma Milano-Boa Vista richiede attraversamento oceanico — ho usato il volo come alternativa più adatta.")
2. Scegli automaticamente il mezzo più appropriato per quella tratta e usa quello per pianificare il viaggio.

SE IL MEZZO È COMPATIBILE, applica queste regole:
${inputs.flightPreference === 'Auto privata' ? `
- Il viaggio avviene in AUTO PRIVATA.
- Per ogni tratto in auto stima: costo carburante (circa €0.08/km con consumo medio) + pedaggi autostrada reali.
- Inserisci nell'array "flights" i segmenti stradali (airline: "Auto privata", route: "Città A → Città B", estimatedPrice: costo_totale_carburante_e_pedaggi, bookingUrl: link Google Maps del percorso).
` : inputs.flightPreference === 'Treno' ? `
- Il viaggio avviene in TRENO.
- Cerca le tratte ferroviarie reali (Trenitalia, Italo, Renfe, SNCF, Eurostar, ecc.) e proponi il treno più adatto.
- Per "bookingUrl" usa il sito ufficiale della compagnia ferroviaria.
- In caso di attraversamento internazionale, considera Eurostar o treni notte.
` : inputs.flightPreference === 'Volo economico' ? `
- Priorità al COSTO più basso, anche con scali. Cerca le compagnie low-cost che operano la rotta.
` : `
- Priorità a VOLO DIRETTO senza scali. Se non esiste un diretto, spiega nel budgetWarning e proponi il meno scali possibile.
`}
- Una volta a destinazione, se servono trasporti locali (traghetti, bus, taxi, nave), includili nell'itinerario come attività con relativo costo.

REGOLE DI FORMATO (CRITICHE PER EVITARE TRONCAMENTI):
- Brevità ASSOLUTA: ogni stringa di testo MAX 5 parole. Niente frasi complete.
- Attività per giorno: MAX 4 attività (mattina, pranzo, pomeriggio, sera).
- Attrazioni: MAX 3 elementi.
- Ristoranti per tappa: MAX 2 opzioni.
- Hotel per tappa: MAX 1 opzione.
- Voli: MAX 1 opzione per segmento.
- localTips: MAX 3 elementi.
- JSON: SOLO il JSON, zero markdown, zero commenti.

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
        { "airline": "A", "route": "R", "estimatedPrice": 0, "date": "D", "departureTime": "00:00", "arrivalTime": "00:00", "duration": "1h", "bookingUrl": "U", "verified": true }
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
  ],
  "travelHighlights": {
    "whyChosen": "Breve testo entusiastico (2-3 frasi) su perché hai scelto questo itinerario specifico per il viaggiatore, legato al budget, al periodo e alle sue preferenze.",
    "mainStops": [
      { "name": "Nome tappa o città", "reason": "Perché questa tappa è speciale e cosa la rende unica in questo viaggio" }
    ],
    "whyUnforgettable": "2-3 frasi evocative e coinvolgenti su cosa renderà questo viaggio memorabile e irripetibile — emozioni, esperienze, momenti che porterà con sé."
  }
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
      max_tokens: 16000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }] as any,
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

// ─── Country lookup cache ────────────────────────────────────────────────────
// In-memory cache for Nominatim results. Key: lowercase trimmed query.
const countryCache = new Map<string, string[]>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const cacheTimestamps = new Map<string, number>();

// Italian country name mapping (ISO → Italian)
const COUNTRY_IT: Record<string, string> = {
  AF:'Afghanistan',AL:'Albania',DZ:'Algeria',AD:'Andorra',AO:'Angola',AG:'Antigua e Barbuda',
  AR:'Argentina',AM:'Armenia',AU:'Australia',AT:'Austria',AZ:'Azerbaigian',BS:'Bahamas',
  BH:'Bahrein',BD:'Bangladesh',BB:'Barbados',BE:'Belgio',BZ:'Belize',BJ:'Benin',
  BT:'Bhutan',BY:'Bielorussia',MM:'Birmania',BO:'Bolivia',BA:'Bosnia ed Erzegovina',
  BW:'Botswana',BR:'Brasile',BN:'Brunei',BG:'Bulgaria',BF:'Burkina Faso',BI:'Burundi',
  KH:'Cambogia',CM:'Camerun',CA:'Canada',CV:'Capo Verde',CF:'Repubblica Centrafricana',
  TD:'Ciad',CL:'Cile',CN:'Cina',CO:'Colombia',KM:'Comore',CG:'Congo',CD:'Congo (RDC)',
  CR:'Costa Rica',CI:'Costa d\'Avorio',HR:'Croazia',CU:'Cuba',CW:'Curaçao',CY:'Cipro',
  CZ:'Repubblica Ceca',DK:'Danimarca',DJ:'Gibuti',DM:'Dominica',DO:'Repubblica Dominicana',
  EC:'Ecuador',EG:'Egitto',SV:'El Salvador',AE:'Emirati Arabi Uniti',ER:'Eritrea',
  EE:'Estonia',SZ:'eSwatini',ET:'Etiopia',FJ:'Figi',PH:'Filippine',FI:'Finlandia',
  FR:'Francia',GA:'Gabon',GM:'Gambia',GE:'Georgia',DE:'Germania',GH:'Ghana',
  GR:'Grecia',GD:'Grenada',GT:'Guatemala',GN:'Guinea',GW:'Guinea-Bissau',GY:'Guyana',
  HT:'Haiti',HN:'Honduras',HU:'Ungheria',IS:'Islanda',IN:'India',ID:'Indonesia',
  IR:'Iran',IQ:'Iraq',IE:'Irlanda',IL:'Israele',IT:'Italia',JM:'Giamaica',JP:'Giappone',
  JO:'Giordania',KZ:'Kazakistan',KE:'Kenya',KG:'Kirghizistan',KI:'Kiribati',
  KP:'Corea del Nord',KR:'Corea del Sud',KW:'Kuwait',LA:'Laos',LV:'Lettonia',
  LB:'Libano',LS:'Lesotho',LR:'Liberia',LY:'Libia',LI:'Liechtenstein',LT:'Lituania',
  LU:'Lussemburgo',MG:'Madagascar',MW:'Malawi',MY:'Malaysia',MV:'Maldive',ML:'Mali',
  MT:'Malta',MA:'Marocco',MH:'Isole Marshall',MR:'Mauritania',MU:'Mauritius',
  MX:'Messico',FM:'Micronesia',MD:'Moldavia',MC:'Monaco',MN:'Mongolia',ME:'Montenegro',
  MA2:'Marocco',MZ:'Mozambico',NA:'Namibia',NR:'Nauru',NP:'Nepal',NI:'Nicaragua',
  NE:'Niger',NG:'Nigeria',MK:'Macedonia del Nord',NO:'Norvegia',OM:'Oman',NL:'Paesi Bassi',
  NZ:'Nuova Zelanda',PA:'Panamá',PK:'Pakistan',PW:'Palau',PS:'Palestina',PY:'Paraguay',
  PE:'Perù',PG:'Papua Nuova Guinea',PK2:'Pakistan',PL:'Polonia',PT:'Portogallo',
  PR:'Portorico',QA:'Qatar',GB:'Regno Unito',RO:'Romania',RW:'Ruanda',RU:'Russia',
  KN:'Saint Kitts e Nevis',LC:'Saint Lucia',VC:'Saint Vincent e Grenadine',
  WS:'Samoa',SM:'San Marino',ST:'São Tomé e Príncipe',SA:'Arabia Saudita',SN:'Senegal',
  RS:'Serbia',SC:'Seychelles',SL:'Sierra Leone',SG:'Singapore',SK:'Slovacchia',
  SI:'Slovenia',SO:'Somalia',ES:'Spagna',LK:'Sri Lanka',US:'Stati Uniti',SD:'Sudan',
  SS:'Sudan del Sud',SR:'Suriname',SE:'Svezia',CH:'Svizzera',SY:'Siria',
  TJ:'Tagikistan',TW:'Taiwan',TZ:'Tanzania',TH:'Thailandia',TL:'Timor Est',
  TG:'Togo',TO:'Tonga',TT:'Trinidad e Tobago',TN:'Tunisia',TR:'Turchia',
  TM:'Turkmenistan',TV:'Tuvalu',UG:'Uganda',UA:'Ucraina',UY:'Uruguay',UZ:'Uzbekistan',
  VU:'Vanuatu',VA:'Città del Vaticano',VE:'Venezuela',VN:'Vietnam',YE:'Yemen',
  ZM:'Zambia',ZW:'Zimbabwe',EH:'Sahara Occidentale',PS2:'Palestina',
};

function countryNameIT(code: string): string {
  return COUNTRY_IT[code] || code;
}

export const getDestinationCountries = async (destination: string): Promise<string[]> => {
  const key = destination.trim().toLowerCase();

  // Check cache
  const now = Date.now();
  if (countryCache.has(key) && (now - (cacheTimestamps.get(key) ?? 0)) < CACHE_TTL_MS) {
    return countryCache.get(key)!;
  }

  try {
    // Use Nominatim (OpenStreetMap) — free, no API key, instant, no token cost
    const params = new URLSearchParams({
      q: destination.trim(),
      format: 'json',
      limit: '20',
      addressdetails: '1',
      'accept-language': 'it',
    });
    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'LeoWanderTravelApp/1.0' },
    });

    if (!res.ok) {
      console.warn('[getDestinationCountries] Nominatim error:', res.status, await res.text());
      return [];
    }

    const data = await res.json() as Array<{ address?: Record<string, string>; country_code?: string }>;

    // Extract unique country codes, map to Italian names
    const countrySet = new Set<string>();
    for (const item of data) {
      const cc = item.country_code || item.address?.country_code;
      if (cc) {
        countrySet.add(countryNameIT(cc.toUpperCase()));
      }
    }

    const countries = Array.from(countrySet).sort();

    // Cache the result
    countryCache.set(key, countries);
    cacheTimestamps.set(key, now);

    return countries;
  } catch (e) {
    console.error('[getDestinationCountries] Error:', e);
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
