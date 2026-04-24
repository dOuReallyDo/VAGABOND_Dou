# Product Brief — VAGABOND_Dou

## Problem
DIY travel planning requires many sources (reviews, weather, safety, logistics, budget), creating friction and anxiety. **Inoltre, gli strumenti esistenti non conoscono CHI sei** — propongono lo stesso itinerario a un backpacker di 22 anni e a una coppia in luna di miele.

## Solution
VAGABOND_Dou è un **Concierge Digitale Personalizzato**. Oltre a pianificare voli, alloggi e attività (come Vagabond originale), **conosce il tuo profilo** e adatta ogni consiglio a chi sei:

| Profilo | Cosa cambia |
|---------|-------------|
| 🎒 Backpacker 18-25 | Ostelli sociali, street food, free tour, ritmo intenso |
| 💑 Luna di miele | Ristoranti intimi, alberghi con vista, slow pace |
| 👨‍👩‍👧 Famiglia bimbi piccoli | Parchi giochi, orari pisolino, hotel family, indoor backup |
| 🌅 Silver traveler | Accessibilità, terme, relax, hotel con ascensore |
| 💼 Business | Hotel centrali + WiFi, coworking, attività compatibili |

## Target
Families, couples, solo travelers, silver travelers, digital nomads — chiunque voglia un viaggio su misura senza impazzire tra 20 tab del browser.

## Input Form (2-step)

### Step 1 — "Raccontati"
- Fascia d'età
- Chi viaggia (solo, coppia, famiglia, amici, business)
- Interessi (multi-select, max 5)
- Stile di viaggio (slow/equilibrato/intenso)
- Mobilità
- Conoscenza destinazione
- **Quick presets** per compilare in un click

### Step 2 — "Il tuo viaggio"
- Partenza e destinazione (+ nazione auto-disambiguata)
- Stopover opzionale
- Date + flessibilità
- Adulti/bambini con età
- Budget per persona
- Tipologia alloggio (multi-select)
- Mezzo di trasporto
- Note + **suggerimenti cliccabili**

## Output (come Vagabond + personalizzazione)
- Itinerario giornaliero con numero attività basato su `pace`
- Attività filtrate per `interests` e `travelerType`
- Alloggi coerenti con il tipo di viaggio (romantico vs famiglia vs budget)
- Ristoranti adatti al profilo
- Budget breakdown
- Mappe, voli, weather, safety
- **Auto-salvataggio** del viaggio nel profilo

## Auth & Persistence
- Supabase Auth (email + Google)
- Profilo salvato nel DB
- Viaggi salvati e riapribili
- Guest mode con localStorage fallback
- Migrazione automatica guest → auth al primo login

## KPIs
Form completion rate, profile completion, saved trips per user, return visits, time to first plan.