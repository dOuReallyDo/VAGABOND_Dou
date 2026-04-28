/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Euro, MapPin, Calendar, Home, MessageSquare, Plane, Hotel,
  Sun, ShieldCheck, ArrowRight, Plus, Minus, Loader2, Star,
  CheckCircle2, AlertTriangle, ChevronRight, ExternalLink, Utensils,
  Clock, Lightbulb, Smartphone, Train, Download, Search, Car,
  User as UserIcon, LogOut, KeyRound, ChevronDown, X
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as XLSX from 'xlsx';
import { generateTravelPlan, summarizeAccommodationReviews, getDestinationCountries, type TravelInputs } from './services/travelService';
import { TravelMap } from './components/TravelMap';
import { useAuth } from './lib/auth';
import { loadProfile, saveProfile, loadTrips, saveTrip, deleteTrip, toggleFavorite, migrateLocalTripsToSupabase, type SavedTrip } from './lib/storage';
import { sanitizeTravelPlanAsync } from './lib/urlSafety';
import { searchUnsplashImage } from './services/unsplashService';
import { AuthForm } from './components/AuthForm';
import { supabase } from './lib/supabase';
import { ProfileForm, type TravelerProfileForm } from './components/ProfileForm';
import { SavedTrips } from './components/SavedTrips';
import { NoteSuggestions } from './components/NoteSuggestions';
import 'leaflet/dist/leaflet.css';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


// Load local personal travel photos from immagini/ folder via Vite glob import
const localHeroImages = import.meta.glob<string>(
  '../immagini/*.{jpeg,jpg,png,webp,JPEG,JPG,PNG,WEBP}',
  { eager: true, as: 'url' }
);
const localHeroImageUrls = Object.values(localHeroImages) as string[];

// Fallback Unsplash hero images (used only if no local images found)
const HERO_IMAGES = [
  'https://images.unsplash.com/photo-1506929562872-bb4215037d4e?w=1080&h=1920&fit=crop',  // sunset ocean
  'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5ed?w=1080&h=1920&fit=crop',  // tropical water
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1080&h=1920&fit=crop',  // beach
  'https://images.unsplash.com/photo-1519046904884-53103b34b206?w=1080&h=1920&fit=crop',  // coastline
  'https://images.unsplash.com/photo-1520250495-b2c75c2b4a64?w=1080&h=1920&fit=crop',  // mountain lake
  'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1080&h=1920&fit=crop',  // japan temple
  'https://images.unsplash.com/photo-1500530855697-baf8e57e1740?w=1080&h=1920&fit=crop',  // colorful houses
  'https://images.unsplash.com/photo-1504280390367-36f21b29e293?w=1080&h=1920&fit=crop',  // mountain sunset
];

// Pick one hero image: prefer local photos, fallback to Unsplash
const getHeroImage = (seed: number) => {
  const pool = localHeroImageUrls.length > 0 ? localHeroImageUrls : HERO_IMAGES;
  return pool[seed % pool.length];
};

// Immagine da Unsplash (priorità), AI-provided URL, o fallback picsum
const getImageUrl = (item: any, keyword: string, unsplashMap?: Map<string, string>) => {
  // 1. Se abbiamo una immagine Unsplash coerente, usala
  const kw = keyword.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (unsplashMap) {
    // Try exact match first, then progressively shorter prefixes
    for (const tryKey of [kw, kw.split(' ').slice(0, 3).join(' '), kw.split(' ').slice(0, 2).join(' ')]) {
      if (unsplashMap.has(tryKey)) {
        return unsplashMap.get(tryKey)!;
      }
    }
  }
  // 2. Se l'IA ha fornito un URL immagine che sembra valido, proviamo a usarlo
  const imageUrl = item?.imageUrl || item?.heroImageUrl;
  if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
    const url = imageUrl.trim();
    // Blacklist di domini che spesso non permettono hotlinking o non sono immagini dirette
    const bad = ['google.com/imgres', 'instagram.com', 'pinterest.com', 'flickr.com/photos', 'facebook.com'];
    if (!bad.some((b) => url.includes(b))) return url;
  }

  // 3. Fallback to picsum.photos with keyword-based seed for consistent beautiful images
  const seed = kw.replace(/[^a-z0-9]/g, '').trim().slice(0, 60);
  return `https://picsum.photos/seed/${seed}/800/600`;
};

// Get destination-coherent image from Unsplash only (returns null if not found)
const getUnsplashOnly = (keyword: string, unsplashMap?: Map<string, string>): string | null => {
  if (!unsplashMap) return null;
  const kw = keyword.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  for (const tryKey of [kw, kw.split(' ').slice(0, 3).join(' '), kw.split(' ').slice(0, 2).join(' ')]) {
    if (unsplashMap.has(tryKey)) {
      return unsplashMap.get(tryKey)!;
    }
  }
  return null;
};

const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>, hideOnFail = false) => {
  const target = e.target as HTMLImageElement;
  if (hideOnFail) {
    // For Unsplash-only images: hide the container instead of showing random picsum
    target.style.display = 'none';
    const parent = target.parentElement;
    if (parent) parent.style.display = 'none';
    return;
  }
  if (!target.dataset.fallback) {
    target.dataset.fallback = '1';
    const randomSeed = Math.random().toString(36).slice(2, 10);
    target.src = `https://picsum.photos/seed/${randomSeed}/800/600`;
  }
};

// Link sicuri: fallback a Google Search, mai 404
const getBookingUrl = (hotelName: string, city: string, startDate: string, endDate: string, people: { adults: number, children: { age: number }[] }) => {
  const checkin = startDate;
  const checkout = endDate;
  const adults = people.adults;
  const children = people.children.length;
  const ages = people.children.map(c => `&age=${c.age}`).join('');
  
  return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotelName + ' ' + city)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}&group_children=${children}${ages}&selected_currency=EUR`;
};

const getBookingPlatformUrls = (hotelName: string, city: string, checkin: string, checkout: string, people: { adults: number, children: { age: number }[] }) => {
  const adults = people.adults;
  const children = people.children.length;
  const ages = people.children.map(c => `&age=${c.age}`).join('');
  const q = encodeURIComponent(hotelName + ' ' + city);
  return {
    booking: `https://www.booking.com/searchresults.html?ss=${q}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}&group_children=${children}${ages}&selected_currency=EUR`,
    expedia: `https://www.expedia.it/Hotel-Search?destination=${q}&startDate=${checkin}&endDate=${checkout}&adults=${adults}&children=${children}`,
    airbnb: `https://www.airbnb.it/s/${encodeURIComponent(city)}/homes?checkin=${checkin}&checkout=${checkout}&adults=${adults}&children=${children}`,
  };
};

const getSafeLink = (url: string | undefined, name: string, destination?: string): string => {
  // Se è un pernottamento, forziamo la ricerca per trovare l'hotel specifico
  if (name.toLowerCase().includes('pernottamento')) {
    const query = destination ? `${name} ${destination}` : name;
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }

  if (url && typeof url === 'string' && url.startsWith('http')) {
    const trusted = [
      'wikipedia.org', 'tripadvisor', 'booking.com', 'expedia', 'viator', 'lonelyplanet', 'google.com', 'wikimedia',
      'ryanair.com', 'easyjet.com', 'ita-airways.com', 'lufthansa.com', 'emirates.com', 'qatarairways.com', 
      'delta.com', 'united.com', 'aa.com', 'airfrance.com', 'klm.com', 'flytap.com', 'vueling.com', 'wizzair.com',
      'britishairways.com', 'turkishairlines.com', 'swiss.com', 'austrian.com', 'brusselsairlines.com'
    ];
    if (trusted.some((t) => url.toLowerCase().includes(t))) return url;
  }
  const query = destination ? `${name} ${destination}` : name;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
};

// ─── LOADING SCREEN ─────────────────────────────────────────────────────────

const LOADING_TIPS = [
  'Consultando orari voli e tariffe reali...',
  'Verificando disponibilità alloggi...',
  'Componendo il programma giorno per giorno...',
  'Cercando ristoranti e attrazioni locali...',
  'Calcolando il budget di viaggio...',
  'Raccogliendo consigli pratici di viaggio...',
  'Ottimizzando percorsi e trasferimenti...',
  'Quasi pronto — sto rifinendo i dettagli...',
];

function LoadingScreen({ step, progress }: { step: string; progress: number }) {
  const startTimeRef = useRef(0);
  if (startTimeRef.current === 0) startTimeRef.current = Date.now();
  const [elapsed, setElapsed] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(progress);
  const [tipIndex, setTipIndex] = useState(0);
  const [globeIndex, setGlobeIndex] = useState(0);
  const GLOBES = ['🌍', '🌎', '🌏'];

  // Rotazione globo ogni 300ms
  useEffect(() => {
    const interval = setInterval(() => {
      setGlobeIndex(i => (i + 1) % 3);
    }, 300);
    return () => clearInterval(interval);
  }, []);

  // Contatore secondi trascorsi
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Rotazione messaggi ogni 4s
  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex(i => (i + 1) % LOADING_TIPS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Avanza la barra lentamente tra 45% e 80% mentre l'API risponde
  useEffect(() => {
    if (progress > displayProgress) {
      setDisplayProgress(progress);
      return;
    }
    if (progress === 45 && displayProgress < 80) {
      const timeout = setTimeout(() => {
        setDisplayProgress(prev => Math.min(prev + 0.4, 80));
      }, 700);
      return () => clearTimeout(timeout);
    }
  }, [progress, displayProgress]);

  const estimatedTotal = 90; // secondi stimati totali
  const remaining = Math.max(0, estimatedTotal - elapsed);
  const remainingMin = Math.floor(remaining / 60);
  const remainingSec = remaining % 60;
  const timeLabel = remaining > 60
    ? `~${remainingMin} min ${remainingSec}s`
    : remaining > 0
      ? `~${remainingSec}s`
      : 'Quasi finito...';

  return (
    <div className="min-h-screen bg-brand-paper flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full text-center"
      >
        {/* Animazione centrale */}
        <div className="relative w-32 h-32 mx-auto mb-10">
          <div className="absolute inset-0 rounded-full border-4 border-brand-accent/20 animate-pulse" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand-accent animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center text-5xl">
            {GLOBES[globeIndex]}
          </div>
        </div>

        {/* Fase corrente (dal service) */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35 }}
          >
            <h2 className="text-2xl mb-1">{step || 'Pianifico il tuo viaggio...'}</h2>
          </motion.div>
        </AnimatePresence>

        {/* Messaggio rotativo */}
        <AnimatePresence mode="wait">
          <motion.p
            key={tipIndex}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="text-brand-ink/50 text-sm font-sans italic mb-8 h-5"
          >
            {LOADING_TIPS[tipIndex]}
          </motion.p>
        </AnimatePresence>

        {/* Barra di avanzamento */}
        <div className="w-full bg-brand-ink/5 h-3 rounded-full overflow-hidden mb-3 relative">
          <motion.div
            className="absolute inset-y-0 left-0 bg-brand-accent rounded-full"
            animate={{ width: `${displayProgress}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-brand-ink/40 mb-8">
          <span>{Math.round(displayProgress)}%</span>
          <span className="tabular-nums">{timeLabel}</span>
        </div>

        {/* Step visivi */}
        <div className="flex items-center justify-center gap-2 text-xs text-brand-ink/40 font-sans mb-8">
          {['Analisi', 'Ricerca', 'Composizione', 'Pronto'].map((label, i) => {
            const thresholds = [10, 30, 45, 85];
            const active = displayProgress >= thresholds[i];
            return (
              <React.Fragment key={label}>
                <div className={cn('flex flex-col items-center gap-1 transition-all', active ? 'text-brand-accent font-bold' : '')}>
                  <div className={cn('w-2.5 h-2.5 rounded-full border-2 transition-all',
                    active ? 'bg-brand-accent border-brand-accent' : 'border-brand-ink/20'
                  )} />
                  <span>{label}</span>
                </div>
                {i < 3 && <div className={cn('w-8 h-0.5 mb-4 transition-all', active ? 'bg-brand-accent/40' : 'bg-brand-ink/10')} />}
              </React.Fragment>
            );
          })}
        </div>

        <div className="flex justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
              className="w-2 h-2 bg-brand-accent rounded-full"
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ─── STAR RATING ─────────────────────────────────────────────────────────────

function StarRating({ value }: { value: number }) {
  const normalized = Math.min(5, value > 5 ? value / 2 : value);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn('w-3 h-3', i <= Math.round(normalized) ? 'fill-amber-400 text-amber-400' : 'text-gray-200')}
        />
      ))}
      <span className="text-xs text-gray-500 ml-1">{value}</span>
    </div>
  );
}

// ─── CARD IMMAGINE CON LINK VERIFICATO ───────────────────────────────────────

interface ImageCardProps {
  item: any;
  imageKeyword: string;
  href: string;
  children: React.ReactNode;
  className?: string;
}

function ImageCard({ item, imageKeyword, href, children, className }: ImageCardProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('group block bg-white rounded-3xl shadow-sm border border-brand-ink/5 hover:shadow-lg transition-all duration-300 overflow-hidden', className)}
    >
      <div className="h-52 overflow-hidden relative">
        <img
          src={getImageUrl(item, imageKeyword)}
          alt={imageKeyword}
          onError={handleImageError}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg text-[10px] font-bold text-brand-accent flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ExternalLink className="w-2.5 h-2.5" /> Apri
        </div>
      </div>
      {children}
    </a>
  );
}

// ─── BADGE CATEGORIA ─────────────────────────────────────────────────────────

function Badge({ children, color = 'default' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    default: 'bg-brand-ink/5 text-brand-ink/60',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <span className={cn('text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md', colors[color] || colors.default)}>
      {children}
    </span>
  );
}

function AccommodationReviewer({ stops, inputs, onAdd }: { stops: any[]; inputs: any; onAdd?: (hotel: any, stopIndex: number) => void }) {
  const [name, setName] = useState('');
  const [stopIndex, setStopIndex] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || stopIndex === undefined) return;
    
    const selectedStop = stops[stopIndex];
    if (!selectedStop) return;

    // Calcola le date per la tappa specifica
    let currentOffset = 0;
    for (let i = 0; i < stopIndex; i++) {
      currentOffset += stops[i].nights || 0;
    }
    
    const start = new Date(inputs.startDate);
    const stopStart = new Date(start);
    stopStart.setDate(start.getDate() + currentOffset);
    
    const stopEnd = new Date(stopStart);
    stopEnd.setDate(stopStart.getDate() + (selectedStop.nights || 1));

    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await summarizeAccommodationReviews(
        name, 
        selectedStop.stopName,
        formatDate(stopStart),
        formatDate(stopEnd),
        inputs.people
      );
      
      if (data.exists === false) {
        setError(`L'alloggio "${name}" non sembra esistere a ${selectedStop.stopName}. Per favore verifica il nome o la tappa.`);
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message || "Errore durante la ricerca delle recensioni.");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    if (onAdd && result && stopIndex !== undefined) {
      onAdd({
        name: name,
        type: "Hotel",
        stars: 4,
        rating: 8.5,
        reviewSummary: result.summary,
        pros: result.pros,
        cons: result.cons,
        estimatedPricePerNight: result.estimatedPricePerNight || 100,
        bookingUrl: result.bookingUrl || `https://www.google.com/search?q=booking+${encodeURIComponent(name)}+${encodeURIComponent(stops[stopIndex].stopName)}`,
        address: stops[stopIndex].stopName,
        amenities: []
      }, stopIndex);
      setResult(null);
      setName('');
    }
  };

  return (
    <div className="glass p-8 rounded-[2rem] mt-12 print:hidden">
      <h3 className="text-2xl mb-4 flex items-center gap-2">
        <Search className="w-5 h-5 text-brand-accent" /> Seleziona un nuovo alloggio
      </h3>
      <p className="text-sm text-brand-ink/60 mb-6">
        Inserisci il nome di un alloggio e seleziona la tappa per verificare se esiste e leggere le recensioni.
      </p>
      <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4 mb-6">
        <input
          type="text"
          placeholder="Nome alloggio (es. Hilton)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 bg-white border border-brand-ink/10 rounded-xl px-4 py-3 text-sm focus:border-brand-accent outline-none"
          required
        />
        <select
          value={stopIndex}
          onChange={(e) => setStopIndex(parseInt(e.target.value))}
          className="flex-1 bg-white border border-brand-ink/10 rounded-xl px-4 py-3 text-sm focus:border-brand-accent outline-none appearance-none cursor-pointer"
          required
        >
          {stops.map((stop, idx) => (
            <option key={idx} value={idx}>
              {stop.stopName}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading}
          className="bg-brand-accent text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-brand-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Verifica
        </button>
      </form>

      {error && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border border-red-100 p-4 rounded-xl flex items-start gap-3 mb-6"
        >
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{error}</p>
        </motion.div>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl p-6 border border-brand-ink/5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <h4 className="font-bold text-brand-ink">Alloggio trovato a {stops[stopIndex].stopName}</h4>
          </div>
          <p className="text-sm leading-relaxed mb-6">{result.summary}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-3">Punti di forza</h4>
              <ul className="space-y-2">
                {(result.pros || []).map((pro: string, i: number) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <Plus className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> {pro}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-red-600 mb-3">Punti deboli</h4>
              <ul className="space-y-2">
                {(result.cons || []).map((con: string, i: number) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <Minus className="w-4 h-4 text-red-500 shrink-0 mt-0.5" /> {con}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="border-t border-brand-ink/5 pt-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-brand-ink/40 mb-3">Cerca su</h4>
              <div className="flex flex-wrap gap-3">
                <a
                  href={inputs ? getBookingUrl(name, stops[stopIndex].stopName, inputs.startDate, inputs.endDate, inputs.people) : `https://www.google.com/search?q=booking+${encodeURIComponent(name)}+${encodeURIComponent(stops[stopIndex].stopName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs bg-brand-ink/5 hover:bg-brand-ink/10 px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors"
                >
                  Booking.com <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={`https://www.google.com/search?q=tripadvisor+${encodeURIComponent(name)}+${encodeURIComponent(stops[stopIndex].stopName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs bg-brand-ink/5 hover:bg-brand-ink/10 px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors"
                >
                  TripAdvisor <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            {onAdd && (
              <button
                onClick={handleAdd}
                className="bg-brand-accent text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-brand-accent/90 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Aggiungi alla tappa
              </button>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ─── RESULTS VIEW ─────────────────────────────────────────────────────────────

function ResultsView({ plan, inputs, onReset, onShowTrips, onModify, onUpdatePlan, onShowAuth, planJustSaved, onPlanJustSavedAck, onTripSaved }: { plan: any; inputs: any; onReset: () => void; onShowTrips: () => void; onModify: (request: string) => void; onUpdatePlan: (plan: any) => void; onShowAuth: () => void; planJustSaved?: boolean; onPlanJustSavedAck?: () => void; onTripSaved?: () => void }) {
  const { user, profile, signOut } = useAuth();
  const [modifyText, setModifyText] = useState("");
  const [selectedAccommodations, setSelectedAccommodations] = useState<Record<number, any>>({});
  const [accommodationNights, setAccommodationNights] = useState<Record<number, number>>({});
  const [selectedFlights, setSelectedFlights] = useState<Record<number, any>>({});
  const [expandedDays, setExpandedDays] = useState<Record<number, boolean>>({ 0: true });
  const [hotelsExpanded, setHotelsExpanded] = useState(false);
  const [restaurantsExpanded, setRestaurantsExpanded] = useState(false);
  const [openBookingMenu, setOpenBookingMenu] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Unsplash images: preload destination-coherent images ──────────────
  const [unsplashImages, setUnsplashImages] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    const loadImages = async () => {
      const newMap = new Map<string, string>();
      const destination = plan.destinationOverview?.title || inputs?.destination || 'travel';
      const country = inputs?.country || plan.destinationOverview?.country || '';

      // Keywords to search: hero, attractions, notable activities
      const keywords: string[] = [];

      // Hero image
      keywords.push(`${destination} ${country} landscape`.trim());

      // Attractions
      for (const attr of (plan.destinationOverview?.attractions || []).slice(0, 6)) {
        if (attr.name) keywords.push(`${attr.name} ${destination}`);
      }

      // Notable itinerary activities (skip generic ones)
      const GENERIC = ['check out', 'checkout', 'check-in', 'check in', 'checkin', 'colazione', 'partenza', 'riposo', 'tempo libero', 'notte in', 'pernottamento'];
      for (const day of (plan.itinerary || []).slice(0, 5)) {
        for (const act of (day.activities || []).slice(0, 4)) {
          const text = ((act.name || '') + ' ' + (act.description || '')).toLowerCase();
          if (GENERIC.some(kw => text.includes(kw))) continue;
          if (act.name && act.name.length > 3) {
            const loc = act.location || destination;
            keywords.push(`${act.name} ${loc}`);
          }
        }
      }

      // Batch search with stagger (max 15 queries to respect rate limits)
      const uniqueKeywords = [...new Set(keywords)].slice(0, 15);
      for (let i = 0; i < uniqueKeywords.length; i++) {
        if (cancelled) return;
        // Stagger: 300ms between requests
        if (i > 0) await new Promise(r => setTimeout(r, 300));
        const kw = uniqueKeywords[i];
        const url = await searchUnsplashImage(kw, 'landscape');
        if (url) {
          newMap.set(kw.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(), url);
        }
      }

      if (!cancelled) setUnsplashImages(newMap);
    };
    loadImages();
    return () => { cancelled = true; };
  }, [plan?.destinationOverview?.title, inputs?.destination]);

  // Chiudi il menu di prenotazione quando si clicca fuori
  useEffect(() => {
    if (!openBookingMenu) return;
    const handler = () => setOpenBookingMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openBookingMenu]);

  // Chiudi il menu utente quando si clicca fuori
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = () => setUserMenuOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [userMenuOpen]);

  // Mostra feedback "Salvato!" quando App segnala che il salvataggio è avvenuto (auto-save o post-login)
  useEffect(() => {
    if (planJustSaved) {
      setSavedFeedback('saved');
      setTimeout(() => setSavedFeedback('idle'), 3000);
      onPlanJustSavedAck?.();
    }
  }, [planJustSaved]);

  const handleSaveToTrips = async () => {
    if (!user) {
      // Persisti piano + inputs prima del redirect OAuth (sopravvive al reload)
      try {
        sessionStorage.setItem('vagabond_pending_plan', JSON.stringify({ plan, inputs }));
      } catch (_) {}
      onShowAuth();
      return;
    }
    // Evita doppio salvataggio se già in corso o già completato
    if (savedFeedback === 'saving' || savedFeedback === 'saved') return;
    setSavedFeedback('saving');
    setSaveError(null);
    try {
      const tripName = plan.destinationOverview?.title || inputs?.destination || 'Viaggio';
      const payload = {
        trip_name: tripName,
        destination: inputs?.destination || '',
        inputs,
        plan,
        is_favorite: false,
      };
      // Diagnostic: log payload size
      const payloadSize = new Blob([JSON.stringify(payload)]).size;
      console.log('[SaveTrip] Payload size:', (payloadSize / 1024).toFixed(1), 'KB');
      await saveTrip(payload, user.id);
      setSavedFeedback('saved');
      // Notify parent to reload saved trips list
      onTripSaved?.();
      // Mantiene "Salvato!" permanentemente — non torna a idle così non si può ri-cliccare
    } catch (err) {
      console.error('Save trip error:', err);
      const msg = err instanceof Error ? err.message : 'Errore durante il salvataggio';
      setSaveError(msg);
      setSavedFeedback('error');
      setTimeout(() => { setSavedFeedback('idle'); setSaveError(null); }, 4000);
    }
  };

  // Hero: usa destination + country come keyword per immagini più coerenti
  const heroKeyword = [inputs?.destination, inputs?.country].filter(Boolean).join(',') || plan.destinationOverview?.title || 'travel';
  const heroUrl = getImageUrl(plan.destinationOverview, heroKeyword + ',landscape,city', unsplashImages);

  // Inizializza le notti e le selezioni con i valori suggeriti dal piano
  useEffect(() => {
    if (plan?.accommodations) {
      const initialNights: Record<number, number> = {};
      const initialAccommodations: Record<number, any> = {};
      plan.accommodations.forEach((stop: any, i: number) => {
        initialNights[i] = stop.nights || 1;
        if (stop.options && stop.options.length > 0) {
          initialAccommodations[i] = stop.options[0];
        }
      });
      setAccommodationNights(initialNights);
      setSelectedAccommodations(initialAccommodations);
    }
    if (plan?.flights) {
      const initialFlights: Record<number, any> = {};
      plan.flights.forEach((segment: any, i: number) => {
        if (segment.options && segment.options.length > 0) {
          initialFlights[i] = segment.options[0];
        }
      });
      setSelectedFlights(initialFlights);
    }
  }, [plan]);

  // Costruisci mapPoints aggregando tutti i punti con coordinate valide
  const allMapPoints = [
    ...(plan.mapPoints || []),
    ...(plan.destinationOverview?.attractions || []).map((a: any) => ({
      lat: a.lat, lng: a.lng, label: a.name, type: 'attraction'
    })),
    ...(plan.accommodations || []).flatMap((s: any) =>
      (s.options || []).map((h: any) => ({ lat: h.lat, lng: h.lng, label: h.name, type: 'hotel' }))
    ),
    ...(plan.bestRestaurants || []).flatMap((s: any) =>
      (s.options || [s]).map((r: any) => ({ lat: r.lat, lng: r.lng, label: r.name, type: 'restaurant' }))
    ),
  ].filter((p: any) => p.lat && p.lng && p.lat !== 0 && p.lng !== 0 && !isNaN(p.lat) && !isNaN(p.lng));

  const handleSaveItinerary = async () => {
    const element = document.getElementById('pdf-content');
    if (!element) return;

    try {
      // Clone the document to modify it for saving
      const clone = document.documentElement.cloneNode(true) as HTMLElement;

      // Remove scripts to prevent React hydration issues when opening the static HTML
      const scripts = clone.querySelectorAll('script');
      scripts.forEach(s => s.remove());

      // Remove UI elements that shouldn't be in the saved file (like buttons)
      const hiddenElements = clone.querySelectorAll('.print\\:hidden');
      hiddenElements.forEach(e => e.remove());

      // Espandi tutti i giorni dell'itinerario nel clone (rimuovi display:none inline da framer-motion)
      const dayContents = clone.querySelectorAll('[data-day-content]');
      dayContents.forEach((el: Element) => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.display = 'block';
        htmlEl.style.height = 'auto';
        htmlEl.style.opacity = '1';
        // Aggiorna anche l'icona nel header corrispondente
        const dayIndex = htmlEl.getAttribute('data-day-content');
        if (dayIndex !== null) {
          const header = clone.querySelector(`[data-day-header="${dayIndex}"]`);
          if (header) {
            const iconContainer = header.querySelector('.toggle-icon-container') as HTMLElement | null;
            if (iconContainer) {
              iconContainer.style.backgroundColor = '#5a5a40';
              iconContainer.style.borderColor = '#5a5a40';
              iconContainer.style.color = 'white';
              iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';
            }
          }
        }
      });

      // Inline tutti i CSS esterni per rendere il file auto-contenuto
      const liveLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];
      const cloneLinks = Array.from(clone.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];

      await Promise.all(liveLinks.map(async (liveLink, i) => {
        const cloneLink = cloneLinks[i];
        if (!cloneLink) return;
        try {
          const res = await fetch(liveLink.href);
          if (res.ok) {
            const cssText = await res.text();
            const style = document.createElement('style');
            style.textContent = cssText;
            cloneLink.parentNode?.replaceChild(style, cloneLink);
          }
        } catch {
          // Se il fetch fallisce (es. Google Fonts), lascia il link originale con URL assoluto
          cloneLink.href = liveLink.href;
        }
      }));

      // Aggiungi script per toggle manuale dei giorni nel file salvato
      const toggleScript = `
<script>
  document.addEventListener('click', function(e) {
    const header = e.target.closest('[data-day-header]');
    if (header) {
      const dayIndex = header.getAttribute('data-day-header');
      const content = document.querySelector('[data-day-content="' + dayIndex + '"]');
      const iconContainer = header.querySelector('.toggle-icon-container');

      if (content) {
        const isHidden = content.style.display === 'none' || content.style.height === '0px' || content.style.opacity === '0';
        if (isHidden) {
          content.style.display = 'block';
          content.style.height = 'auto';
          content.style.opacity = '1';
          header.classList.add('is-expanded');
          if (iconContainer) {
            iconContainer.style.backgroundColor = '#5a5a40';
            iconContainer.style.borderColor = '#5a5a40';
            iconContainer.style.color = 'white';
            iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-minus w-5 h-5"><path d="M5 12h14"/></svg>';
          }
        } else {
          content.style.display = 'none';
          content.style.height = '0px';
          content.style.opacity = '0';
          header.classList.remove('is-expanded');
          if (iconContainer) {
            iconContainer.style.backgroundColor = 'transparent';
            iconContainer.style.borderColor = 'rgba(26, 26, 26, 0.1)';
            iconContainer.style.color = 'inherit';
            iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus w-5 h-5"><path d="M12 5v14M5 12h14"/></svg>';
          }
        }
      }
    }
  });
</script>
`;
      const htmlContent = "<!DOCTYPE html>\n" + clone.outerHTML + toggleScript;

      // Create a Blob and trigger download
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `itinerario-${plan.destinationOverview?.title?.toLowerCase().replace(/\s+/g, '-') || 'viaggio'}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error saving HTML:', error);
      alert('Si è verificato un errore durante il salvataggio dell\'itinerario. Riprova.');
    }
  };

  const totalActivitiesCost = (plan.itinerary || []).reduce((sum: number, day: any) => {
    return sum + (day.activities || []).reduce((daySum: number, act: any) => {
      return daySum + ((act.costEstimate || 0) * (inputs.people.adults + inputs.people.children.length));
    }, 0);
  }, 0);

  const totalAccommodationsCost = Object.entries(selectedAccommodations).reduce((sum: number, [stopIndex, hotel]: [string, any]) => {
    const nights = accommodationNights[parseInt(stopIndex)] || 1;
    return sum + (hotel.estimatedPricePerNight * nights);
  }, 0);

  const totalFlightCost = Object.values(selectedFlights).reduce((sum: number, flight: any) => {
    return sum + (flight.estimatedPrice * (inputs.people.adults + inputs.people.children.length));
  }, 0);

  const totalCost = totalActivitiesCost + totalAccommodationsCost + totalFlightCost;

  const handleExportExcel = () => {
    try {
      const numPeople = inputs.people.adults + inputs.people.children.length;
      const rows: any[] = [];

      // Aggiungi le righe dell'itinerario
      plan.itinerary?.forEach((day: any) => {
        rows.push({
          'Data / Ora': `Giorno ${day.day} - ${day.title}`,
          'Luogo': '',
          'Attività': '',
          'Durata': '',
          'Costo Stimato': '',
          'Note Costo': ''
        });

        day.activities?.forEach((act: any) => {
          const actTotal = (act.costEstimate || 0) * numPeople;
          rows.push({
            'Data / Ora': act.time,
            'Luogo': act.location || '-',
            'Attività': act.name || act.description,
            'Durata': act.duration || '-',
            'Costo Stimato': act.costEstimate ? actTotal : 0,
            'Note Costo': act.costEstimate ? `€${act.costEstimate} x ${numPeople} pers.` : 'Gratis / N.D.'
          });
        });
      });

      // Aggiungi i voli selezionati — una riga sola con il totale
      const flightValues = Object.values(selectedFlights) as any[];
      if (flightValues.length > 0) {
        const totalFlightPrice = flightValues.reduce((s: number, f: any) => s + f.estimatedPrice, 0);
        const routes = flightValues.map((f: any) => f.route).join(' → ');
        const airlines = [...new Set(flightValues.map((f: any) => f.airline))].join(', ');
        rows.push({
          'Data / Ora': 'Voli',
          'Luogo': airlines,
          'Attività': routes,
          'Durata': '-',
          'Costo Stimato': totalFlightPrice * numPeople,
          'Note Costo': `€${totalFlightPrice} x ${numPeople} pers.`
        });
      }

      // Aggiungi gli alloggi selezionati
      if (Object.keys(selectedAccommodations).length > 0) {
        rows.push({
          'Data / Ora': 'Alloggi Selezionati',
          'Luogo': '',
          'Attività': '',
          'Durata': '',
          'Costo Stimato': '',
          'Note Costo': ''
        });

        Object.entries(selectedAccommodations).forEach(([stopIndex, hotel]: [string, any]) => {
          const nights = accommodationNights[parseInt(stopIndex)] || 1;
          rows.push({
            'Data / Ora': '-',
            'Luogo': plan.accommodations[parseInt(stopIndex)]?.stopName || '-',
            'Attività': hotel.name,
            'Durata': `${nights} ${nights === 1 ? 'notte' : 'notti'}`,
            'Costo Stimato': hotel.estimatedPricePerNight * nights,
            'Note Costo': `€${hotel.estimatedPricePerNight}/notte`
          });
        });
      }

      // Aggiungi il totale
      rows.push({
        'Data / Ora': '',
        'Luogo': '',
        'Attività': '',
        'Durata': 'Totale Stimato:',
        'Costo Stimato': totalCost,
        'Note Costo': ''
      });

      // Crea il foglio di lavoro e la cartella di lavoro
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Itinerario");

      // Imposta la larghezza delle colonne
      const wscols = [
        { wch: 25 }, // Data / Ora
        { wch: 20 }, // Luogo
        { wch: 50 }, // Attività
        { wch: 15 }, // Durata
        { wch: 15 }, // Costo Stimato
        { wch: 25 }  // Note Costo
      ];
      worksheet['!cols'] = wscols;

      // Salva il file
      XLSX.writeFile(workbook, `itinerario-${plan.destinationOverview?.title?.toLowerCase().replace(/\s+/g, '-') || 'viaggio'}.xlsx`);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      alert('Si è verificato un errore durante l\'esportazione in Excel. Riprova.');
    }
  };

  return (
    <div className="min-h-screen bg-brand-paper pb-24" id="pdf-content">

      {/* TOP BAR — sticky, visibile anche nella pagina itinerario */}
      <div className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-brand-ink/5 print:hidden">
        <div className="max-w-7xl mx-auto px-6 flex justify-between items-center py-2 gap-4">
          {/* Sinistra */}
          <button
            onClick={onReset}
            className="flex items-center gap-2 text-sm text-brand-ink/70 hover:text-brand-ink transition-colors px-3 py-1.5 rounded-lg hover:bg-brand-ink/5"
          >
            <ArrowRight className="rotate-180 w-4 h-4" /> Nuova ricerca
          </button>

          {/* Destra */}
          <div className="flex items-center gap-2">
            {/* Salva nei miei viaggi */}
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={handleSaveToTrips}
                disabled={savedFeedback === 'saving' || savedFeedback === 'saved'}
                className={`flex items-center gap-2 text-sm px-4 py-1.5 rounded-full font-medium transition-all shadow-sm ${
                  savedFeedback === 'saved'
                    ? 'bg-green-500 text-white'
                    : savedFeedback === 'error'
                    ? 'bg-red-500 text-white'
                    : 'bg-brand-accent text-white hover:bg-brand-accent/90'
                }`}
              >
                {savedFeedback === 'saved' ? (
                  <><CheckCircle2 className="w-4 h-4" /> Salvato!</>
                ) : savedFeedback === 'saving' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Salvataggio...</>
                ) : savedFeedback === 'error' ? (
                  <><AlertTriangle className="w-4 h-4" /> Errore — Riprova</>
                ) : (
                  <><Download className="w-4 h-4" /> Salva Itinerario</>
                )}
              </button>
              {savedFeedback === 'error' && saveError && (
                <span className="text-xs text-red-500 max-w-[200px] text-right">{saveError}</span>
              )}
            </div>

            {/* Scarica HTML */}
            <button
              onClick={handleSaveItinerary}
              title="Scarica come file"
              className="flex items-center gap-1.5 text-sm text-brand-ink/50 hover:text-brand-ink transition-colors px-2 py-1.5 rounded-lg hover:bg-brand-ink/5"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* User menu */}
            {user ? (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setUserMenuOpen(!userMenuOpen); }}
                  className="flex items-center gap-2 text-sm text-brand-ink/70 hover:text-brand-ink transition-colors px-3 py-1.5 rounded-lg hover:bg-brand-ink/5"
                >
                  <div className="w-7 h-7 bg-brand-accent/20 rounded-full flex items-center justify-center text-brand-accent text-xs font-bold">
                    {(user.email || 'U')[0].toUpperCase()}
                  </div>
                  <span className="hidden md:inline max-w-[140px] truncate">{profile?.display_name || user.email}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-lg border border-brand-ink/5 py-1 overflow-hidden z-50">
                    <div className="px-4 py-2 border-b border-brand-ink/5">
                      <p className="text-xs text-brand-ink/40 truncate">{user.email}</p>
                    </div>
                    <button
                      onClick={() => { setUserMenuOpen(false); onShowTrips(); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-brand-ink/70 hover:bg-brand-ink/5 hover:text-brand-ink transition-colors flex items-center gap-2"
                    >
                      <MapPin className="w-4 h-4" /> I miei viaggi
                    </button>
                    <div className="border-t border-brand-ink/5">
                      <button
                        onClick={async () => { setUserMenuOpen(false); await signOut(); onReset(); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2"
                      >
                        <LogOut className="w-4 h-4" /> Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={onShowAuth}
                className="flex items-center gap-1.5 text-sm text-brand-ink/50 hover:text-brand-accent transition-colors px-3 py-1.5 rounded-lg hover:bg-brand-accent/5"
              >
                <Users className="w-4 h-4" /> Accedi
              </button>
            )}
          </div>
        </div>
      </div>

      {/* HERO */}
      <section className="relative h-[85vh] print:h-auto print:min-h-[300px] overflow-hidden">
        <img
          src={heroUrl}
          alt={plan.destinationOverview?.title}
          onError={handleImageError}
          className="absolute inset-0 w-full h-full object-cover print:relative print:max-h-[300px]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-brand-paper print:hidden" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/20 to-transparent print:hidden" />

        <div className="absolute inset-0 flex flex-col justify-end p-8 md:p-16 lg:p-24 print:relative print:p-8 print:bg-white">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl">
            {plan.destinationOverview?.tagline && (
              <p className="text-white/70 print:text-brand-ink/70 text-sm font-sans uppercase tracking-[0.2em] mb-3">
                {plan.destinationOverview.tagline}
              </p>
            )}
            <h1 className="text-7xl md:text-[7rem] text-white print:text-brand-ink leading-none drop-shadow-lg print:drop-shadow-none">
              {plan.destinationOverview?.title}
            </h1>
          </motion.div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6 pt-0">

        {/* INTRO — descrizione viaggio */}
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-10 -mt-10 relative z-10 bg-white rounded-[2rem] shadow-lg p-8 md:p-12"
        >
          <p className="text-xs uppercase tracking-widest text-brand-accent font-bold mb-4">Il tuo viaggio</p>

          {/* Descrizione principale */}
          <p className="text-2xl md:text-3xl font-serif leading-snug text-brand-ink mb-8">
            {plan.destinationOverview?.description}
          </p>

          {plan.travelHighlights && (
            <>
              {/* Perché questo itinerario */}
              {plan.travelHighlights.whyChosen && (
                <p className="text-brand-ink/70 leading-relaxed mb-8 text-base md:text-lg">
                  {plan.travelHighlights.whyChosen}
                </p>
              )}

              {/* Tappe principali */}
              {plan.travelHighlights.mainStops?.length > 0 && (
                <div className="mb-8">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-brand-ink/40 mb-4">Le tappe del viaggio</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {plan.travelHighlights.mainStops.map((stop: any, i: number) => (
                      <div key={i} className="flex gap-3 bg-brand-ink/3 rounded-2xl p-4">
                        <div className="w-7 h-7 rounded-full bg-brand-accent/10 text-brand-accent text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </div>
                        <div>
                          <p className="font-semibold text-brand-ink text-sm mb-0.5">{stop.name}</p>
                          <p className="text-brand-ink/60 text-sm leading-relaxed">{stop.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Perché indimenticabile */}
              {plan.travelHighlights.whyUnforgettable && (
                <div className="border-l-4 border-brand-accent pl-5">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-brand-accent mb-2">Perché sarà indimenticabile</p>
                  <p className="font-serif italic text-lg text-brand-ink/80 leading-relaxed">
                    {plan.travelHighlights.whyUnforgettable}
                  </p>
                </div>
              )}
            </>
          )}
        </motion.section>

        {/* BUDGET WARNING */}
        {plan.budgetWarning && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12 bg-amber-50 border-2 border-amber-200 p-8 rounded-[2rem] flex items-start gap-5 shadow-sm"
          >
            <div className="p-3 bg-amber-100 rounded-2xl shrink-0">
              <AlertTriangle className="w-6 h-6 text-amber-700" />
            </div>
            <div>
              <h3 className="text-xl font-serif mb-2 text-amber-900">Nota sul budget</h3>
              <p className="text-amber-800 leading-relaxed">{plan.budgetWarning}</p>
            </div>
          </motion.div>
        )}

        {/* ATTRAZIONI */}
        <section className="mb-20">
          <h2 className="text-5xl mb-2">Da vedere</h2>
          <p className="text-brand-ink/50 mb-8 font-sans text-sm">Le attrazioni imperdibili della destinazione</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {(plan.destinationOverview?.attractions || []).map((attr: any, i: number) => (
              <motion.a
                key={i}
                href={getSafeLink(attr.sourceUrl, attr.name)}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="group relative bg-white border border-brand-ink/5 overflow-hidden rounded-3xl shadow-sm block hover:shadow-md transition-shadow"
              >
                {(() => {
                  const attrImgKey = `${attr.name} ${plan.destinationOverview?.title || inputs?.destination || ''}`;
                  const attrImg = getUnsplashOnly(attrImgKey, unsplashImages);
                  return attrImg ? (
                    <div className="h-40 overflow-hidden">
                      <img
                        src={attrImg}
                        alt={attr.name}
                        onError={(e) => handleImageError(e, true)}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        loading="lazy"
                      />
                    </div>
                  ) : null;
                })()}
                <div className="flex flex-col h-full p-6">
                  {attr.category && (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-brand-ink/40 mb-2">{attr.category}</span>
                  )}
                  <h3 className="text-2xl text-brand-ink mb-2 leading-tight group-hover:text-brand-accent transition-colors">
                    {attr.name}
                  </h3>
                  <p className="text-brand-ink/70 text-sm leading-relaxed flex-grow">{attr.description}</p>
                  {attr.estimatedVisitTime && (
                    <div className="mt-4 flex items-center gap-1.5 text-brand-ink/50 text-xs">
                      <Clock className="w-3 h-3" /> {attr.estimatedVisitTime}
                    </div>
                  )}
                  <div className="mt-4 flex items-center gap-1.5 text-[10px] text-brand-accent font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                    <ExternalLink className="w-3 h-3" /> Scopri di più
                  </div>
                </div>
              </motion.a>
            ))}
          </div>
        </section>

        {/* METEO + SICUREZZA */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-20">
          {/* Meteo */}
          <div className="glass p-8 rounded-[2rem] lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-50 rounded-2xl">
                  <Sun className="text-amber-500 w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-3xl">Meteo e stagione</h2>
                  {plan.weatherInfo?.averageTemp && (
                    <p className="text-brand-ink/40 text-sm">{plan.weatherInfo.averageTemp} in media</p>
                  )}
                </div>
              </div>
              <a 
                href={`https://www.google.com/search?q=site:climaeviaggi.it+${encodeURIComponent(plan.destinationOverview?.country || inputs?.destination || plan.destinationOverview?.title || '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-600 bg-amber-50 px-4 py-2 rounded-full hover:bg-amber-100 transition-colors"
              >
                Clima e Viaggi <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-brand-ink/80 leading-relaxed mb-6">{plan.weatherInfo?.summary}</p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-emerald-50 p-4 rounded-2xl">
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 block mb-2">Punti di forza</span>
                <p className="text-sm text-emerald-900 leading-relaxed">{plan.weatherInfo?.pros}</p>
              </div>
              <div className="bg-amber-50 p-4 rounded-2xl">
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 block mb-2">Da tenere a mente</span>
                <p className="text-sm text-amber-900 leading-relaxed">{plan.weatherInfo?.cons}</p>
              </div>
            </div>
            {plan.weatherInfo?.packingTips && (
              <div className="bg-blue-50 p-4 rounded-2xl">
                <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 block mb-2">Cosa mettere in valigia</span>
                <p className="text-sm text-blue-900 leading-relaxed">{plan.weatherInfo.packingTips}</p>
              </div>
            )}
          </div>

          {/* Sicurezza */}
          <div className="glass p-8 rounded-[2rem]">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-50 rounded-2xl">
                  <ShieldCheck className="text-emerald-600 w-6 h-6" />
                </div>
                <h2 className="text-3xl">Sicurezza</h2>
              </div>
              <a 
                href={`https://www.google.com/search?q=site:viaggiaresicuri.it+${encodeURIComponent(plan.destinationOverview?.country || inputs?.destination || plan.destinationOverview?.title || '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-4 py-2 rounded-full hover:bg-emerald-100 transition-colors"
              >
                Viaggiare Sicuri <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            {plan.safetyAndHealth?.safetyLevel && (
              <div className="mb-4">
                <Badge color={plan.safetyAndHealth.safetyLevel === 'Alto' ? 'green' : plan.safetyAndHealth.safetyLevel === 'Basso' ? 'red' : 'amber'}>
                  Livello {plan.safetyAndHealth.safetyLevel}
                </Badge>
              </div>
            )}
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-ink/40 mb-1">Avvertenze</p>
                <p className="text-brand-ink/80 leading-relaxed">{plan.safetyAndHealth?.safetyWarnings}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-ink/40 mb-1">Vaccinazioni</p>
                <p className="text-brand-ink/80 leading-relaxed">{plan.safetyAndHealth?.vaccinationsRequired}</p>
              </div>
              {plan.safetyAndHealth?.emergencyNumbers && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-ink/40 mb-1">Numeri utili</p>
                  <p className="text-brand-ink/80 leading-relaxed">{plan.safetyAndHealth.emergencyNumbers}</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* BUDGET BREAKDOWN */}
        <section className="glass p-8 md:p-12 rounded-[2rem] mb-20">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-brand-accent/10 rounded-2xl">
              <Euro className="text-brand-accent w-6 h-6" />
            </div>
            <div>
              <h2 className="text-4xl">Budget stimato</h2>
              <p className="text-brand-ink/40 text-sm">Stime basate sui prezzi medi del periodo</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            {[
              { label: 'Voli', icon: Plane, key: 'flights', color: 'bg-blue-50 text-blue-600' },
              { label: 'Alloggi', icon: Hotel, key: 'accommodation', color: 'bg-purple-50 text-purple-600' },
              { label: 'Attività', icon: MapPin, key: 'activities', color: 'bg-green-50 text-green-600' },
              { label: 'Cibo', icon: Utensils, key: 'food', color: 'bg-orange-50 text-orange-600' },
              { label: 'Trasporti', icon: Train, key: 'transport', color: 'bg-cyan-50 text-cyan-600' },
              { label: 'Extra', icon: Euro, key: 'misc', color: 'bg-gray-50 text-gray-600' },
            ].map((item) => (
              <div key={item.key} className={cn('p-5 rounded-2xl text-center', item.color.split(' ')[0])}>
                <item.icon className={cn('w-5 h-5 mx-auto mb-2', item.color.split(' ')[1])} />
                <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                <p className="text-xl font-bold text-gray-800">€{plan.budgetBreakdown?.[item.key] ?? '—'}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-6 border-t border-brand-ink/10">
            <span className="text-2xl font-serif italic text-brand-ink/60">Totale stimato</span>
            <div className="text-right">
              <span className="text-4xl font-bold text-brand-accent">€{plan.budgetBreakdown?.totalEstimated}</span>
              {plan.budgetBreakdown?.perPersonPerDay && (
                <p className="text-xs text-brand-ink/40 mt-1">≈ €{plan.budgetBreakdown.perPersonPerDay} / persona / giorno</p>
              )}
            </div>
          </div>
        </section>

        {/* ITINERARIO */}
        <section className="mb-20">
          <h2 className="text-5xl mb-2">Il tuo itinerario</h2>
          <p className="text-brand-ink/50 mb-12 font-sans text-sm">Ogni giornata pensata per vivere la destinazione in modo autentico</p>

          <div className="space-y-6">
            {(plan.itinerary || []).map((day: any, i: number) => {
              const isExpanded = expandedDays[i];
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-white rounded-[2rem] border border-brand-ink/5 overflow-hidden shadow-sm hover:shadow-md transition-all"
                >
                  {/* Header cliccabile */}
                  <div 
                    onClick={() => setExpandedDays(prev => ({ ...prev, [i]: !prev[i] }))}
                    data-day-header={i}
                    className="p-6 md:p-8 cursor-pointer flex items-center justify-between group"
                  >
                    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6">
                      <div className="flex items-center gap-3">
                        <span className="w-10 h-10 rounded-full bg-brand-accent/10 text-brand-accent flex items-center justify-center text-sm font-bold shrink-0">
                          {day.day}
                        </span>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-brand-ink/40">Giorno</span>
                          <h3 className="text-xl md:text-2xl font-serif leading-tight">{day.title}</h3>
                        </div>
                      </div>
                      {day.theme && (
                        <div className="md:ml-4">
                          <Badge color="blue">{day.theme}</Badge>
                        </div>
                      )}
                    </div>
                    <div className={cn(
                      "w-10 h-10 rounded-full border border-brand-ink/10 flex items-center justify-center transition-all group-hover:border-brand-accent group-hover:bg-brand-accent/5 toggle-icon-container",
                      isExpanded && "bg-brand-accent border-brand-accent text-white group-hover:bg-brand-accent group-hover:text-white"
                    )}>
                      {isExpanded ? <Minus className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                    </div>
                  </div>

                  {/* Contenuto espandibile */}
                  <motion.div
                    initial={false}
                    animate={{ 
                      height: isExpanded ? 'auto' : 0, 
                      opacity: isExpanded ? 1 : 0,
                      display: isExpanded ? 'block' : 'none'
                    }}
                    data-day-content={i}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="px-6 pb-8 md:px-8 md:pb-10 border-t border-brand-ink/5 pt-8">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {(day.activities || []).map((act: any, j: number) => {
                              const searchDestination = act.location || plan.destinationOverview?.title || inputs?.destination;
                              const actText = ((act.name || '') + ' ' + (act.description || '')).toLowerCase();
                              const isPernottamento = actText.includes('pernottamento');
                              const GENERIC_KEYWORDS = ['check out', 'checkout', 'check-in', 'check in', 'checkin', 'colazione', 'partenza', 'riposo', 'tempo libero', 'notte in'];
                              const isGeneric = !isPernottamento && GENERIC_KEYWORDS.some(kw => actText.includes(kw));
                              const ROUTE_KEYWORDS = ['tragitto', 'trasferimento', 'transfer in auto', 'transfer in treno', 'in treno da', 'in auto da', 'viaggio in treno', 'viaggio in auto'];
                              const isRoute = !isGeneric && !isPernottamento && ROUTE_KEYWORDS.some(kw => actText.includes(kw));
                              const hotelName = isPernottamento
                                ? (act.name || '').replace(/^pernottamento:\s*/i, '').trim()
                                : '';
                              const bookingLink = (() => {
                                if (!isPernottamento || !hotelName) return null;
                                // Solo sito ufficiale dalle accommodations — nessun fallback a Booking.com
                                for (const stop of (plan.accommodations || [])) {
                                  for (const opt of (stop.options || [])) {
                                    if (opt.name?.trim().toLowerCase() === hotelName.toLowerCase() && opt.bookingUrl) {
                                      return opt.bookingUrl;
                                    }
                                  }
                                }
                                return null;
                              })();
                              const mapsLink = isRoute
                                ? `https://www.google.com/maps/dir/${encodeURIComponent(act.location || searchDestination || '')}`
                                : null;
                              const webSearchLink = !isGeneric && !isRoute && !isPernottamento
                                ? `https://www.google.com/search?q=${encodeURIComponent((act.name || act.description || '') + (act.location ? ' ' + act.location : ' ' + (plan.destinationOverview?.title || inputs?.destination || '')))}`
                                : null;
                              const cardLink = isGeneric ? undefined : (bookingLink || mapsLink || webSearchLink || undefined);
                              const CardTag = cardLink ? 'a' : 'div';
                              const cardProps = cardLink ? { href: cardLink, target: '_blank', rel: 'noopener noreferrer' } : {};
                              // Unsplash image for this activity (only if found)
                              const actImageKey = !isGeneric && !isRoute && act.name && act.name.length > 3
                                ? `${act.name} ${act.location || plan.destinationOverview?.title || inputs?.destination || ''}`
                                : null;
                              const actImageUrl = actImageKey ? getUnsplashOnly(actImageKey, unsplashImages) : null;
                              return (
                              <CardTag
                                key={j}
                                {...cardProps}
                                className={cn(
                                  "group bg-brand-paper/30 rounded-3xl border p-6 transition-all block",
                                  cardLink ? "hover:shadow-md" : "",
                                  act.name?.toLowerCase().includes('pernottamento')
                                    ? "border-brand-accent/20 bg-brand-accent/5"
                                    : "border-brand-ink/5"
                                )}
                              >
                                {actImageUrl && (
                                  <div className="-mx-6 -mt-6 mb-4 rounded-t-3xl overflow-hidden h-40">
                                    <img
                                      src={actImageUrl}
                                      alt={act.name || ''}
                                      onError={(e) => handleImageError(e, true)}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                    />
                                  </div>
                                )}
                                <div className="flex items-start justify-between mb-3">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono bg-white px-2 py-0.5 rounded-md text-brand-ink/60 shadow-sm">{act.time}</span>
                                    {act.duration && (
                                      <span className="text-xs text-brand-ink/40 flex items-center gap-1">
                                        <Clock className="w-3 h-3" /> {act.duration}
                                      </span>
                                    )}
                                  </div>
                                  {act.name?.toLowerCase().includes('pernottamento') && (
                                    <Hotel className="w-4 h-4 text-brand-accent" />
                                  )}
                                  {act.costEstimate !== undefined && !act.name?.toLowerCase().includes('pernottamento') && (
                                    <span className="text-sm font-bold text-brand-accent">
                                      {act.costEstimate === 0
                                        ? (act.description?.toLowerCase().includes('vedi costo nella sezione voli') || act.tips?.toLowerCase().includes('vedi costo nella sezione voli')
                                          ? 'Vedi sezione voli'
                                          : null)
                                        : `€${act.costEstimate}`}
                                    </span>
                                  )}
                                </div>
                                {act.name && <h4 className={cn(
                                  "text-lg font-serif mb-2 leading-tight",
                                  cardLink ? "group-hover:text-brand-accent transition-colors" : "",
                                  act.name?.toLowerCase().includes('pernottamento') && "text-brand-accent"
                                )}>{act.name}</h4>}
                                {act.location && (
                                  <p className="text-xs text-brand-accent mb-2 flex items-center gap-1 font-medium">
                                    <MapPin className="w-3 h-3" /> {act.location}
                                  </p>
                                )}
                                <p className="text-brand-ink/70 text-sm leading-relaxed">{act.description}</p>

                                {(act.transport || act.travelTime) && (
                                  <div className="mt-4 pt-4 border-t border-brand-ink/5 flex flex-wrap gap-3">
                                    {act.transport && (
                                      <div className="flex items-center gap-1.5 text-xs text-brand-ink/50">
                                        <Train className="w-3.5 h-3.5" /> {act.transport}
                                      </div>
                                    )}
                                    {act.travelTime && (
                                      <div className="flex items-center gap-1.5 text-xs text-brand-ink/50">
                                        <Clock className="w-3.5 h-3.5" /> {act.travelTime}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {act.tips && (
                                  <div className="mt-3 flex items-start gap-2 bg-amber-50 p-3 rounded-xl">
                                    <Lightbulb className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-800 leading-relaxed">{act.tips}</p>
                                  </div>
                                )}
                                {cardLink && (
                                  <div className="mt-4 flex items-center gap-1.5 text-[10px] text-brand-accent font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                                    <ExternalLink className="w-3 h-3" /> {isRoute ? 'Apri su Google Maps' : 'Verifica sul web'}
                                  </div>
                                )}
                              </CardTag>
                              );
                            })}
                          </div>
                        </div>
                      </motion.div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* MAPPA INTERATTIVA */}
        {allMapPoints.length > 0 && (
          <section className="mb-20">
            <h2 className="text-5xl mb-2">Mappa dell'itinerario</h2>
            <p className="text-brand-ink/50 mb-8 font-sans text-sm">
              {allMapPoints.length} punti di interesse — la linea tratteggiata mostra il percorso suggerito
            </p>
            <div className="rounded-[2rem] overflow-hidden shadow-xl border border-brand-ink/5">
              <TravelMap points={allMapPoints} destination={plan.destinationOverview?.title || ''} />
            </div>
          </section>
        )}

        {/* VOLI */}
        <section className="mb-20">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <h2 className="text-4xl mb-2 flex items-center gap-3">
                <Plane className="w-7 h-7" /> Mezzo di Trasporto
              </h2>
              <p className="text-brand-ink/50 font-sans text-sm">Prezzi indicativi — verifica disponibilità e orari sui siti ufficiali</p>
            </div>
            <a
              href={`https://www.google.com/flights?q=flights+from+${encodeURIComponent(inputs?.departureCity || '')}+to+${encodeURIComponent(inputs?.destination || plan.destinationOverview?.title || '')}+on+${inputs?.startDate || ''}+return+${inputs?.endDate || ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-blue-50 text-blue-600 px-6 py-3 rounded-full font-bold text-sm hover:bg-blue-100 transition-colors"
            >
              Cerca su Google Flights <ExternalLink className="w-4 h-4" />
            </a>
          </div>
          <div className="space-y-12">
            {(plan.flights || []).map((segment: any, segmentIdx: number) => (
              <div key={segmentIdx}>
                {segment.segmentName && (
                  <h3 className="text-2xl font-serif mb-6 flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-brand-accent/10 text-brand-accent flex items-center justify-center text-sm font-bold">
                      {segmentIdx + 1}
                    </span>
                    {segment.segmentName}
                  </h3>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {(segment.options || []).map((flight: any, i: number) => {
                    const isSelected = selectedFlights[segmentIdx]?.airline === flight.airline && selectedFlights[segmentIdx]?.route === flight.route;
                    const isCarRoute = flight.airline?.toLowerCase() === 'auto privata';
                    const routeParts = flight.route?.split(/\s*(?:->|→)\s*/) || [];
                    const carOrigin = routeParts[0]?.trim() || '';
                    const carDest = routeParts[1]?.trim() || '';
                    const mapsEmbedUrl = isCarRoute && carOrigin && carDest
                      ? `https://maps.google.com/maps?f=d&source=s_d&saddr=${encodeURIComponent(carOrigin)}&daddr=${encodeURIComponent(carDest)}&hl=it&output=embed`
                      : null;
                    return (
                      <div
                        key={i}
                        className={cn("glass p-7 rounded-3xl hover:shadow-md transition-all group block relative border-2",
                          isCarRoute ? "col-span-full" : "",
                          isSelected ? "border-brand-accent ring-4 ring-brand-accent/10" : "border-transparent"
                        )}
                      >
                        {flight.type && (
                          <div className="absolute -top-3 left-6 bg-brand-ink text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full shadow-sm">
                            {flight.type}
                          </div>
                        )}

                        {/* Badge verificato/indicativo */}
                        <div className={cn(
                          "absolute -top-3 right-6 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full shadow-sm flex items-center gap-1",
                          flight.verified === false
                            ? "bg-amber-100 text-amber-700"
                            : "bg-green-100 text-green-700"
                        )}>
                          {flight.verified === false ? (
                            <><AlertTriangle className="w-2.5 h-2.5" /> Indicativo — verifica</>
                          ) : (
                            <><CheckCircle2 className="w-2.5 h-2.5" /> Verificato</>
                          )}
                        </div>

                        {isSelected && (
                          <div className="absolute top-4 right-4 bg-brand-accent text-white p-1 rounded-full z-10">
                            <CheckCircle2 className="w-4 h-4" />
                          </div>
                        )}

                        <div className={cn(isCarRoute ? "flex gap-6 items-start" : "")}>
                        <div className={cn(isCarRoute ? "flex-1 min-w-0" : "")}>
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <p className="font-bold text-xl text-brand-ink">{flight.airline}</p>
                            {flight.date && (
                              <p className="text-[10px] font-bold text-brand-accent uppercase tracking-widest mt-1">Data: {flight.date}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-brand-ink/40 text-xs font-mono uppercase tracking-wider">{flight.route.split('->')[0].trim()}</span>
                              <div className="h-[1px] w-8 bg-brand-ink/10 relative">
                                <Plane className="w-2 h-2 absolute -top-1 left-1/2 -translate-x-1/2 text-brand-ink/20" />
                              </div>
                              <span className="text-brand-ink/40 text-xs font-mono uppercase tracking-wider">{flight.route.split('->')[1]?.trim()}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold text-brand-accent">€{flight.estimatedPrice * (inputs.people.adults + inputs.people.children.length)}</p>
                            <p className="text-[10px] text-brand-ink/40 font-bold uppercase tracking-tighter">Totale per {inputs.people.adults + inputs.people.children.length} pers.</p>
                          </div>
                        </div>

                        <div className="space-y-4 py-4 border-y border-brand-ink/5 mb-4">
                          {/* Orari non disponibili — invito a verificare */}
                          {(!flight.departureTime && !flight.arrivalTime) ? (
                            <div className="flex items-center gap-3 bg-amber-50 rounded-2xl px-4 py-3">
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                              <div>
                                <p className="text-xs font-bold text-amber-800">Orari non disponibili in tempo reale</p>
                                <p className="text-[11px] text-amber-700 mt-0.5">Verifica gli orari precisi e la disponibilità su Google Flights per le date del tuo viaggio.</p>
                              </div>
                            </div>
                          ) : (
                          <>
                          {/* Outbound */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-blue-50 rounded-lg">
                                <Plane className="w-3 h-3 text-blue-600" />
                              </div>
                              <span className="text-[10px] font-bold uppercase tracking-widest text-brand-ink/40">Andata</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-xs text-brand-ink/40 uppercase font-bold leading-none mb-1">Partenza</p>
                                <p className="text-sm font-bold text-brand-ink">{flight.departureTime || '--:--'}</p>
                              </div>
                              <div className="text-center px-3 border-x border-brand-ink/5">
                                <p className="text-xs text-brand-ink/40 uppercase font-bold leading-none mb-1">Durata</p>
                                <p className="text-[10px] font-medium text-brand-ink/70">{flight.duration || '-'}</p>
                              </div>
                              <div className="text-left">
                                <p className="text-xs text-brand-ink/40 uppercase font-bold leading-none mb-1">Arrivo</p>
                                <p className="text-sm font-bold text-brand-ink">{flight.arrivalTime || '--:--'}</p>
                              </div>
                            </div>
                          </div>

                          {/* Return */}
                          {(flight.returnDepartureTime || flight.returnArrivalTime) && (
                            <div className="flex items-center justify-between pt-4 border-t border-brand-ink/5">
                              <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-orange-50 rounded-lg">
                                  <Plane className="w-3 h-3 text-orange-600 rotate-180" />
                                </div>
                                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-ink/40">Ritorno</span>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <p className="text-xs text-brand-ink/40 uppercase font-bold leading-none mb-1">Partenza</p>
                                  <p className="text-sm font-bold text-brand-ink">{flight.returnDepartureTime || '--:--'}</p>
                                </div>
                                <div className="text-center px-3 border-x border-brand-ink/5">
                                  <p className="text-xs text-brand-ink/40 uppercase font-bold leading-none mb-1">Durata</p>
                                  <p className="text-[10px] font-medium text-brand-ink/70">{flight.returnDuration || '-'}</p>
                                </div>
                                <div className="text-left">
                                  <p className="text-xs text-brand-ink/40 uppercase font-bold leading-none mb-1">Arrivo</p>
                                  <p className="text-sm font-bold text-brand-ink">{flight.returnArrivalTime || '--:--'}</p>
                                </div>
                              </div>
                            </div>
                          )}
                          </>
                          )}
                        </div>

                        {(flight.options || []).length > 0 && (
                          <ul className="space-y-1.5 mb-6">
                            {flight.options.map((opt: string, j: number) => (
                              <li key={j} className="text-xs text-brand-ink/60 flex items-center gap-2">
                                <div className="w-1 h-1 rounded-full bg-brand-accent/40 shrink-0" /> {opt}
                              </li>
                            ))}
                          </ul>
                        )}

                        {!isCarRoute ? (
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setSelectedFlights(prev => ({ ...prev, [segmentIdx]: flight }))}
                              className={cn("flex-1 py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2",
                                isSelected
                                  ? "bg-brand-accent text-white shadow-lg shadow-brand-accent/20"
                                  : "bg-brand-paper border border-brand-ink/10 text-brand-ink hover:bg-brand-ink/5"
                              )}
                            >
                              {isSelected ? (
                                <><CheckCircle2 className="w-4 h-4" /> Selezionato</>
                              ) : (
                                'Seleziona'
                              )}
                            </button>
                            <a
                              href={getSafeLink(flight.bookingUrl, flight.airline + ' ' + flight.route)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-3 rounded-2xl bg-brand-paper border border-brand-ink/10 text-brand-ink hover:bg-brand-ink/5 transition-colors"
                              title="Vedi su Google Flights"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </div>
                        ) : (
                          <a
                            href={`https://www.google.com/maps/dir/${encodeURIComponent(carOrigin)}/${encodeURIComponent(carDest)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm font-bold text-brand-accent hover:underline mt-4"
                          >
                            <Car className="w-4 h-4" /> Apri in Google Maps
                          </a>
                        )}
                        </div>
                        {isCarRoute && mapsEmbedUrl && (
                          <div className="flex-1 rounded-2xl overflow-hidden" style={{ minHeight: '320px' }}>
                            <iframe
                              src={mapsEmbedUrl}
                              width="100%"
                              height="100%"
                              style={{ border: 0, minHeight: '320px' }}
                              loading="lazy"
                              title="Percorso Google Maps"
                            />
                          </div>
                        )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ALLOGGI */}
        <section className="mb-10">
          <button
            type="button"
            onClick={() => setHotelsExpanded((v) => !v)}
            className="w-full flex items-center justify-between gap-3 text-left group mb-2"
          >
            <div className="flex items-center gap-3">
              <Hotel className="w-7 h-7" />
              <h2 className="text-4xl">Alloggi scelti</h2>
            </div>
            <span className={cn('text-brand-ink/30 group-hover:text-brand-accent transition-all duration-300 text-sm font-medium flex items-center gap-1', hotelsExpanded && 'rotate-180')}>
              <ChevronRight className={cn('w-5 h-5 transition-transform duration-300', hotelsExpanded ? 'rotate-90' : '-rotate-90')} />
              {hotelsExpanded ? 'Chiudi' : 'Espandi'}
            </span>
          </button>
          <p className="text-brand-ink/50 mb-6 font-sans text-sm">Le strutture selezionate per il tuo pernottamento</p>
          {hotelsExpanded && <div className="space-y-14 mt-6">
          <div className="space-y-14">
            {(plan.accommodations || []).map((stop: any, i: number) => (
              <div key={i}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <h3 className="text-2xl text-brand-accent italic flex items-center gap-2">
                    <MapPin className="w-5 h-5" /> {stop.stopName}
                  </h3>
                  <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-full shadow-sm border border-brand-ink/5">
                    <span className="text-sm font-bold text-brand-ink/60">Notti:</span>
                    <button 
                      onClick={() => setAccommodationNights(prev => ({ ...prev, [i]: Math.max(1, (prev[i] || 1) - 1) }))}
                      className="w-6 h-6 rounded-full bg-brand-paper flex items-center justify-center hover:bg-brand-ink/10 transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-bold w-4 text-center">{accommodationNights[i] || 1}</span>
                    <button 
                      onClick={() => setAccommodationNights(prev => ({ ...prev, [i]: (prev[i] || 1) + 1 }))}
                      className="w-6 h-6 rounded-full bg-brand-paper flex items-center justify-center hover:bg-brand-ink/10 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {(stop.options || []).map((hotel: any, j: number) => (
                    <div
                      key={j}
                      className={cn("group block bg-white rounded-3xl shadow-sm border p-6 hover:shadow-md transition-all duration-300 relative", 
                        selectedAccommodations[i]?.name === hotel.name ? "border-brand-accent ring-2 ring-brand-accent/20" : "border-brand-ink/5"
                      )}
                    >
                      {selectedAccommodations[i]?.name === hotel.name && (
                        <div className="absolute top-4 right-4 bg-brand-accent text-white p-1 rounded-full">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      )}
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="text-lg font-serif leading-tight group-hover:text-brand-accent transition-colors pr-2">
                          {hotel.name}
                        </h4>
                        {hotel.stars && (
                          <div className="flex shrink-0">
                            {Array.from({ length: hotel.stars }).map((_, k) => (
                              <Star key={k} className="w-3 h-3 fill-amber-400 text-amber-400" />
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-brand-ink/40 uppercase tracking-widest mb-3">{hotel.type}</p>
                      {hotel.rating && <StarRating value={hotel.rating} />}
                      {hotel.address && (
                        <p className="text-xs text-brand-ink/40 mt-2 flex items-start gap-1">
                          <MapPin className="w-3 h-3 shrink-0 mt-0.5" /> {hotel.address}
                        </p>
                      )}
                      {hotel.reviewSummary && (
                        <p className="text-sm text-brand-ink/60 mt-3 italic leading-relaxed line-clamp-2">
                          "{hotel.reviewSummary}"
                        </p>
                      )}
                      {(hotel.amenities || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {hotel.amenities.slice(0, 3).map((a: string, k: number) => (
                            <Badge key={k}>{a}</Badge>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-4 mt-4 border-t border-brand-ink/5">
                        <div>
                          <span className="text-xs text-brand-ink/40 block">per notte</span>
                          <span className="font-bold text-lg">€{hotel.estimatedPricePerNight}</span>
                        </div>
                        <div className="flex gap-2">
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const key = `${i}-${j}`;
                                setOpenBookingMenu(prev => prev === key ? null : key);
                              }}
                              className="text-xs font-bold uppercase tracking-widest text-brand-accent hover:underline flex items-center gap-1"
                            >
                              Prenota
                            </button>
                            {openBookingMenu === `${i}-${j}` && (() => {
                              let currentOffset = 0;
                              for (let k = 0; k < i; k++) currentOffset += plan.accommodations[k].nights || 0;
                              const start = new Date(inputs.startDate);
                              const stopStart = new Date(start);
                              stopStart.setDate(start.getDate() + currentOffset);
                              const stopEnd = new Date(stopStart);
                              stopEnd.setDate(stopStart.getDate() + (accommodationNights[i] || 1));
                              const fmt = (d: Date) => d.toISOString().split('T')[0];
                              const urls = getBookingPlatformUrls(hotel.name, stop.stopName, fmt(stopStart), fmt(stopEnd), inputs.people);
                              return (
                                <div className="absolute bottom-8 left-0 z-20 bg-white rounded-2xl shadow-xl border border-brand-ink/10 p-3 flex flex-col gap-2 min-w-[160px]" onClick={e => e.stopPropagation()}>
                                  {hotel.bookingUrl && (
                                    <a href={hotel.bookingUrl} target="_blank" rel="noopener noreferrer"
                                      className="flex items-center gap-2 text-xs font-bold text-brand-accent hover:text-brand-accent/70 transition-colors px-2 py-1.5 rounded-xl hover:bg-brand-paper border border-brand-accent/20 mb-1">
                                      🏨 Sito ufficiale
                                    </a>
                                  )}
                                  <a href={urls.booking} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-xs font-bold text-brand-ink/80 hover:text-brand-accent transition-colors px-2 py-1.5 rounded-xl hover:bg-brand-paper">
                                    <img src="https://www.booking.com/favicon.ico" className="w-4 h-4" alt="" /> Booking.com
                                  </a>
                                  <a href={urls.expedia} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-xs font-bold text-brand-ink/80 hover:text-brand-accent transition-colors px-2 py-1.5 rounded-xl hover:bg-brand-paper">
                                    <img src="https://www.expedia.it/favicon.ico" className="w-4 h-4" alt="" /> Expedia
                                  </a>
                                  <a href={urls.airbnb} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-xs font-bold text-brand-ink/80 hover:text-brand-accent transition-colors px-2 py-1.5 rounded-xl hover:bg-brand-paper">
                                    <img src="https://www.airbnb.it/favicon.ico" className="w-4 h-4" alt="" /> Airbnb
                                  </a>
                                </div>
                              );
                            })()}</div>
                          <button 
                            onClick={() => setSelectedAccommodations(prev => ({ ...prev, [i]: hotel }))}
                            className={cn("text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full transition-colors",
                              selectedAccommodations[i]?.name === hotel.name ? "bg-brand-accent text-white" : "bg-brand-paper hover:bg-brand-ink/5"
                            )}
                          >
                            {selectedAccommodations[i]?.name === hotel.name ? 'Scelto' : 'Scegli'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <AccommodationReviewer 
            stops={plan.accommodations || []}
            inputs={inputs}
            onAdd={(hotel, stopIndex) => {
              // Aggiungi l'hotel alle opzioni della tappa selezionata
              const updatedPlan = { ...plan };
              if (updatedPlan.accommodations && updatedPlan.accommodations[stopIndex]) {
                // Crea una copia profonda della tappa per non mutare lo stato direttamente
                const updatedAccommodations = [...updatedPlan.accommodations];
                const updatedStop = { ...updatedAccommodations[stopIndex] };
                updatedStop.options = [...updatedStop.options, hotel];
                updatedAccommodations[stopIndex] = updatedStop;
                updatedPlan.accommodations = updatedAccommodations;
                
                // Aggiorna lo stato globale
                onUpdatePlan(updatedPlan);
                
                // Seleziona automaticamente l'hotel appena aggiunto
                setSelectedAccommodations(prev => ({ ...prev, [stopIndex]: hotel }));
                alert(`Alloggio aggiunto e selezionato per la tappa: ${plan.accommodations[stopIndex].stopName}`);
              } else {
                alert("Errore nell'aggiunta dell'alloggio: tappa non valida.");
              }
            }}
          />
          </div>}
        </section>

        {/* RISTORANTI */}
        {plan.bestRestaurants?.length > 0 && (
          <section className="mb-10">
            <button
              type="button"
              onClick={() => setRestaurantsExpanded((v) => !v)}
              className="w-full flex items-center justify-between gap-3 text-left group mb-2"
            >
              <div className="flex items-center gap-3">
                <Utensils className="w-7 h-7" />
                <h2 className="text-4xl">Dove mangiare</h2>
              </div>
              <span className="text-brand-ink/30 group-hover:text-brand-accent transition-all duration-300 text-sm font-medium flex items-center gap-1">
                <ChevronRight className={cn('w-5 h-5 transition-transform duration-300', restaurantsExpanded ? 'rotate-90' : '-rotate-90')} />
                {restaurantsExpanded ? 'Chiudi' : 'Espandi'}
              </span>
            </button>
            <p className="text-brand-ink/50 mb-6 font-sans text-sm">Ristoranti locali autentici, selezionati per qualità e genuinità</p>
            {restaurantsExpanded && <div className="space-y-14 mt-6">
              {plan.bestRestaurants.map((stop: any, i: number) => (
                <div key={i}>
                  <h3 className="text-2xl mb-6 text-brand-accent italic flex items-center gap-2">
                    <MapPin className="w-5 h-5" /> {stop.stopName || stop.name}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {(stop.options || [stop]).map((rest: any, j: number) => (
                      <a
                        key={j}
                        href={getSafeLink(rest.sourceUrl, rest.name + ' ristorante')}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block bg-white rounded-3xl shadow-sm border border-brand-ink/5 p-6 hover:shadow-md transition-all duration-300"
                      >
                        <h4 className="text-lg font-serif mb-0.5 group-hover:text-brand-accent transition-colors">{rest.name}</h4>
                        <p className="text-[10px] text-brand-ink/40 uppercase tracking-widest mb-3">{rest.cuisineType}</p>
                        {rest.rating && <StarRating value={rest.rating} />}
                        {rest.address && (
                          <p className="text-xs text-brand-ink/40 mt-2 flex items-start gap-1">
                            <MapPin className="w-3 h-3 shrink-0 mt-0.5" /> {rest.address}
                          </p>
                        )}
                        {rest.reviewSummary && (
                          <p className="text-sm text-brand-ink/60 mt-3 italic leading-relaxed line-clamp-2">
                            "{rest.reviewSummary}"
                          </p>
                        )}
                        {rest.mustTry && (
                          <div className="mt-3 bg-orange-50 p-3 rounded-xl">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600 mb-0.5">Da provare</p>
                            <p className="text-xs text-orange-800">{rest.mustTry}</p>
                          </div>
                        )}
                        <div className="flex justify-between items-center pt-4 mt-4 border-t border-brand-ink/5">
                          <span className="text-xs text-brand-ink/40">Fascia di prezzo</span>
                          <span className="font-bold">{rest.priceRange}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>}
          </section>
        )}

        {/* CONSIGLI LOCALI + TRASPORTI */}
        {(plan.localTips?.length > 0 || plan.transportInfo) && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-20">
            {plan.localTips?.length > 0 && (
              <div className="glass p-8 rounded-[2rem]">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-3 bg-yellow-50 rounded-2xl">
                    <Lightbulb className="w-6 h-6 text-yellow-500" />
                  </div>
                  <h2 className="text-3xl">Consigli locali</h2>
                </div>
                <ul className="space-y-4">
                  {plan.localTips.map((tip: string, i: number) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <p className="text-brand-ink/80 text-sm leading-relaxed">{tip}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.transportInfo && (
              <div className="glass p-8 rounded-[2rem]">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-3 bg-cyan-50 rounded-2xl">
                    <Train className="w-6 h-6 text-cyan-600" />
                  </div>
                  <h2 className="text-3xl">Come muoversi</h2>
                </div>
                <p className="text-brand-ink/80 leading-relaxed mb-6 text-sm">{plan.transportInfo.localTransport}</p>
                {plan.transportInfo.bestApps?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-ink/40 mb-3 flex items-center gap-2">
                      <Smartphone className="w-3 h-3" /> App consigliate
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {plan.transportInfo.bestApps.map((app: string, i: number) => (
                        <Badge key={i} color="blue">{app}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {plan.transportInfo.estimatedLocalCost && (
                  <p className="mt-4 text-sm text-brand-ink/60 border-t border-brand-ink/5 pt-4">
                    Costo locale stimato: <strong>{plan.transportInfo.estimatedLocalCost}</strong>
                  </p>
                )}
                {plan.transportInfo.privateTransferLinks && plan.transportInfo.privateTransferLinks.length > 0 && (
                  <div className="mt-6 border-t border-brand-ink/5 pt-6">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-ink/40 mb-3 flex items-center gap-2">
                      <Users className="w-3 h-3" /> Trasferimenti privati
                    </p>
                    <div className="space-y-3">
                      {plan.transportInfo.privateTransferLinks.map((link: any, i: number) => (
                        <a
                          key={i}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-brand-paper rounded-xl hover:bg-brand-ink/5 transition-colors group"
                        >
                          <div>
                            <p className="text-sm font-bold text-brand-ink group-hover:text-brand-accent transition-colors">{link.provider}</p>
                            {link.description && <p className="text-[10px] text-brand-ink/50">{link.description}</p>}
                          </div>
                          <ExternalLink className="w-4 h-4 text-brand-ink/20 group-hover:text-brand-accent transition-colors" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* TABELLA RIASSUNTIVA ITINERARIO */}
        {plan.itinerary && plan.itinerary.length > 0 && (
          <section className="mb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <h2 className="text-4xl flex items-center gap-3">
                <Calendar className="w-7 h-7" /> Riassunto Itinerario
              </h2>
              <button
                onClick={handleExportExcel}
                className="inline-flex items-center justify-center gap-2 bg-green-50 text-green-600 px-6 py-3 rounded-full font-bold text-sm hover:bg-green-100 transition-colors print:hidden"
              >
                <Download className="w-4 h-4" /> Esporta in Excel
              </button>
            </div>
            <div className="bg-white rounded-3xl shadow-sm border border-brand-ink/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-brand-paper/50 border-b border-brand-ink/5 text-[10px] uppercase tracking-widest text-brand-ink/40">
                      <th className="p-4 font-bold whitespace-nowrap">Data / Ora</th>
                      <th className="p-4 font-bold">Luogo</th>
                      <th className="p-4 font-bold">Attività</th>
                      <th className="p-4 font-bold whitespace-nowrap">Durata</th>
                      <th className="p-4 font-bold whitespace-nowrap text-right">Costo Stimato</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {plan.itinerary.map((day: any, i: number) => (
                      <React.Fragment key={i}>
                        <tr className="bg-brand-paper/20">
                          <td colSpan={5} className="p-3 font-serif font-medium text-brand-accent border-y border-brand-ink/5">
                            Giorno {day.day} - {day.title}
                          </td>
                        </tr>
                        {day.activities?.map((act: any, j: number) => {
                          const numPeople = inputs.people.adults + inputs.people.children.length;
                          const actTotal = (act.costEstimate || 0) * numPeople;
                          return (
                            <tr key={`${i}-${j}`} className="border-b border-brand-ink/5 last:border-0 hover:bg-brand-paper/30 transition-colors">
                              <td className="p-4 text-brand-ink/60 whitespace-nowrap font-mono text-xs">{act.time}</td>
                              <td className="p-4 text-brand-ink/60 whitespace-nowrap">{act.location || '-'}</td>
                              <td className="p-4 font-medium">{act.name || act.description}</td>
                              <td className="p-4 text-brand-ink/60 whitespace-nowrap">{act.duration || '-'}</td>
                              <td className="p-4 text-right font-medium whitespace-nowrap">
                                {act.costEstimate ? (
                                  <>
                                    €{actTotal} <span className="text-xs text-brand-ink/40 font-normal">(€{act.costEstimate} x {numPeople} pers.)</span>
                                  </>
                                ) : (
                                  (act.description?.toLowerCase().includes('vedi costo nella sezione voli') || act.tips?.toLowerCase().includes('vedi costo nella sezione voli'))
                                    ? <span className="text-brand-accent italic text-xs">Vedi sezione voli</span>
                                    : 'Gratis / N.D.'
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                    {Object.keys(selectedFlights).length > 0 && (() => {
                      const numPeople = inputs.people.adults + inputs.people.children.length;
                      const flightEntries = Object.entries(selectedFlights) as [string, any][];
                      const totalFlights = flightEntries.reduce((s, [, f]) => s + (f.estimatedPrice * numPeople), 0);
                      const routes = flightEntries.map(([, f]) => f.route).join(' → ');
                      const airlines = [...new Set(flightEntries.map(([, f]) => f.airline))].join(', ');
                      return (
                        <>
                          <tr className="bg-brand-paper/20">
                            <td colSpan={5} className="p-3 font-serif font-medium text-brand-accent border-y border-brand-ink/5">
                              Trasporti Selezionati
                            </td>
                          </tr>
                          <tr className="border-b border-brand-ink/5 hover:bg-brand-paper/30 transition-colors">
                            <td className="p-4 text-brand-ink/60 whitespace-nowrap font-mono text-xs">
                              {flightEntries.map(([, f]) => f.date).filter(Boolean).join(' / ') || '-'}
                            </td>
                            <td className="p-4 text-brand-ink/60 whitespace-nowrap">{airlines}</td>
                            <td className="p-4 font-medium">
                              {routes} <span className="text-xs text-brand-ink/40 font-normal">({flightEntries.length} {flightEntries.length === 1 ? 'segmento' : 'segmenti'})</span>
                            </td>
                            <td className="p-4 text-brand-ink/60 whitespace-nowrap">-</td>
                            <td className="p-4 text-right font-medium whitespace-nowrap">
                              €{totalFlights} <span className="text-xs text-brand-ink/40 font-normal">(€{flightEntries.reduce((s, [, f]) => s + f.estimatedPrice, 0)} x {numPeople} pers.)</span>
                            </td>
                          </tr>
                        </>
                      );
                    })()}
                    {Object.keys(selectedAccommodations).length > 0 && (
                      <>
                        <tr className="bg-brand-paper/20">
                          <td colSpan={5} className="p-3 font-serif font-medium text-brand-accent border-y border-brand-ink/5">
                            Alloggi Selezionati
                          </td>
                        </tr>
                        {Object.entries(selectedAccommodations).map(([stopIndex, hotel]: [string, any]) => {
                          const nights = accommodationNights[parseInt(stopIndex)] || 1;
                          return (
                            <tr key={`hotel-${stopIndex}`} className="border-b border-brand-ink/5 last:border-0 hover:bg-brand-paper/30 transition-colors">
                              <td className="p-4 text-brand-ink/60 whitespace-nowrap font-mono text-xs">-</td>
                              <td className="p-4 text-brand-ink/60 whitespace-nowrap">{plan.accommodations[parseInt(stopIndex)]?.stopName}</td>
                              <td className="p-4 font-medium">
                                {hotel.name}
                              </td>
                              <td className="p-4 text-brand-ink/60 whitespace-nowrap">{nights} {nights === 1 ? 'notte' : 'notti'}</td>
                              <td className="p-4 text-right font-medium whitespace-nowrap">
                                €{hotel.estimatedPricePerNight * nights} <span className="text-xs text-brand-ink/40 font-normal">(€{hotel.estimatedPricePerNight}/notte camera)</span>
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-brand-ink/5 border-t-2 border-brand-ink/10">
                      <td colSpan={4} className="p-4 text-right font-serif font-bold text-lg">
                        Totale Stimato:
                      </td>
                      <td className="p-4 text-right font-bold text-xl text-brand-accent whitespace-nowrap">
                        €{totalCost}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* TRAVEL BLOGS */}
        {plan.travelBlogs && plan.travelBlogs.length > 0 && (
          <section className="mb-20">
            <h2 className="text-5xl mb-2">Ispirazioni</h2>
            <p className="text-brand-ink/50 mb-8 font-sans text-sm">Articoli e blog di viaggio per approfondire</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {plan.travelBlogs.map((blog: any, i: number) => (
                <a
                  key={i}
                  href={getSafeLink(blog.url, blog.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block bg-white rounded-3xl shadow-sm border border-brand-ink/5 p-6 hover:shadow-md transition-all duration-300"
                >
                  <h4 className="text-lg font-serif mb-2 group-hover:text-brand-accent transition-colors leading-tight">{blog.title}</h4>
                  {blog.description && (
                    <p className="text-sm text-brand-ink/60 leading-relaxed line-clamp-3">
                      {blog.description}
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-1.5 text-[10px] text-brand-accent font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                    <ExternalLink className="w-3 h-3" /> Leggi l'articolo
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* MODIFY REQUEST */}
        <section className="mb-20">
          <div className="bg-brand-paper p-8 rounded-[2rem] border border-brand-ink/10 shadow-sm">
            <h3 className="text-2xl font-serif mb-4 flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-brand-accent" />
              Vuoi modificare o aggiungere qualcosa?
            </h3>
            <p className="text-brand-ink/60 text-sm mb-6">
              L'itinerario non è perfetto? Chiedimi di cambiare hotel, aggiungere un giorno, o cercare attività diverse.
            </p>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                <MessageSquare className="w-3 h-3" /> Desideri e note per l'aggiornamento
              </label>
              <textarea 
                className="w-full bg-white border border-brand-ink/10 rounded-2xl p-5 min-h-[120px] text-sm leading-relaxed focus:ring-2 ring-brand-accent/20 outline-none transition-all resize-none placeholder:text-brand-ink/25"
                placeholder="Es. Aggiungi un giorno a Parigi, cambia l'hotel con uno più economico..."
                value={modifyText}
                onChange={(e) => setModifyText(e.target.value)}
              />
            </div>
            <div className="mt-6 flex justify-end">
              <button 
                onClick={() => onModify(modifyText)}
                disabled={!modifyText.trim()}
                className="bg-brand-accent text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-3 hover:bg-brand-accent/85 transition-all disabled:opacity-50 shadow-lg shadow-brand-accent/25 group w-full md:w-auto justify-center"
              >
                Aggiorna Itinerario <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}

// ─── FORM VIEW ────────────────────────────────────────────────────────────────

function FormView({ onSubmit, loading, initialShowTrips, onShowTripsDone, onLoadTrip, tripsVersion }: { onSubmit: (inputs: TravelInputs) => void; loading: boolean; initialShowTrips?: boolean; onShowTripsDone?: () => void; onLoadTrip?: (trip: SavedTrip) => void; tripsVersion?: number }) {
  const { user, profile, signOut, updateProfile: updateAuthProfile } = useAuth();
  const [bgSeed] = useState(() => Math.floor(Math.random() * 1000));
  const [formStep, setFormStep] = useState<'profile' | 'travel'>('travel');
  const [view, setView] = useState<'form' | 'trips'>('form');
  const [showAuth, setShowAuth] = useState(false);

  // Se richiesto dal genitore (es. dopo "I miei viaggi" dall'itinerario), apri direttamente i viaggi
  useEffect(() => {
    if (initialShowTrips) {
      setView('trips');
      onShowTripsDone?.();
    }
  }, [initialShowTrips]);
  const [travelerProfile, setTravelerProfile] = useState<TravelerProfileForm>({
    ageRange: '',
    travelerType: '',
    interests: [],
    pace: 'Equilibrato',
    mobility: 'Nessuna limitazione',
    familiarity: 'Mai stato qui',
  });
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false);
  const [profileEditLoading, setProfileEditLoading] = useState(false);
  const [profileEditSuccess, setProfileEditSuccess] = useState(false);
  const [profileEditError, setProfileEditError] = useState<string | null>(null);

  // Load profile from auth context into travelerProfile when available
  useEffect(() => {
    if (profile) {
      setTravelerProfile((prev) => ({
        ...prev,
        ageRange: profile.age_range || prev.ageRange,
        travelerType: profile.traveler_type || prev.travelerType,
        interests: profile.interests || prev.interests,
        pace: profile.pace || prev.pace,
        mobility: profile.mobility || prev.mobility,
        familiarity: profile.familiarity || prev.familiarity,
      }));
    }
  }, [profile]);

  // Load saved trips on mount, when user changes, or when trips panel opens
  useEffect(() => {
    loadTrips(user?.id).then(setSavedTrips);
  }, [user, tripsVersion]);

  useEffect(() => {
    if (view === 'trips') {
      loadTrips(user?.id).then(setSavedTrips);
    }
  }, [view]);

  // Close user menu when clicking outside
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => setUserMenuOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [userMenuOpen]);

  const [inputs, setInputs] = useState<TravelInputs & { budgetInput: string }>({
    people: { adults: 2, children: [] },
    budget: 2000,
    budgetInput: '2000',
    departureCity: '',
    departureCountry: '',
    destination: '',
    country: '',
    startDate: '',
    endDate: '',
    isPeriodFlexible: false,
    accommodationType: 'Hotel di charme',
    flightPreference: '',
    notes: '',
  });

  const [selectedAccommodations, setSelectedAccommodations] = useState<string[]>(['Hotel di charme']);

  const ACCOMMODATION_OPTIONS = [
    'Hotel di charme',
    'Hotel economici',
    'Resort',
    'Hotel di lusso',
    'B&B',
    'Esperienze uniche (Ryokan, Glamping, Case sull\'albero…)',
    'Appartamenti',
  ];

  const toggleAccommodation = (option: string) => {
    setSelectedAccommodations((prev) => {
      const next = prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option];
      return next.length === 0 ? prev : next; // almeno uno selezionato
    });
  };

  const [departureCityOptions, setDepartureCityOptions] = useState<string[]>([]);
  const [destinationOptions, setDestinationOptions] = useState<string[]>([]);
  const [loadingDepartureCountry, setLoadingDepartureCountry] = useState(false);
  const [loadingDestinationCountry, setLoadingDestinationCountry] = useState(false);

  useEffect(() => {
    if (!inputs.departureCity || inputs.departureCity.length < 3) return;
    const timer = setTimeout(async () => {
      setLoadingDepartureCountry(true);
      try {
        const options = await getDestinationCountries(inputs.departureCity);
        setDepartureCityOptions(options);
        if (options.length === 1) setInputs((p) => ({ ...p, departureCountry: options[0] }));
      } catch { /* ignore */ } finally {
        setLoadingDepartureCountry(false);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [inputs.departureCity]);

  useEffect(() => {
    if (!inputs.destination || inputs.destination.length < 3) return;
    const timer = setTimeout(async () => {
      setLoadingDestinationCountry(true);
      try {
        const options = await getDestinationCountries(inputs.destination);
        setDestinationOptions(options);
        if (options.length === 1) setInputs((p) => ({ ...p, country: options[0] }));
      } catch { /* ignore */ } finally {
        setLoadingDestinationCountry(false);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [inputs.destination]);

  const handleAddChild = () =>
    setInputs((p) => ({ ...p, people: { ...p.people, children: [...p.people.children, { age: 8 }] } }));

  const handleRemoveChild = (i: number) =>
    setInputs((p) => ({ ...p, people: { ...p.people, children: p.people.children.filter((_, j) => j !== i) } }));

  const handleChildAge = (i: number, age: number) =>
    setInputs((p) => {
      const c = [...p.people.children];
      c[i].age = age;
      return { ...p, people: { ...p.people, children: c } };
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputs.startDate && inputs.endDate) {
      const nights = Math.round(
        (new Date(inputs.endDate).getTime() - new Date(inputs.startDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (nights > 15) {
        alert("Per il momento Vagabond può generare itinerari di massimo 15 giorni. Seleziona un periodo più breve.");
        return;
      }
    }
    const perPerson = parseInt(inputs.budgetInput) || 0;
    const totalPeople = inputs.people.adults + inputs.people.children.length;
    const finalInputs = {
      ...inputs,
      budget: perPerson * totalPeople,
      accommodationType: selectedAccommodations.join(', '),
      travelerProfile,
    };
    onSubmit(finalInputs);
  };

  return (
    <div className="min-h-screen bg-brand-paper flex flex-col lg:flex-row">
      {/* Left Side - Image & Branding */}
      <div className="lg:w-5/12 relative min-h-[40vh] lg:min-h-screen flex flex-col items-center justify-start p-8 md:p-16 overflow-hidden">
        <img 
          src={getHeroImage(bgSeed)}
          alt="Travel Inspiration" 
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/10 to-black/80" />
        <div className="absolute inset-0 bg-brand-ink/10" />
        
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="relative z-10 mt-8 lg:mt-16 flex flex-col items-center text-center">
          <div className="inline-block bg-white rounded-2xl px-5 py-3 shadow-lg mb-4">
            <img
              src="/leowanderlogo.png"
              alt="Leo Wander"
              className="w-36 md:w-44 h-auto"
            />
          </div>
          <p className="text-lg md:text-xl font-serif italic text-white/90 max-w-md drop-shadow-md">
            Il tuo concierge digitale per viaggi autentici e indimenticabili.
          </p>
        </motion.div>
      </div>

      {/* Right Side - Form */}
      <div className="lg:w-7/12 flex-1 overflow-y-auto relative">
        {/* User Menu - TOP RIGHT */}
        <div className="sticky top-0 z-40 bg-brand-paper/80 backdrop-blur-md border-b border-brand-ink/5">
          <div className="max-w-3xl mx-auto px-6 md:px-12 lg:px-16 xl:px-20 flex justify-end items-center py-2">
            {user ? (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setUserMenuOpen(!userMenuOpen); }}
                  className="flex items-center gap-2 text-sm text-brand-ink/70 hover:text-brand-ink transition-colors px-3 py-1.5 rounded-lg hover:bg-brand-ink/5"
                >
                  <div className="w-7 h-7 bg-brand-accent/20 rounded-full flex items-center justify-center text-brand-accent text-xs font-bold">
                    {(user.email || 'U')[0].toUpperCase()}
                  </div>
                  <span className="hidden md:inline max-w-[150px] truncate">{profile?.display_name || user.email}</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 mt-1 w-56 bg-white rounded-xl shadow-lg border border-brand-ink/5 py-1 overflow-hidden">
                    <div className="px-4 py-2 border-b border-brand-ink/5">
                      <p className="text-xs text-brand-ink/40 truncate">{user.email}</p>
                    </div>
                    <button
                      onClick={() => { setUserMenuOpen(false); setShowProfileEditor(true); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-brand-ink/70 hover:bg-brand-ink/5 hover:text-brand-ink transition-colors flex items-center gap-2"
                    >
                      <Users className="w-4 h-4" /> Il mio profilo viaggiatore
                    </button>
                    <button
                      onClick={() => { setUserMenuOpen(false); setView('trips'); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-brand-ink/70 hover:bg-brand-ink/5 hover:text-brand-ink transition-colors flex items-center gap-2"
                    >
                      <MapPin className="w-4 h-4" /> I miei viaggi
                    </button>
                    <button
                      onClick={() => { setUserMenuOpen(false); setShowChangePassword(true); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-brand-ink/70 hover:bg-brand-ink/5 hover:text-brand-ink transition-colors flex items-center gap-2"
                    >
                      <KeyRound className="w-4 h-4" /> Cambia password
                    </button>
                    <div className="border-t border-brand-ink/5">
                      <button
                        onClick={async () => { setUserMenuOpen(false); await signOut(); setView('form'); setSavedTrips([]); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2"
                      >
                        <ArrowRight className="w-4 h-4 rotate-180" /> Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                className="text-sm text-brand-ink/50 hover:text-brand-accent transition-colors px-3 py-1.5 rounded-lg hover:bg-brand-accent/5 flex items-center gap-1.5"
              >
                <Users className="w-4 h-4" /> Accedi
              </button>
            )}
          </div>
        </div>

        <div className="max-w-3xl mx-auto p-6 md:p-12 lg:p-16 xl:p-20">
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>

            {/* Saved Trips View */}
            {view === 'trips' && (
              <SavedTrips
                trips={savedTrips}
                onLoad={(trip) => { onLoadTrip?.(trip); }}
                onDelete={async (tripId) => { await deleteTrip(tripId, user?.id); const trips = await loadTrips(user?.id); setSavedTrips(trips); }}
                onToggleFavorite={async (tripId, isFav) => { await toggleFavorite(tripId, isFav, user?.id); const trips = await loadTrips(user?.id); setSavedTrips(trips); }}
                onBack={() => setView('form')}
              />
            )}

            {/* Profile Step */}
            {view === 'form' && formStep === 'profile' && (
              <>
                <div className="bg-gradient-to-br from-brand-accent/10 to-brand-accent/5 border-2 border-brand-accent/30 rounded-3xl p-6 mb-8 shadow-lg shadow-brand-accent/5">
                  <h2 className="text-2xl md:text-3xl mb-3 font-serif text-brand-ink leading-tight">
                    🎭 Dimmi chi sei<span className="text-brand-accent"> per cercare un viaggio solo per te!</span>
                  </h2>
                  <p className="text-brand-ink/60 text-base leading-relaxed">
                    Il tuo profilo viaggiatore rende ogni itinerario unico: ritmo, interessi, stile di viaggio. <strong className="text-brand-ink">Compila e continueremo insieme.</strong>
                  </p>
                </div>
                <ProfileForm
                  value={travelerProfile}
                  onChange={setTravelerProfile}
                  onContinue={async () => {
                    // Save profile to Supabase if user is logged in
                    if (user && updateAuthProfile) {
                      try {
                        setProfileEditLoading(true);
                        await updateAuthProfile({
                          age_range: travelerProfile.ageRange,
                          traveler_type: travelerProfile.travelerType,
                          interests: travelerProfile.interests,
                          pace: travelerProfile.pace,
                          mobility: travelerProfile.mobility,
                          familiarity: travelerProfile.familiarity,
                        });
                      } catch (err) {
                        console.error('Error saving profile:', err);
                      } finally {
                        setProfileEditLoading(false);
                      }
                    }
                    setFormStep('travel');
                  }}
                />
              </>
            )}

            {/* Travel Form (default) */}
            {view === 'form' && formStep === 'travel' && (
            <>
            <h2 className="text-3xl md:text-4xl mb-2 font-serif">Crea il tuo itinerario</h2>
            <p className="text-brand-ink/50 mb-10 text-sm">Raccontami i tuoi desideri, penserò io a tutto il resto.</p>
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setFormStep('profile')}
                className="flex items-center gap-2 bg-brand-accent/10 hover:bg-brand-accent/20 text-brand-accent px-4 py-2 rounded-xl text-sm font-medium transition-colors border border-brand-accent/20"
              >
                <Users className="w-4 h-4" /> ✨ Crea/modifica il tuo profilo viaggiatore
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-10">
              {/* Partenza & Destinazione */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    <Plane className="w-3 h-3" /> Da dove parti?
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="Milano, Roma…"
                    className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-xl focus:border-brand-accent outline-none transition-colors placeholder:text-brand-ink/20"
                    value={inputs.departureCity}
                    onChange={(e) => setInputs((p) => ({ ...p, departureCity: e.target.value, departureCountry: '' }))}
                  />
                  {/* Country auto-field */}
                  <div className="flex items-center gap-2 mt-1">
                    {loadingDepartureCountry && <Loader2 className="w-3 h-3 animate-spin text-brand-ink/30" />}
                    {!loadingDepartureCountry && departureCityOptions.length > 1 ? (
                      <select
                        className="text-xs text-brand-ink/60 bg-transparent border-b border-brand-ink/10 outline-none py-1 pr-2 cursor-pointer"
                        value={inputs.departureCountry || ''}
                        onChange={(e) => setInputs((p) => ({ ...p, departureCountry: e.target.value }))}
                      >
                        <option value="">— Seleziona nazione —</option>
                        {departureCityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="Nazione"
                        className="text-xs text-brand-ink/50 bg-transparent border-b border-brand-ink/10 py-1 outline-none focus:border-brand-accent transition-colors placeholder:text-brand-ink/20 w-40"
                        value={inputs.departureCountry || ''}
                        onChange={(e) => setInputs((p) => ({ ...p, departureCountry: e.target.value }))}
                      />
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    <MapPin className="w-3 h-3" /> Dove vuoi andare?
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="Islanda, Giappone, Bali…"
                    className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-xl focus:border-brand-accent outline-none transition-colors placeholder:text-brand-ink/20"
                    value={inputs.destination}
                    onChange={(e) => setInputs((p) => ({ ...p, destination: e.target.value, country: '' }))}
                  />
                  {/* Country auto-field */}
                  <div className="flex items-center gap-2 mt-1">
                    {loadingDestinationCountry && <Loader2 className="w-3 h-3 animate-spin text-brand-ink/30" />}
                    {!loadingDestinationCountry && destinationOptions.length > 1 ? (
                      <select
                        className="text-xs text-brand-ink/60 bg-transparent border-b border-brand-ink/10 outline-none py-1 pr-2 cursor-pointer"
                        value={inputs.country || ''}
                        onChange={(e) => setInputs((p) => ({ ...p, country: e.target.value }))}
                      >
                        <option value="">— Seleziona nazione —</option>
                        {destinationOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="Nazione"
                        className="text-xs text-brand-ink/50 bg-transparent border-b border-brand-ink/10 py-1 outline-none focus:border-brand-accent transition-colors placeholder:text-brand-ink/20 w-40"
                        value={inputs.country || ''}
                        onChange={(e) => setInputs((p) => ({ ...p, country: e.target.value }))}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Stopover & Orario Partenza */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    <Plane className="w-3 h-3" /> Eventuale stop over (opzionale)
                  </label>
                  <input
                    type="text"
                    placeholder="Es. Dubai, Londra..."
                    className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-lg focus:border-brand-accent outline-none transition-colors placeholder:text-brand-ink/20"
                    value={inputs.stopover || ''}
                    onChange={(e) => setInputs((p) => ({ ...p, stopover: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    <Clock className="w-3 h-3" /> Orario di partenza preferito
                  </label>
                  <select
                    className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-lg focus:border-brand-accent outline-none transition-colors appearance-none cursor-pointer"
                    value={inputs.departureTimePreference || 'Indifferente'}
                    onChange={(e) => setInputs((p) => ({ ...p, departureTimePreference: e.target.value }))}
                  >
                    <option value="Indifferente">Indifferente</option>
                    <option value="Mattina">Mattina</option>
                    <option value="Pomeriggio">Pomeriggio</option>
                    <option value="Sera">Sera</option>
                  </select>
                </div>
              </div>

              {/* Chi viaggia + Budget */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    <Users className="w-3 h-3" /> Chi viaggia?
                  </label>
                  <div className="flex items-center gap-8">
                    <div>
                      <span className="text-xs text-brand-ink/40 block mb-2">Adulti</span>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setInputs((p) => ({ ...p, people: { ...p.people, adults: Math.max(1, p.people.adults - 1) } }))}
                          className="w-8 h-8 rounded-full border border-brand-ink/20 flex items-center justify-center hover:bg-brand-ink/5 transition-colors">
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-2xl font-serif w-6 text-center">{inputs.people.adults}</span>
                        <button type="button" onClick={() => setInputs((p) => ({ ...p, people: { ...p.people, adults: p.people.adults + 1 } }))}
                          className="w-8 h-8 rounded-full border border-brand-ink/20 flex items-center justify-center hover:bg-brand-ink/5 transition-colors">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-brand-ink/40 block mb-2">Bambini</span>
                      <button type="button" onClick={handleAddChild}
                        className="flex items-center gap-1.5 text-brand-accent text-sm font-bold hover:text-brand-accent/70 transition-colors">
                        <Plus className="w-4 h-4" /> Aggiungi
                      </button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {inputs.people.children.length > 0 && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-2">
                        {inputs.people.children.map((child, i) => (
                          <div key={i} className="flex items-center justify-between bg-brand-ink/5 p-3 rounded-xl">
                            <span className="text-sm text-brand-ink/60">Bambino {i + 1}</span>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => handleChildAge(i, Math.max(0, child.age - 1))}
                                  className="w-6 h-6 rounded-full bg-white border border-brand-ink/10 flex items-center justify-center">
                                  <Minus className="w-2.5 h-2.5" />
                                </button>
                                <span className="text-sm font-bold w-4 text-center">{child.age}</span>
                                <button type="button" onClick={() => handleChildAge(i, Math.min(17, child.age + 1))}
                                  className="w-6 h-6 rounded-full bg-white border border-brand-ink/10 flex items-center justify-center">
                                  <Plus className="w-2.5 h-2.5" />
                                </button>
                              </div>
                              <span className="text-xs text-brand-ink/40">anni</span>
                              <button type="button" onClick={() => handleRemoveChild(i)} className="text-red-400 hover:text-red-600 transition-colors">
                                <Minus className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    <Euro className="w-3 h-3" /> Budget per persona
                  </label>
                  <div className="relative">
                    <input
                      required
                      type="number"
                      min="0"
                      className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-2xl focus:border-brand-accent outline-none transition-colors pr-8"
                      value={inputs.budgetInput}
                      onChange={(e) => setInputs((p) => ({ ...p, budgetInput: e.target.value }))}
                    />
                    <span className="absolute right-0 bottom-3.5 text-xl text-brand-ink/30">€</span>
                  </div>
                  {(() => {
                    const perPerson = parseInt(inputs.budgetInput) || 0;
                    const totalPeople = inputs.people.adults + inputs.people.children.length;
                    const total = perPerson * totalPeople;
                    return perPerson > 0 && totalPeople > 0 ? (
                      <p className="text-xs text-brand-accent font-bold">
                        Totale: €{total.toLocaleString('it-IT')} per {totalPeople} {totalPeople === 1 ? 'persona' : 'persone'}
                      </p>
                    ) : (
                      <p className="text-[10px] text-brand-ink/30 italic">Include voli, alloggi, attività e pasti.</p>
                    );
                  })()}
                </div>
              </div>

              {/* Date */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    <Calendar className="w-3 h-3" /> Quando?
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] text-brand-ink/30 uppercase block mb-1">Partenza</span>
                      <input required type="date" className="w-full bg-transparent border-b-2 border-brand-ink/10 py-2 text-base focus:border-brand-accent outline-none transition-colors"
                        value={inputs.startDate} onChange={(e) => {
                          const newStart = e.target.value;
                          setInputs((p) => ({ 
                            ...p, 
                            startDate: newStart,
                            endDate: p.endDate && p.endDate < newStart ? newStart : p.endDate
                          }));
                        }} />
                    </div>
                    <div>
                      <span className="text-[10px] text-brand-ink/30 uppercase block mb-1">Ritorno</span>
                      <input required type="date" min={inputs.startDate} className="w-full bg-transparent border-b-2 border-brand-ink/10 py-2 text-base focus:border-brand-accent outline-none transition-colors"
                        value={inputs.endDate} onChange={(e) => setInputs((p) => ({ ...p, endDate: e.target.value }))} />
                    </div>
                  </div>
                  {inputs.startDate && inputs.endDate && (() => {
                    const nights = Math.round((new Date(inputs.endDate).getTime() - new Date(inputs.startDate).getTime()) / (1000 * 60 * 60 * 24));
                    return nights > 0 ? (
                      <p className={`text-xs mt-1 ${nights > 15 ? 'text-red-500 font-semibold' : 'text-brand-ink/40'}`}>
                        {nights} {nights === 1 ? 'notte' : 'notti'}{nights > 15 ? ' — massimo 15 notti consentite' : ''}
                      </p>
                    ) : null;
                  })()}
                  <label className="flex items-center gap-3 cursor-pointer group mt-2">
                    <div className="relative">
                      <input type="checkbox" className="sr-only" checked={inputs.isPeriodFlexible}
                        onChange={(e) => setInputs((p) => ({ ...p, isPeriodFlexible: e.target.checked }))} />
                      <div className={cn('w-10 h-5 rounded-full transition-colors duration-300', inputs.isPeriodFlexible ? 'bg-brand-accent' : 'bg-brand-ink/15')} />
                      <div className={cn('absolute top-1 left-1 w-3 h-3 bg-white rounded-full shadow transition-transform duration-300', inputs.isPeriodFlexible && 'translate-x-5')} />
                    </div>
                    <span className="text-sm text-brand-ink/50 group-hover:text-brand-ink transition-colors">Date flessibili (±3 giorni)</span>
                  </label>
                </div>

                <div className="space-y-3 md:col-span-2">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    <Home className="w-3 h-3" /> Tipologia alloggio <span className="text-brand-ink/30 normal-case tracking-normal font-normal">(puoi scegliere più opzioni)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ACCOMMODATION_OPTIONS.map((option) => {
                      const active = selectedAccommodations.includes(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => toggleAccommodation(option)}
                          className={cn(
                            'px-3 py-1.5 rounded-full text-sm border transition-all duration-200 cursor-pointer',
                            active
                              ? 'bg-brand-accent text-white border-brand-accent'
                              : 'bg-transparent text-brand-ink/50 border-brand-ink/20 hover:border-brand-accent hover:text-brand-accent'
                          )}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    <Train className="w-3 h-3" /> Preferenza Trasporto
                  </label>
                  <select
                    className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-lg focus:border-brand-accent outline-none transition-colors appearance-none cursor-pointer"
                    value={inputs.flightPreference}
                    onChange={(e) => setInputs((p) => ({ ...p, flightPreference: e.target.value }))}
                    required
                  >
                    <option value="" disabled>Seleziona un'opzione</option>
                    <option value="Volo diretto">✈️ Volo diretto</option>
                    <option value="Volo economico">💸 Volo economico (anche con scali)</option>
                    <option value="Treno">🚆 Treno</option>
                    <option value="Auto privata">🚗 Auto privata</option>
                  </select>
                </div>
              </div>

              {/* Note */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                  <MessageSquare className="w-3 h-3" /> Desideri e note
                </label>
                <textarea
                  placeholder="Es: voglio evitare le zone turistiche, preferisco ristoranti dove mangiano i locali, mi piace l'arte contemporanea…"
                  className="w-full bg-brand-ink/5 rounded-2xl p-5 min-h-[120px] text-sm leading-relaxed focus:ring-2 ring-brand-accent/20 outline-none transition-all resize-none placeholder:text-brand-ink/25"
                  value={inputs.notes}
                  onChange={(e) => setInputs((p) => ({ ...p, notes: e.target.value }))}
                />
                <NoteSuggestions selectedNotes={inputs.notes || ''} onChange={(n) => setInputs((p) => ({ ...p, notes: n }))} />
              </div>

              <button
                disabled={loading}
                type="submit"
                className="w-full bg-brand-accent text-white py-5 rounded-2xl text-lg font-bold flex items-center justify-center gap-3 hover:bg-brand-accent/85 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-accent/25 group"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Elaborazione in corso…
                  </>
                ) : (
                  <>
                    Pianifica il mio viaggio
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>
            </>
            )}
          </motion.div>
        </div>
      </div>

      {/* Profile Editor Modal */}
      {showProfileEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowProfileEditor(false)}>
          <div className="bg-white rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl relative max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowProfileEditor(false)} className="absolute top-4 right-4 text-brand-ink/40 hover:text-brand-ink text-2xl leading-none">&times;</button>
            <h2 className="text-2xl font-serif text-brand-ink mb-6">🎭 Il mio profilo viaggiatore</h2>
            {profileEditSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl mb-4 text-sm">Profilo aggiornato con successo!</div>
            )}
            {profileEditError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-4 text-sm">{profileEditError}</div>
            )}
            <ProfileForm
              value={travelerProfile}
              onChange={setTravelerProfile}
              onContinue={() => {}}  /* hide built-in button */
              compact
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowProfileEditor(false)}
                className="flex-1 py-3 rounded-2xl font-bold border-2 border-brand-ink/10 text-brand-ink/60 hover:border-brand-ink/30 hover:text-brand-ink transition-all"
              >
                Annulla
              </button>
              <button
                onClick={async () => {
                  if (user && updateAuthProfile) {
                    try {
                      setProfileEditLoading(true);
                      setProfileEditError(null);
                      await updateAuthProfile({
                        age_range: travelerProfile.ageRange,
                        traveler_type: travelerProfile.travelerType,
                        interests: travelerProfile.interests,
                        pace: travelerProfile.pace,
                        mobility: travelerProfile.mobility,
                        familiarity: travelerProfile.familiarity,
                      });
                      setProfileEditSuccess(true);
                      setTimeout(() => { setProfileEditSuccess(false); setShowProfileEditor(false); }, 1500);
                    } catch (err: any) {
                      setProfileEditError(err.message || 'Errore nel salvataggio del profilo');
                    } finally {
                      setProfileEditLoading(false);
                    }
                  }
                }}
                disabled={profileEditLoading}
                className="flex-1 bg-brand-accent text-white py-3 rounded-2xl font-bold hover:bg-brand-accent/85 transition-all disabled:opacity-50 shadow-lg shadow-brand-accent/25 flex items-center justify-center gap-2"
              >
                {profileEditLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Salvataggio...</> : 'Salva'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showChangePassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowChangePassword(false)}>
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowChangePassword(false)} className="absolute top-4 right-4 text-brand-ink/40 hover:text-brand-ink text-2xl leading-none">&times;</button>
            <h2 className="text-2xl font-serif text-brand-ink mb-6">🔑 Cambia password</h2>
            {changePasswordSuccess ? (
              <div className="text-center">
                <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                </div>
                <p className="text-brand-ink mb-4">Password aggiornata con successo!</p>
                <button onClick={() => { setShowChangePassword(false); setChangePasswordSuccess(false); }} className="w-full bg-brand-accent text-white py-3 rounded-2xl font-bold hover:bg-brand-accent/85 transition-all">
                  Chiudi
                </button>
              </div>
            ) : (
              <form onSubmit={async (e) => {
                e.preventDefault();
                if (newPassword !== confirmNewPassword) {
                  setChangePasswordError('Le password non coincidono');
                  return;
                }
                if (newPassword.length < 6) {
                  setChangePasswordError('La password deve avere almeno 6 caratteri');
                  return;
                }
                setChangePasswordLoading(true);
                setChangePasswordError(null);
                try {
                  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
                  if (updateError) {
                    setChangePasswordError(updateError.message);
                  } else {
                    setChangePasswordSuccess(true);
                    setNewPassword('');
                    setConfirmNewPassword('');
                  }
                } catch (err: any) {
                  setChangePasswordError(err.message || 'Errore durante il cambio password');
                } finally {
                  setChangePasswordLoading(false);
                }
              }} className="space-y-5">
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    Nuova password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Almeno 6 caratteri"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-base focus:border-brand-accent outline-none transition-colors placeholder:text-brand-ink/20"
                  />
                </div>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                    Conferma password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Ripeti la password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-base focus:border-brand-accent outline-none transition-colors placeholder:text-brand-ink/20"
                  />
                </div>
                {changePasswordError && (
                  <div className="text-red-500 text-sm bg-red-50 p-3 rounded-xl">{changePasswordError}</div>
                )}
                <button
                  type="submit"
                  disabled={changePasswordLoading}
                  className="w-full bg-brand-accent text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-3 hover:bg-brand-accent/85 transition-all disabled:opacity-50 shadow-lg shadow-brand-accent/25"
                >
                  {changePasswordLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Aggiorna password'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {showAuth && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowAuth(false)}>
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowAuth(false)} className="absolute top-4 right-4 text-brand-ink/40 hover:text-brand-ink text-2xl leading-none">&times;</button>
            <AuthForm onAuthSuccess={() => setShowAuth(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ROOT ───────────────────────────────────────────────────

export default function App() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [plan, setPlan] = useState<any>(null);
  const [lastInputs, setLastInputs] = useState<TravelInputs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  // Segnale per comunicare a ResultsView che il piano è stato salvato (post-login)
  const [planJustSaved, setPlanJustSaved] = useState(false);
  // Quando l'utente dalla ResultsView vuole vedere i suoi viaggi
  const [showSavedTripsFromResults, setShowSavedTripsFromResults] = useState(false);
  // Incremented each time a trip is saved — triggers reload in FormView
  const [tripsVersion, setTripsVersion] = useState(0);

  // NON auto-salviamo alla generazione: il salvataggio è esplicito (pulsante "Salva Itinerario")
  // Se l'utente non è loggato mostriamo il prompt di login
  useEffect(() => {
    if (plan && lastInputs && !user) {
      setShowLoginPrompt(true);
    }
  }, [plan]);

  // Dopo login: salva il piano pendente (da "Salva Itinerario" cliccato da utente non loggato)
  useEffect(() => {
    if (!user) return;

    // Controlla sessionStorage per un piano salvato prima del login/redirect OAuth
    const raw = sessionStorage.getItem('vagabond_pending_plan');
    if (raw) {
      sessionStorage.removeItem('vagabond_pending_plan');
      try {
        const { plan: pendingPlan, inputs: pendingInputs } = JSON.parse(raw);
        if (plan && lastInputs) {
          // Login email/password: il piano è ancora in stato React — salvalo direttamente
          const tripName = plan.destinationOverview?.title || lastInputs.destination || 'Viaggio';
          saveTrip({ trip_name: tripName, destination: lastInputs.destination, inputs: lastInputs, plan, is_favorite: false }, user.id)
            .then(() => setPlanJustSaved(true))
            .catch(err => console.error('Post-login save failed:', err));
        } else if (pendingPlan) {
          // OAuth redirect: pagina ricaricata, ripristina il piano
          setLastInputs(pendingInputs);
          setPlan(pendingPlan);
          // Il salvataggio verrà fatto dal pulsante o dall'effect post-login alla prossima iterazione
        }
      } catch (_) {}
      return;
    }

    // Fallback: salva se il prompt di login era visibile (vecchio flusso)
    if (plan && lastInputs && showLoginPrompt) {
      const tripName = plan.destinationOverview?.title || lastInputs.destination || 'Viaggio';
      saveTrip({
        trip_name: tripName,
        destination: lastInputs.destination,
        inputs: lastInputs,
        plan,
        is_favorite: false,
      }, user.id).then(() => {
        setShowLoginPrompt(false);
        setPlanJustSaved(true);
      }).catch((err) => console.error('Auto-save trip failed:', err));
    }
  }, [user]);

  const handleSubmit = async (inputs: TravelInputs) => {
    setLoading(true);
    setLoadingStep('Inizializzazione...');
    setLoadingProgress(0);
    setError(null);
    try {
      setLastInputs(inputs);
      const result = await generateTravelPlan(inputs, (step, progress) => {
        setLoadingStep(step);
        setLoadingProgress(progress);
      });
      const sanitizedResult = await sanitizeTravelPlanAsync(result, { startDate: inputs.startDate, endDate: inputs.endDate, people: inputs.people });
      setPlan(sanitizedResult);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      console.error('Error generating plan:', err);
      // Show the actual error message from the backend
      setError(err.message || 'Si è verificato un errore durante la generazione del piano. Riprova tra qualche istante.');
    } finally {
      setLoading(false);
    }
  };

  const handleModify = async (request: string) => {
    if (!lastInputs || !plan) return;
    setLoading(true);
    setLoadingStep('Aggiorno l\'itinerario...');
    setLoadingProgress(0);
    setError(null);
    try {
      const modifiedInputs = {
        ...lastInputs,
        modificationRequest: request,
        previousPlan: plan
      };
      const result = await generateTravelPlan(modifiedInputs, (step, progress) => {
        setLoadingStep(step);
        setLoadingProgress(progress);
      });
      const sanitizedResult = await sanitizeTravelPlanAsync(result, { startDate: modifiedInputs.startDate, endDate: modifiedInputs.endDate, people: modifiedInputs.people });
      setPlan(sanitizedResult);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      console.error('Error modifying plan:', err);
      setError(err.message || 'Si è verificato un errore durante l\'aggiornamento del piano. Riprova tra qualche istante.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {loading && <LoadingScreen step={loadingStep} progress={loadingProgress} />}
      {error && !loading && (
        <div className="min-h-screen bg-brand-paper flex items-center justify-center p-6">
          <div className="max-w-md text-center">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-2xl mb-3">Errore</h2>
            <p className="text-brand-ink/60 mb-6">{error}</p>
            <button onClick={() => setError(null)} className="bg-brand-accent text-white px-6 py-3 rounded-2xl font-bold hover:bg-brand-accent/85 transition-colors">
              Riprova
            </button>
          </div>
        </div>
      )}
      {!loading && !error && plan && <ResultsView plan={plan} inputs={lastInputs} onReset={() => setPlan(null)} onShowTrips={() => { setPlan(null); setShowSavedTripsFromResults(true); }} onModify={handleModify} onUpdatePlan={(newPlan) => setPlan(newPlan)} onShowAuth={() => setShowAuth(true)} planJustSaved={planJustSaved} onPlanJustSavedAck={() => setPlanJustSaved(false)} onTripSaved={() => { setTripsVersion(v => v + 1); }} />}
      {!loading && !error && !plan && <FormView onSubmit={handleSubmit} loading={loading} initialShowTrips={showSavedTripsFromResults} onShowTripsDone={() => setShowSavedTripsFromResults(false)} onLoadTrip={(trip) => { setLastInputs(trip.inputs); setPlan(trip.plan); }} tripsVersion={tripsVersion} />}

      {/* Login prompt modal for saving trips when not authenticated */}
      <AnimatePresence>
        {showLoginPrompt && !user && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowLoginPrompt(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button onClick={() => setShowLoginPrompt(false)} className="absolute top-4 right-4 text-brand-ink/40 hover:text-brand-ink text-2xl leading-none">&times;</button>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-brand-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Plane className="w-8 h-8 text-brand-accent" />
                </div>
                <h3 className="text-xl font-serif text-brand-ink mb-2">Vuoi salvare il tuo viaggio?</h3>
                <p className="text-sm text-brand-ink/60">Effettua l'accesso o registrati per salvare il tuo itinerario e ritrovarlo in qualsiasi momento.</p>
              </div>
              <div className="space-y-3">
                <button
                  onClick={() => { setShowLoginPrompt(false); setShowAuth(true); }}
                  className="w-full bg-brand-accent text-white py-3 rounded-2xl font-bold hover:bg-brand-accent/85 transition-all shadow-lg shadow-brand-accent/25"
                >
                  Accedi o Registrati
                </button>
                <button
                  onClick={() => setShowLoginPrompt(false)}
                  className="w-full text-brand-ink/50 py-2 text-sm hover:text-brand-ink/70 transition-colors"
                >
                  Continua senza salvare
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auth Modal */}
      {showAuth && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowAuth(false)}>
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowAuth(false)} className="absolute top-4 right-4 text-brand-ink/40 hover:text-brand-ink text-2xl leading-none">&times;</button>
            <AuthForm onAuthSuccess={() => setShowAuth(false)} />
          </div>
        </div>
      )}
    </>
  );
}
