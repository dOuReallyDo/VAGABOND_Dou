import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Star, Trash2, MapPin, Calendar, ChevronRight, ArrowLeft } from 'lucide-react';
import type { SavedTrip } from '../lib/storage';
import { cn } from '../App';

interface SavedTripsProps {
  trips: SavedTrip[];
  onLoad: (trip: SavedTrip) => void;
  onDelete: (tripId: string) => void;
  onToggleFavorite: (tripId: string, isFavorite: boolean) => void;
  onBack: () => void;
}

export function SavedTrips({ trips, onLoad, onDelete, onToggleFavorite, onBack }: SavedTripsProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('it-IT', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="min-h-screen bg-brand-paper p-6 md:p-12">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-full border border-brand-ink/10 flex items-center justify-center hover:bg-brand-ink/5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-3xl font-serif">I miei viaggi</h1>
            <p className="text-sm text-brand-ink/50 mt-1">
              {trips.length} {trips.length === 1 ? 'viaggio salvato' : 'viaggi salvati'}
            </p>
          </div>
        </div>

        {trips.length === 0 ? (
          <div className="text-center py-20">
            <MapPin className="w-12 h-12 text-brand-ink/20 mx-auto mb-4" />
            <h3 className="text-xl font-serif mb-2">Nessun viaggio salvato</h3>
            <p className="text-brand-ink/50 text-sm">
              Pianifica il tuo primo viaggio e lo troverai qui!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {trips.map((trip) => (
                <motion.div
                  key={trip.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  className={cn(
                    'group relative bg-white rounded-2xl border border-brand-ink/5 p-5 hover:shadow-lg transition-all cursor-pointer',
                    trip.is_favorite && 'ring-2 ring-amber-400/30'
                  )}
                  onClick={() => onLoad(trip)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-serif text-lg truncate">{trip.trip_name}</h3>
                      {trip.destination && (
                        <p className="text-sm text-brand-ink/50 flex items-center gap-1 mt-1">
                          <MapPin className="w-3 h-3" /> {trip.destination}
                        </p>
                      )}
                      <p className="text-[10px] text-brand-ink/30 mt-2 flex items-center gap-2">
                        <Calendar className="w-3 h-3" /> {formatDate(trip.created_at)}
                        {trip.inputs?.budget && ` · €${trip.inputs.budget.toLocaleString('it-IT')}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(trip.id, !trip.is_favorite);
                        }}
                        className={cn(
                          'w-9 h-9 rounded-full flex items-center justify-center transition-colors',
                          trip.is_favorite
                            ? 'text-amber-400 bg-amber-50'
                            : 'text-brand-ink/20 hover:text-amber-400 hover:bg-amber-50'
                        )}
                      >
                        <Heart className={cn('w-4 h-4', trip.is_favorite && 'fill-amber-400')} />
                      </button>

                      {deletingId === trip.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(trip.id);
                              setDeletingId(null);
                            }}
                            className="text-xs text-red-500 font-bold px-2 py-1"
                          >
                            Conferma
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingId(null);
                            }}
                            className="text-xs text-brand-ink/40 px-2 py-1"
                          >
                            Annulla
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingId(trip.id);
                          }}
                          className="w-9 h-9 rounded-full flex items-center justify-center text-brand-ink/20 hover:text-red-400 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-ink/20 group-hover:text-brand-accent transition-colors" />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}