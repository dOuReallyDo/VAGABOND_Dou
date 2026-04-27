import { describe, it, expect } from 'vitest';
import {
  isUrlSafe,
  isWhitelistedUrl,
  getBookingSearchUrl,
  getTripAdvisorSearchUrl,
  getGoogleMapsUrl,
  getSafeAlternative,
  sanitizeTravelPlan,
} from '../lib/urlSafety';
import type { TravelPlan } from '../shared/contract';

// ─── isUrlSafe ──────────────────────────────────────────────────────

describe('isUrlSafe', () => {
  describe('whitelisted domains', () => {
    it('accepts booking.com URLs', () => {
      const result = isUrlSafe('https://www.booking.com/hotel/it/hotel-danieli.html');
      expect(result.isSafe).toBe(true);
      expect(result.category).toBe('whitelisted');
      expect(result.safeUrl).toBe('https://www.booking.com/hotel/it/hotel-danieli.html');
    });

    it('accepts tripadvisor.it URLs', () => {
      const result = isUrlSafe('https://www.tripadvisor.it/Hotel_Review-g187870-d234567-Reviews-Hotel_Danieli-Venice_Veneto.html');
      expect(result.isSafe).toBe(true);
      expect(result.category).toBe('whitelisted');
    });

    it('accepts airbnb.com URLs', () => {
      const result = isUrlSafe('https://www.airbnb.com/rooms/123456');
      expect(result.isSafe).toBe(true);
    });

    it('accepts airline official sites', () => {
      expect(isUrlSafe('https://www.tap.pt/en/').isSafe).toBe(true);
      expect(isUrlSafe('https://www.ryanair.com/it/it').isSafe).toBe(true);
      expect(isUrlSafe('https://www.easyjet.com/it').isSafe).toBe(true);
    });

    it('accepts government sites', () => {
      expect(isUrlSafe('https://www.viaggiaresicuri.it/scheda-paese/cabo-verde').isSafe).toBe(true);
      expect(isUrlSafe('https://www.esteri.it/it/servizi-in-rete/scheda-paese').isSafe).toBe(true);
    });

    it('accepts picsum.photos (image provider)', () => {
      expect(isUrlSafe('https://picsum.photos/seed/hotel/800/600').isSafe).toBe(true);
    });

    it('accepts subdomains of whitelisted domains', () => {
      // pages.booking.com, content.tripadvisor.it, etc.
      expect(isUrlSafe('https://pages.booking.com/hotel/it/example').isSafe).toBe(true);
      expect(isUrlSafe('https://content.tripadvisor.it/media').isSafe).toBe(true);
    });
  });

  describe('structurally invalid URLs', () => {
    it('rejects empty URLs', () => {
      const result = isUrlSafe('');
      expect(result.isSafe).toBe(false);
      expect(result.category).toBe('invalid');
    });

    it('rejects URLs without protocol', () => {
      const result = isUrlSafe('www.example.com/hotel');
      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('no protocol');
    });

    it('rejects HTTP URLs (not encrypted)', () => {
      const result = isUrlSafe('http://www.booking.com/hotel/it/example');
      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('HTTP');
    });

    it('rejects IP address URLs', () => {
      const result = isUrlSafe('https://192.168.1.1/malware.exe');
      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('IP address');
    });

    it('rejects URL shorteners', () => {
      expect(isUrlSafe('https://bit.ly/3abc123').isSafe).toBe(false);
      expect(isUrlSafe('https://tinyurl.com/abc123').isSafe).toBe(false);
      expect(isUrlSafe('https://t.co/abc123').isSafe).toBe(false);
    });

    it('rejects suspicious redirect parameters', () => {
      expect(isUrlSafe('https://example.com?redirect=https://evil.com').isSafe).toBe(false);
      expect(isUrlSafe('https://example.com?url=https://evil.com').isSafe).toBe(false);
      expect(isUrlSafe('https://example.com?dest=https://evil.com').isSafe).toBe(false);
    });

    it('rejects suspicious TLDs', () => {
      expect(isUrlSafe('https://www.hoteldeals.tk').isSafe).toBe(false);
      expect(isUrlSafe('https://www.cheapflights.xyz').isSafe).toBe(false);
      expect(isUrlSafe('https://www.bestdeals.icu').isSafe).toBe(false);
    });
  });

  describe('unknown domains', () => {
    it('flags unknown but structurally valid URLs as needing verification', () => {
      const result = isUrlSafe('https://www.some-random-hotel-site.com/rooms');
      expect(result.isSafe).toBe(false); // Not safe until verified
      expect(result.category).toBe('valid-unknown');
      expect(result.reason).toContain('Unknown domain');
    });

    it('flags a hotel official site that is unknown as valid-unknown', () => {
      const result = isUrlSafe('https://www.hotelcapodimonte.it/');
      expect(result.isSafe).toBe(false);
      expect(result.category).toBe('valid-unknown');
    });
  });
});

// ─── isWhitelistedUrl ────────────────────────────────────────────────

describe('isWhitelistedUrl', () => {
  it('returns true for whitelisted domains', () => {
    expect(isWhitelistedUrl('https://www.booking.com/hotel')).toBe(true);
  });

  it('returns false for unknown domains', () => {
    expect(isWhitelistedUrl('https://www.example.com')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isWhitelistedUrl('')).toBe(false);
    expect(isWhitelistedUrl('not-a-url')).toBe(false);
  });

  it('returns false for HTTP URLs', () => {
    expect(isWhitelistedUrl('http://www.booking.com/hotel')).toBe(false);
  });

  it('returns false for IP addresses', () => {
    expect(isWhitelistedUrl('https://192.168.1.1/path')).toBe(false);
  });
});

// ─── Safe Alternative Generators ──────────────────────────────────────

describe('getBookingSearchUrl', () => {
  it('generates a Booking.com search URL', () => {
    const url = getBookingSearchUrl('Hotel Danieli', 'Venezia');
    expect(url).toContain('booking.com/searchresults');
    expect(url).toContain('Hotel%20Danieli');
    expect(url).toContain('Venezia');
  });
});

describe('getTripAdvisorSearchUrl', () => {
  it('generates a TripAdvisor search URL', () => {
    const url = getTripAdvisorSearchUrl('Ristorante Quadri', 'Venezia');
    expect(url).toContain('tripadvisor.it/Search');
    expect(url).toContain('Quadri');
  });
});

describe('getGoogleMapsUrl', () => {
  it('generates a Google Maps search URL', () => {
    const url = getGoogleMapsUrl('Colosseo', 'Roma');
    expect(url).toContain('google.com/maps/search');
    expect(url).toContain('Colosseo');
  });
});

// ─── getSafeAlternative ───────────────────────────────────────────────

describe('getSafeAlternative', () => {
  it('generates Booking.com search for hotels', () => {
    const alt = getSafeAlternative('https://evil-hotel.com/booking', 'hotel', {
      name: 'Hotel Danieli',
      city: 'Venezia',
      checkin: '2025-06-01',
      checkout: '2025-06-05',
      adults: 2,
    });
    expect(alt).toContain('booking.com');
    expect(alt).toContain('Hotel%20Danieli');
    expect(alt).toContain('2025-06-01');
  });

  it('generates TripAdvisor search for restaurants', () => {
    const alt = getSafeAlternative('https://bad-restaurant.com', 'restaurant', {
      name: 'Ristorante Quadri',
      city: 'Venezia',
    });
    expect(alt).toContain('tripadvisor.it');
    expect(alt).toContain('Quadri');
  });

  it('generates TripAdvisor search for attractions', () => {
    const alt = getSafeAlternative('https://sketchy-attraction.com', 'attraction', {
      name: 'Colosseo',
      city: 'Roma',
    });
    expect(alt).toContain('tripadvisor.it');
  });

  it('generates airline search for flights', () => {
    const alt = getSafeAlternative('https://unknown-airline.com', 'flight', {
      name: 'TAP Air Portugal',
    });
    expect(alt).toContain('google.com/search');
    expect(alt).toContain('TAP');
  });

  it('generates Google Maps for transport', () => {
    const alt = getSafeAlternative('https://shady-transfer.com', 'transport', {
      name: 'Airport Transfer',
      city: 'Lisbona',
    });
    expect(alt).toContain('google.com/maps');
  });

  it('returns null for blogs with no name', () => {
    const alt = getSafeAlternative('https://some-blog.com/post', 'blog', {});
    expect(alt).toBeNull();
  });

  it('returns Google search for generic with a name', () => {
    const alt = getSafeAlternative('https://random.com/page', 'generic', {
      name: 'Viaggio in Portogallo',
    });
    expect(alt).toContain('google.com/search');
  });

  it('returns null for generic without a name', () => {
    const alt = getSafeAlternative('https://random.com/page', 'generic', {});
    expect(alt).toBeNull();
  });
});

// ─── sanitizeTravelPlan ───────────────────────────────────────────────

describe('sanitizeTravelPlan', () => {
  // Helper to create a minimal valid TravelPlan
  const createMockPlan = (): TravelPlan => ({
    destinationOverview: {
      title: 'Lisbona',
      description: 'Bellissima città',
      attractions: [
        {
          name: 'Torre di Belém',
          description: 'Iconica torre',
          sourceUrl: 'https://www.booking.com/attraction/lisbona/torre-belem',
          category: 'Monumento',
          estimatedVisitTime: '2 ore',
          lat: 38.6916,
          lng: -9.2158,
        },
        {
          name: 'Mosteiro dos Jerónimos',
          description: 'Monastero storico',
          sourceUrl: 'https://shady-site.xyz/monastero',
          category: 'Monumento',
        },
      ],
      heroImageUrl: 'https://picsum.photos/seed/lisbona/800/600',
      tagline: 'Città della luce',
    },
    weatherInfo: {
      summary: 'Sole',
      pros: 'Clima mite',
      cons: 'Ventoso',
    },
    safetyAndHealth: {
      safetyWarnings: 'Normale',
      vaccinationsRequired: 'Nessuna',
    },
    itinerary: [
      {
        day: 1,
        title: 'Giorno 1',
        activities: [
          {
            time: '09:00',
            location: 'Torre di Belém',
            name: 'Visita alla Torre',
            description: 'Esplora la torre',
            sourceUrl: 'http://www.sketchy-hotel.com/torre',
            costEstimate: 10,
          },
          {
            time: '14:00',
            location: 'Pastéis de Belém',
            name: 'Pasticceria',
            description: 'Assaggia i pastéis',
            sourceUrl: 'https://www.tripadvisor.it/Restaurant_Review-g189158-d12345',
          },
        ],
      },
    ],
    budgetBreakdown: {
      flights: 200,
      accommodation: 300,
      activities: 100,
      food: 150,
      totalEstimated: 750,
    },
    flights: [
      {
        segmentName: 'Volo andata',
        options: [
          {
            airline: 'TAP Portugal',
            route: 'Milano → Lisbona',
            estimatedPrice: 150,
            bookingUrl: 'https://www.tap.pt/it/',
            verified: false,
          },
        ],
      },
    ],
    accommodations: [
      {
        stopName: 'Lisbona',
        nights: 4,
        options: [
          {
            name: 'Hotel Altis',
            type: 'Hotel',
            rating: 4.5,
            reviewSummary: 'Ottima posizione',
            estimatedPricePerNight: 120,
            bookingUrl: 'https://malware-site.ru/hotel',
            stars: 4,
          },
          {
            name: 'Hotel do Chiado',
            type: 'Hotel',
            rating: 4.2,
            reviewSummary: 'Bella vista',
            estimatedPricePerNight: 95,
            bookingUrl: 'https://www.booking.com/hotel/pt/hotel-do-chiado.html',
            stars: 4,
          },
        ],
      },
    ],
    bestRestaurants: [
      {
        stopName: 'Lisbona',
        options: [
          {
            name: 'Cervejaria Ramiro',
            cuisineType: 'Pesce',
            rating: 4.7,
            reviewSummary: 'Miglior pesce di Lisbona',
            sourceUrl: 'https://bit.ly/3abc123',
            priceRange: '€€€',
          },
        ],
      },
    ],
    transportInfo: {
      localTransport: 'Metro e tram',
      bestApps: ['Uber', 'Bolt'],
      privateTransferLinks: [
        {
          provider: 'Airport Shuttle',
          url: 'https://www.booking.com/transfer/lisbona-airport',
          description: 'Transfer dall\'aeroporto',
        },
        {
          provider: 'Shady Transfers',
          url: 'https://192.168.1.1/transfer',
          description: 'Transfer economico',
        },
      ],
    },
    travelBlogs: [
      {
        title: 'Guida a Lisbona',
        url: 'https://www.lonelyplanet.com/portugal/lisbon',
        description: 'Guida completa',
      },
      {
        title: 'Blog sospetto',
        url: 'https://shady-travel-blog.xyz/lisbona',
        description: 'Blog inaffidabile',
      },
    ],
  });

  const travelInputs = {
    startDate: '2025-06-01',
    endDate: '2025-06-05',
    people: { adults: 2, children: [] },
  };

  it('keeps whitelisted URLs unchanged', () => {
    const plan = createMockPlan();
    const sanitized = sanitizeTravelPlan(plan, travelInputs);

    // booking.com attraction URL should be kept
    const attraction = sanitized.destinationOverview!.attractions[0];
    expect(attraction.sourceUrl).toBe('https://www.booking.com/attraction/lisbona/torre-belem');

    // tripadvisor restaurant URL should be kept
    const restaurant = sanitized.bestRestaurants![0].options[0];
    // sourceUrl was bit.ly — should have been REPLACED, not kept
    // (we test this below)

    // tap.pt flight URL should be kept
    const flight = sanitized.flights![0].options[0];
    expect(flight.bookingUrl).toBe('https://www.tap.pt/it/');

    // booking.com accommodation URL should be kept
    const accommodation = sanitized.accommodations![0].options[1];
    expect(accommodation.bookingUrl).toBe('https://www.booking.com/hotel/pt/hotel-do-chiado.html');
  });

  it('replaces suspicious TLD URLs with safe alternatives', () => {
    const plan = createMockPlan();
    const sanitized = sanitizeTravelPlan(plan, travelInputs);

    // .xyz domain → should be replaced
    const attraction = sanitized.destinationOverview!.attractions[1];
    expect(attraction.sourceUrl).not.toContain('shady-site.xyz');
    expect(attraction.sourceUrl).toContain('tripadvisor.it');
  });

  it('replaces HTTP URLs with safe alternatives', () => {
    const plan = createMockPlan();
    const sanitized = sanitizeTravelPlan(plan, travelInputs);

    // http://sketchy-hotel.com sourceUrl for activity → replaced
    const activity = sanitized.itinerary[0].activities[0];
    expect(activity.sourceUrl).not.toContain('sketchy-hotel.com');
    expect(activity.sourceUrl).toContain('tripadvisor.it');
  });

  it('replaces IP address accommodation URLs with Booking search', () => {
    const plan = createMockPlan();
    const sanitized = sanitizeTravelPlan(plan, travelInputs);

    // malware-site.ru → replaced with Booking search
    const hotel = sanitized.accommodations![0].options[0];
    expect(hotel.bookingUrl).not.toContain('malware-site');
    expect(hotel.bookingUrl).toContain('booking.com');
    expect(hotel.bookingUrl).toContain('Hotel%20Altis');
  });

  it('replaces URL shortener restaurant URLs with TripAdvisor', () => {
    const plan = createMockPlan();
    const sanitized = sanitizeTravelPlan(plan, travelInputs);

    // bit.ly → replaced with TripAdvisor search
    const restaurant = sanitized.bestRestaurants![0].options[0];
    expect(restaurant.sourceUrl).not.toContain('bit.ly');
    expect(restaurant.sourceUrl).toContain('tripadvisor.it');
  });

  it('removes IP address transport URLs', () => {
    const plan = createMockPlan();
    const sanitized = sanitizeTravelPlan(plan, travelInputs);

    // Only the safe transfer link should remain
    const transfers = sanitized.transportInfo!.privateTransferLinks!;
    expect(transfers).toHaveLength(1);
    expect(transfers[0].url).toContain('booking.com');
  });

  it('removes unsafe blog URLs entirely', () => {
    const plan = createMockPlan();
    const sanitized = sanitizeTravelPlan(plan, travelInputs);

    // Lonely Planet stays, shady-travel-blog.xyz is removed
    expect(sanitized.travelBlogs).toHaveLength(1);
    expect(sanitized.travelBlogs![0].url).toContain('lonelyplanet.com');
  });

  it('preserves picsum.photos image URLs', () => {
    const plan = createMockPlan();
    const sanitized = sanitizeTravelPlan(plan, travelInputs);

    expect(sanitized.destinationOverview!.heroImageUrl).toBe('https://picsum.photos/seed/lisbona/800/600');
  });

  it('does not mutate the original plan', () => {
    const plan = createMockPlan();
    const originalFlights = plan.flights![0].options[0].bookingUrl;
    sanitizeTravelPlan(plan, travelInputs);
    expect(plan.flights![0].options[0].bookingUrl).toBe(originalFlights);
  });
});