# Requisiti di Sviluppo - VAGABOND_Dou

## 📋 Requisiti Minimi di Sistema
- **Node.js**: v20.0.0 o superiore
- **npm**: v10.0.0 o superiore
- **Chiave API Anthropic**: Necessaria per il motore AI (Claude)
- **Progetto Supabase**: Per autenticazione e persistenza dati

## 🛠️ Setup Ambiente di Sviluppo

1. **Clonazione**:
   ```bash
   git clone https://github.com/dOuReallyDo/VAGABOND_Dou.git
   cd VAGABOND_Dou
   ```

2. **Installazione Dipendenze**:
   ```bash
   npm install
   ```

3. **Variabili d'Ambiente**:
   Crea un file `.env` nella root del progetto:
   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

4. **Setup Supabase**:
   - Crea un progetto su [supabase.com](https://supabase.com)
   - Vai in **SQL Editor** ed esegui `supabase/schema.sql`
   - Copia URL e anon key nel `.env`

5. **Avvia**:
   ```bash
   npm run dev
   ```

## 🏗️ Architettura Software

### Pattern
L'applicazione segue un pattern **Client-Side First con Server Proxy**:
- **server.ts**: Express server con Vite middleware in dev, static files in prod
- **travelService.ts**: Gestisce i prompt complessi inviati a Claude Sonnet 4 con web search
- **AuthContext**: Supabase auth con sessione persistente
- **Storage Layer**: Supabase (autenticati) + localStorage (guest fallback)

### Flusso Dati
```
Utente → Profile Form → Travel Form → Claude API (con profilo nel prompt)
                                    ↓
                              TravelPlan JSON
                                    ↓
                    Validazione Zod → UI Rendering
                                    ↓
                    Salvataggio esplicito (Supabase o localStorage fallback)
```

### Auth Pattern
- `persistSession: true` nel client Supabase — sessione scritta e letta da localStorage
- Ogni ricaricamento della pagina ripristina la sessione se l'utente era loggato
- `AuthProvider` usa `onAuthStateChange` come unica fonte di verità; `loading` è costante `false` (mai bloccante)
- La UI è sempre disponibile immediatamente come guest; lo stato loggato arriva in modo asincrono se l'utente fa login nella stessa tab

### Componenti Chiave
| Componente | Responsabilità |
|-----------|---------------|
| `AuthProvider` | Sessione auth, profilo utente — inizializzazione via `onAuthStateChange` (INITIAL_SESSION) |
| `ProfileForm` | Step 1 del form — profilo viaggiatore |
| `TravelForm` | Step 2 del form — dettagli viaggio |
| `SavedTrips` | Lista e gestione viaggi salvati |
| `NoteSuggestions` | Suggerimenti cliccabili per le note |
| `TravelMap` | Mappa Leaflet con marker |

## 🧪 Linee Guida per l'AI

### Prompt Engineering
- I prompt devono restituire **esclusivamente JSON valido**
- Il profilo viaggiatore viene iniettato automaticamente prima delle regole di voli/logistica
- Il campo `pace` controlla il numero di attività per giorno (slow=2-3, equilibrato=3-4, intensa=4-5)
- Il campo `travelerType` personalizza tono e tipo di suggerimenti
- Il campo `interests` attiva regole specifiche per ogni interesse selezionato
- Il campo `mobility` filtra attrazioni accessibili
- Il campo `familiarity` evita proposte già viste

### Modelli AI
| Task | Modello | Max Tokens |
|------|---------|-----------|
| Generazione piano | `claude-sonnet-4-6` | 16000 |
| Disambiguazione destinazione | `claude-haiku-4-5` | 256 |
| Recensioni alloggi | `claude-haiku-4-5` | 1024 |

## 📦 Database Schema

Vedere `supabase/schema.sql` per il DDL completo.

### Tabella `profiles`
Collegata a `auth.users` tramite `id`. Contiene: `age_range`, `traveler_type`, `interests[]`, `pace`, `mobility`, `familiarity`. Row Level Security abilitata.

### Tabella `saved_trips`
Contiene: `trip_name`, `destination`, `inputs` (JSONB), `plan` (JSONB), `is_favorite`. RLS abilitata — ogni utente vede solo i propri viaggi.

## 🚀 Deploy

### Vercel
Il progetto è predisposto per Vercel:
1. Connetti il repo GitHub
2. Aggiungi le env vars nel dashboard Vercel
3. Il build command è `npm run build`
4. L'output directory è `dist`

### Variabili d'ambiente richieste in produzione
- `ANTHROPIC_API_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GOOGLE_SAFE_BROWSING_API_KEY` (opzionale, ma raccomandata — attiva verifica URL via API)
- `VITE_UNSPLASH_ACCESS_KEY` (opzionale — attiva immagini correlate alla destinazione)