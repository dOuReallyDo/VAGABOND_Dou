import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Users, Heart, Backpack, Briefcase, Baby, GraduationCap, Mountain,
  Accessibility, Eye, Compass, ArrowRight
} from 'lucide-react';
import { cn } from '../App';

// =============================================
// Constants
// =============================================

const AGE_RANGES = [
  { value: '18-25', label: '18–25', emoji: '🎓' },
  { value: '26-35', label: '26–35', emoji: '💼' },
  { value: '36-45', label: '36–45', emoji: '❤️' },
  { value: '46-55', label: '46–55', emoji: '🏔️' },
  { value: '56-65', label: '56–65', emoji: '🌅' },
  { value: '65+', label: '65+', emoji: '🧓' },
];

const TRAVELER_TYPES = [
  { value: 'Solo/a', label: 'Solo/a me', emoji: '🧑‍💻', desc: 'Esploro a modo mio' },
  { value: 'Coppia romantica', label: 'Coppia romantica', emoji: '💑', desc: 'Viaggi per due' },
  { value: 'Famiglia con bimbi piccoli', label: 'Famiglia (0-5 anni)', emoji: '👶', desc: 'Bimbi piccoli al seguito' },
  { value: 'Famiglia con ragazzi', label: 'Famiglia (6-17 anni)', emoji: '👨‍👩‍👧‍👦', desc: 'Ragazzi e avventura' },
  { value: 'Gruppo di amici', label: 'Gruppo amici', emoji: '🎉', desc: 'Divertimento insieme' },
  { value: 'Viaggio di lavoro', label: 'Business', emoji: '💼', desc: 'Lavoro + tempo libero' },
];

const INTERESTS = [
  { value: 'Cultura', label: 'Cultura', emoji: '🏛️' },
  { value: 'Mare', label: 'Mare', emoji: '🏖️' },
  { value: 'Food & Wine', label: 'Food & Wine', emoji: '🍝' },
  { value: 'Natura', label: 'Natura', emoji: '🥾' },
  { value: 'Sport', label: 'Sport', emoji: '🎿' },
  { value: 'Shopping', label: 'Shopping', emoji: '🛍️' },
  { value: 'Nightlife', label: 'Nightlife', emoji: '🎉' },
  { value: 'Benessere', label: 'Benessere', emoji: '🧘' },
  { value: 'Foto', label: 'Foto', emoji: '📸' },
  { value: 'Intrattenimento', label: 'Intrattenimento', emoji: '🎰' },
  { value: 'Avventura', label: 'Avventura', emoji: '🪂' },
  { value: 'Storia', label: 'Storia', emoji: '📜' },
];

const PACES = [
  { value: 'Slow & relax', label: 'Slow & relax', emoji: '🌴', desc: '2-3 attività/giorno, pranzi lunghi' },
  { value: 'Equilibrato', label: 'Equilibrato', emoji: '⚖️', desc: '3-4 attività/giorno' },
  { value: 'Avventura intensa', label: 'Avventura intensa', emoji: '🏃', desc: '4-5 attività/giorno, alzataccia!' },
];

const MOBILITIES = [
  { value: 'Nessuna limitazione', label: 'Nessuna limitazione', emoji: '🚶' },
  { value: 'Ridotta', label: 'Ridotta (scale/lunghe camminate)', emoji: '♿' },
  { value: 'A carrozzina', label: 'A carrozzina', emoji: '🦽' },
];

const FAMILIARITIES = [
  { value: 'Mai stato qui', label: 'Mai stato qui', emoji: '🆕' },
  { value: 'Ci sono già stato', label: 'Ci sono già stato', emoji: '🔁' },
  { value: 'Esperto della zona', label: 'Esperto della zona', emoji: '🗺️' },
];

// =============================================
// Quick Presets
// =============================================

export const QUICK_PRESETS = [
  {
    id: 'digital-nomad',
    label: '🧑‍💻 Digital Nomad',
    profile: { ageRange: '26-35', travelerType: 'Solo/a', interests: ['Cultura', 'Food & Wine', 'Foto'], pace: 'Slow & relax', mobility: 'Nessuna limitazione', familiarity: 'Mai stato qui' },
  },
  {
    id: 'honeymoon',
    label: '💑 Luna di Miele',
    profile: { ageRange: '26-35', travelerType: 'Coppia romantica', interests: ['Mare', 'Food & Wine', 'Benessere'], pace: 'Slow & relax', mobility: 'Nessuna limitazione', familiarity: 'Mai stato qui' },
  },
  {
    id: 'family-young',
    label: '👨‍👩‍👧 Famiglia Giovane',
    profile: { ageRange: '36-45', travelerType: 'Famiglia con bimbi piccoli', interests: ['Mare', 'Intrattenimento', 'Natura'], pace: 'Slow & relax', mobility: 'Nessuna limitazione', familiarity: 'Mai stato qui' },
  },
  {
    id: 'backpacker',
    label: '🎒 Backpacker',
    profile: { ageRange: '18-25', travelerType: 'Solo/a', interests: ['Natura', 'Avventura', 'Culture'], pace: 'Avventura intensa', mobility: 'Nessuna limitazione', familiarity: 'Mai stato qui' },
  },
  {
    id: 'silver',
    label: '🌅 Silver Traveler',
    profile: { ageRange: '56-65', travelerType: 'Coppia romantica', interests: ['Cultura', 'Benessere', 'Natura'], pace: 'Slow & relax', mobility: 'Ridotta (scale/lunghe camminate)', familiarity: 'Mai stato qui' },
  },
];

// =============================================
// Profile Form Component
// =============================================

export interface TravelerProfileForm {
  ageRange: string;
  travelerType: string;
  interests: string[];
  pace: string;
  mobility: string;
  familiarity: string;
}

interface ProfileFormProps {
  value: TravelerProfileForm;
  onChange: (profile: TravelerProfileForm) => void;
  onContinue: () => void;
  compact?: boolean;
}

export function ProfileForm({ value, onChange, onContinue, compact = false }: ProfileFormProps) {
  const toggleInterest = (interest: string) => {
    const current = value.interests;
    if (current.includes(interest)) {
      onChange({ ...value, interests: current.filter((i) => i !== interest) });
    } else if (current.length < 5) {
      onChange({ ...value, interests: [...current, interest] });
    }
  };

  const applyPreset = (preset: typeof QUICK_PRESETS[number]) => {
    onChange(preset.profile);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-10">
      {/* Quick Presets */}
      {!compact && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest font-bold text-brand-ink/40 mb-3">
            ✨ Profilo rapido — tocca per compilare tutto
          </h3>
          <div className="flex flex-wrap gap-2">
            {QUICK_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className="px-3 py-2 rounded-xl text-sm border border-brand-ink/10 hover:border-brand-accent hover:bg-brand-accent/5 transition-all"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Age Range */}
      <div>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40 mb-3">
          Quanti anni hai?
        </label>
        <div className="flex flex-wrap gap-2">
          {AGE_RANGES.map((ar) => (
            <button
              key={ar.value}
              type="button"
              onClick={() => onChange({ ...value, ageRange: ar.value })}
              className={cn(
                'px-4 py-2.5 rounded-xl text-sm font-medium border transition-all',
                value.ageRange === ar.value
                  ? 'bg-brand-accent text-white border-brand-accent shadow-lg shadow-brand-accent/25'
                  : 'bg-transparent text-brand-ink/60 border-brand-ink/15 hover:border-brand-accent'
              )}
            >
              {ar.emoji} {ar.label}
            </button>
          ))}
        </div>
      </div>

      {/* Traveler Type */}
      <div>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40 mb-3">
          Chi viaggia?
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {TRAVELER_TYPES.map((tt) => (
            <button
              key={tt.value}
              type="button"
              onClick={() => onChange({ ...value, travelerType: tt.value })}
              className={cn(
                'p-3 rounded-xl text-left border transition-all',
                value.travelerType === tt.value
                  ? 'bg-brand-accent/10 border-brand-accent shadow-sm'
                  : 'bg-transparent border-brand-ink/10 hover:border-brand-accent/50'
              )}
            >
              <span className="text-lg">{tt.emoji}</span>
              <div className="text-sm font-medium mt-1">{tt.label}</div>
              <div className="text-[10px] text-brand-ink/40">{tt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Interests */}
      <div>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40 mb-1">
          I tuoi interessi <span className="normal-case font-normal">(max 5)</span>
        </label>
        <div className="flex flex-wrap gap-2 mt-3">
          {INTERESTS.map((int) => {
            const selected = value.interests.includes(int.value);
            return (
              <button
                key={int.value}
                type="button"
                onClick={() => toggleInterest(int.value)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm border transition-all',
                  selected
                    ? 'bg-brand-accent text-white border-brand-accent'
                    : 'bg-transparent text-brand-ink/50 border-brand-ink/15 hover:border-brand-accent hover:text-brand-accent'
                )}
              >
                {int.emoji} {int.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pace */}
      <div>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40 mb-3">
          Quanto vuoi muoverti?
        </label>
        <div className="grid grid-cols-3 gap-3">
          {PACES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange({ ...value, pace: p.value })}
              className={cn(
                'p-3 rounded-xl text-center border transition-all',
                value.pace === p.value
                  ? 'bg-brand-accent/10 border-brand-accent shadow-sm'
                  : 'bg-transparent border-brand-ink/10 hover:border-brand-accent/50'
              )}
            >
              <div className="text-lg">{p.emoji}</div>
              <div className="text-xs font-bold mt-1">{p.label}</div>
              <div className="text-[10px] text-brand-ink/40 mt-0.5">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Mobility & Familiarity - side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40 mb-3">
            Mobilità
          </label>
          <div className="space-y-2">
            {MOBILITIES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => onChange({ ...value, mobility: m.value })}
                className={cn(
                  'w-full text-left px-4 py-2.5 rounded-xl text-sm border transition-all',
                  value.mobility === m.value
                    ? 'bg-brand-accent/10 border-brand-accent'
                    : 'bg-transparent border-brand-ink/10 hover:border-brand-accent/50'
                )}
              >
                {m.emoji} {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40 mb-3">
            Conosci la destinazione?
          </label>
          <div className="space-y-2">
            {FAMILIARITIES.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => onChange({ ...value, familiarity: f.value })}
                className={cn(
                  'w-full text-left px-4 py-2.5 rounded-xl text-sm border transition-all',
                  value.familiarity === f.value
                    ? 'bg-brand-accent/10 border-brand-accent'
                    : 'bg-transparent border-brand-ink/10 hover:border-brand-accent/50'
                )}
              >
                {f.emoji} {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Continue button — hidden in compact/modal mode */}
      {!compact && (
        <button
          type="button"
          onClick={onContinue}
          className="w-full bg-brand-accent text-white py-4 rounded-2xl text-lg font-bold flex items-center justify-center gap-3 hover:bg-brand-accent/85 transition-all shadow-lg shadow-brand-accent/25 group"
        >
          Continua con il viaggio
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>
      )}
    </motion.div>
  );
}