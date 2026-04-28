# VAGABOND_Dou — Travel Planner AI

Fork di [Vagabond AI](https://github.com/dOuReallyDo/Vagabond) con profilo viaggiatore, autenticazione e viaggi salvati.

## 🚀 Novità rispetto a Vagabond

- **🧑 Profilo Viaggiatore**: Età, tipo di viaggio, interessi, stile, mobilità, conoscenza destinazione — tutto personalizzabile con quick presets
- **🔐 Autenticazione**: Login/Signup con email + Google OAuth via Supabase
- **💾 Viaggi Salvati**: Ogni piano viene salvato automaticamente. Ritorna e ritrova tutto
- **🎭 Quick Presets**: "Digital Nomad", "Luna di Miele", "Backpacker", "Silver Traveler" — un click per compilare il profilo
- **💡 Note Intelligenti**: Suggerimenti cliccabili per arricchire le note del viaggio
- **🧠 Prompt Enrichment**: Il profilo viaggiatore viene iniettato nel prompt Claude per itinerari ultra-personalizzati
- **📱 localStorage Fallback**: Funziona anche senza login (profilo e viaggi salvati localmente)
- **🔒 URL Safety**: 3-layer protection per tutti i link — whitelist, structural validation, Google Safe Browsing API

## ✨ Caratteristiche Principali (ereditate)
- **Itinerari Dinamici**: Generazione di piani giornalieri dettagliati
- **Mappe Interattive**: Integrazione con Leaflet/OpenStreetMap
- **Ricerca Real-Time**: Claude AI con web search per link reali
- **Visual Experience**: Immagini dinamiche per ogni tappa
- **Budget Intelligence**: Breakdown automatico dei costi
- **Seasonal Awareness**: Suggerimenti basati sul periodo

## 🔒 Sicurezza degli URL

Il sistema implementa una protezione a 3 livelli per tutti i link generati dall'AI:

1. **Prompt-level**: Claude riceve istruzioni esplicite di usare solo domini fidati
2. **Post-processing**: `sanitizeTravelPlanAsync()` verifica ogni URL — i domini whitelist passano, gli URL strutturalmente sospetti (IP, shortener, TLD sospetti, HTTP, redirect params) vengono sostituiti con alternative sicure (Booking.com, TripAdvisor, Google Maps). I domini sconosciuti ma strutturalmente validi vengono verificati in batch via Safe Browsing API: se l'API conferma sicuri, l'URL originale viene **mantenuto** (es. siti ufficiali hotel).
3. **Google Safe Browsing API**: gli URL su domini sconosciuti vengono verificati contro il database malware/phishing di Google in batch. Se l'API dice safe → l'URL originale è mantenuto. Se unsafe → rimpiazzato.

Politica: gli URL non sicuri vengono **rimossi e sostituiti**, mai mostrati con avvisi.

## 🛠️ Tech Stack

| Layer | Tecnologia |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Tailwind CSS v4 |
| **Animazioni** | Framer Motion |
| **Icone** | Lucide React |
| **AI** | Anthropic Claude (Sonnet 4 + Haiku) con web search |
| **Auth & DB** | Supabase (PostgreSQL + RLS + Auth) |
| **Maps** | Leaflet + OpenStreetMap |
| **Build** | Vite |
| **Deploy** | Vercel |

## 📦 Struttura del Progetto

```
src/
├── App.tsx                    # Main app con 2-step form + auth
├── main.tsx                   # Entry point (AuthProvider wrapper)
├── shared/
│   └── contract.ts            # Zod schemas (TravelInputs + TravelPlan)
├── services/
│   └── travelService.ts       # Claude AI API + prompt enrichment
├── components/
│   ├── AuthForm.tsx            # Login/Signup UI
│   ├── ProfileForm.tsx         # Profilo viaggiatore (età, interessi, stile)
│   ├── SavedTrips.tsx          # Lista viaggi salvati
│   ├── TravelMap.tsx           # Leaflet map component
│   └── NoteSuggestions.tsx      # Clickable note suggestions
├── lib/
│   ├── auth.tsx                # Auth context + hooks (Supabase)
│   ├── storage.ts              # Profile + trips CRUD (Supabase + localStorage)
│   ├── supabase.ts             # Supabase client
│   ├── urlSafety.ts            # URL whitelist, validation, sanitization
│   └── safeBrowsing.ts         # Google Safe Browsing API client + cache
supabase/
└── schema.sql                  # DB schema (profiles, saved_trips)
```

## 🔧 Setup

### 1. Installazione

```bash
git clone https://github.com/dOuReallyDo/VAGABOND_Dou.git
cd VAGABOND_Dou
npm install
```

### 2. Variabili d'ambiente

Crea un file `.env` nella root:

```env
ANTHROPIC_API_KEY=sk-ant-...
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
GOOGLE_SAFE_BROWSING_API_KEY=your-key
```

### 3. Supabase Setup

1. Crea un progetto su [supabase.com](https://supabase.com)
2. Vai in **SQL Editor** ed esegui il contenuto di `supabase/schema.sql`
3. Copia **Project URL** e **anon public key** in `.env`

### 4. Avvia in locale

```bash
npm run dev
```

L'app sarà disponibile su `http://localhost:3000`

## 🔐 Autenticazione

- **Email + Password**: Registrazione e login standard
- **Google OAuth**: Login rapido con account Google (richiede configurazione in Supabase Dashboard)
- **Guest Mode**: Funziona senza login — profilo e viaggi salvati in localStorage
- **Migrazione**: Al primo login, i dati localStorage vengono migrati su Supabase

### Flusso User Menu (loggati)

Dal menu in alto a destra (avatar + email):
- **🎭 Il mio profilo viaggiatore** → Modal con ProfileForm (solo "Salva" + "Annulla"), salva su Supabase `profiles`
- **📍 I miei viaggi** → Vista saved trips da Supabase (ricaricata ad ogni apertura)
- **🔑 Cambia password** → Modal con nuova password + conferma, usa `supabase.auth.updateUser()`
- **🚪 Logout** → `signOut()` + reset immediato dello stato React + `supabase.auth.signOut()`

### Persistenza Sessione
- **Nessuna persistenza**: `persistSession: false` nel client Supabase — ogni apertura/ricaricamento della pagina parte come guest
- Il login è richiesto ad ogni sessione; non ci sono stati a metà o token scaduti da recuperare
- La sessione è in-memory per la durata della tab; il token viene refreshato automaticamente da Supabase durante la sessione

## 🧑 Profilo Viaggiatore

Il profilo include:
- Fascia d'età (18-25, 26-35, 36-45, 46-55, 56-65, 65+)
- Tipo di viaggio (Solo/a, Coppia romantica, Famiglia, Gruppo amici, Business)
- Interessi (Cultura, Mare, Food & Wine, Natura, Sport, Shopping, Nightlife, Benessere, Foto, Avventura)
- Stile di viaggio (Slow & relax, Equilibrato, Avventura intensa)
- Mobilità (Nessuna limitazione, Ridotta, A carrozzina)
- Conoscenza destinazione (Mai stato qui, Ci sono già stato, Esperto)

## 📄 Licenza

Fork di Vagabond AI — vedere il repo originale per la licenza.