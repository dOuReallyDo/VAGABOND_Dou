import React from 'react';

// =============================================
// Note Suggestions — clickable pill suggestions for the notes field
// =============================================

const NOTE_SUGGESTIONS = [
  'Voglio evitare le zone turistiche',
  'Cibo locale autentico',
  'Adatto a bambini',
  'Niente musei',
  'Mi piace l\'arte contemporanea',
  'Cerco spiagge incontaminate',
  'Preferisco ristoranti dove mangiano i locali',
  'Voglio fare escursioni nella natura',
  'Mi interessa la vita notturna',
  'Cerco relax assoluto',
  'Vorrei vedere mercati locali',
  'Ho bisogno di hotel con piscina',
  'Voglio visitare siti storici poco conosciuti',
  'Cerco esperienze di volunteering',
  'Mi piace lo street food',
  'Vorrei una giornata di spa/benessere',
];

interface NoteSuggestionsProps {
  selectedNotes: string;
  onChange: (notes: string) => void;
}

export function NoteSuggestions({ selectedNotes, onChange }: NoteSuggestionsProps) {
  const addSuggestion = (suggestion: string) => {
    if (selectedNotes.includes(suggestion)) return;
    const newNotes = selectedNotes
      ? `${selectedNotes}, ${suggestion}`
      : suggestion;
    onChange(newNotes);
  };

  return (
    <div className="mt-3">
      <p className="text-[10px] uppercase tracking-widest font-bold text-brand-ink/30 mb-2">
        💡 Suggerimenti — clicca per aggiungere
      </p>
      <div className="flex flex-wrap gap-1.5">
        {NOTE_SUGGESTIONS.map((s) => {
          const alreadyAdded = selectedNotes.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => addSuggestion(s)}
              disabled={alreadyAdded}
              className={`px-2.5 py-1 rounded-full text-[11px] border transition-all ${
                alreadyAdded
                  ? 'bg-brand-accent/10 text-brand-accent/60 border-brand-accent/20 cursor-default'
                  : 'bg-transparent text-brand-ink/40 border-brand-ink/10 hover:border-brand-accent hover:text-brand-accent cursor-pointer'
              }`}
            >
              {alreadyAdded ? '✓ ' : ''}{s}
            </button>
          );
        })}
      </div>
    </div>
  );
}