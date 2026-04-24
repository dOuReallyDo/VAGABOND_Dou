import { z } from "zod";

// --- Input Schema ---

export const TravelInputsSchema = z.object({
  people: z.object({
    adults: z.number().min(1),
    children: z.array(z.object({ age: z.number() })),
  }),
  budget: z.number().min(100),
  departureCity: z.string().min(2),
  departureCountry: z.string().optional(),
  destination: z.string().min(2),
  country: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  isPeriodFlexible: z.boolean(),
  accommodationType: z.string(),
  stopover: z.string().optional(),
  departureTimePreference: z.string().optional(),
  flightPreference: z.string().optional(),
  notes: z.string().optional(),
  modificationRequest: z.string().optional(),
  previousPlan: z.any().optional(),
  travelerProfile: z.object({
    ageRange: z.string().optional(),
    travelerType: z.string().optional(),
    interests: z.array(z.string()).optional(),
    pace: z.string().optional(),
    mobility: z.string().optional(),
    familiarity: z.string().optional(),
  }).optional(),
});

export type TravelInputs = z.infer<typeof TravelInputsSchema>;

// --- Output Schema (Travel Plan) ---

export const TravelPlanSchema = z.object({
  budgetWarning: z.string().nullable(),
  destinationOverview: z.object({
    title: z.string(),
    description: z.string(),
    attractions: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        sourceUrl: z.string().optional(),
        category: z.string().optional(),
        estimatedVisitTime: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      })
    ),
    heroImageUrl: z.string().optional(),
    tagline: z.string().optional(),
  }),
  weatherInfo: z.object({
    summary: z.string(),
    pros: z.string(),
    cons: z.string(),
    averageTemp: z.string().optional(),
    packingTips: z.string().optional(),
  }),
  safetyAndHealth: z.object({
    safetyWarnings: z.string(),
    vaccinationsRequired: z.string(),
    safetyLevel: z.string().optional(),
    emergencyNumbers: z.string().optional(),
  }),
  itinerary: z.array(
    z.object({
      day: z.number(),
      title: z.string(),
      theme: z.string().optional(),
      activities: z.array(
        z.object({
          time: z.string(),
          location: z.string().optional(),
          name: z.string().optional(),
          description: z.string(),
          costEstimate: z.number().optional(),
          sourceUrl: z.string().optional(),
          imageUrl: z.string().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
          duration: z.string().optional(),
          transport: z.string().optional(),
          travelTime: z.string().optional(),
          tips: z.string().optional(),
        })
      ),
    })
  ),
  budgetBreakdown: z.object({
    flights: z.number(),
    accommodation: z.number(),
    activities: z.number(),
    food: z.number(),
    totalEstimated: z.number(),
    transport: z.number().optional(),
    misc: z.number().optional(),
    perPersonPerDay: z.number().optional(),
  }),
  flights: z.array(
    z.object({
      segmentName: z.string(),
      options: z.array(
        z.object({
          airline: z.string(),
          route: z.string(),
          estimatedPrice: z.number(),
          date: z.string().optional(),
          options: z.array(z.string()).optional(),
          departureTime: z.string().optional().nullable(),
          arrivalTime: z.string().optional().nullable(),
          duration: z.string().optional().nullable(),
          returnDepartureTime: z.string().optional().nullable(),
          returnArrivalTime: z.string().optional().nullable(),
          returnDuration: z.string().optional().nullable(),
          type: z.string().optional(),
          bookingUrl: z.string().optional(),
          verified: z.boolean().optional(),
        })
      )
    })
  ).optional(),
  accommodations: z.array(
    z.object({
      stopName: z.string(),
      nights: z.number().optional(),
      options: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          rating: z.number().optional(),
          reviewSummary: z.string().optional(),
          estimatedPricePerNight: z.number(),
          bookingUrl: z.string().optional(),
          imageUrl: z.string().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
          address: z.string().optional(),
          amenities: z.array(z.string()).optional(),
          stars: z.number().optional(),
        })
      ),
    })
  ).optional(),
  bestRestaurants: z.array(
    z.object({
      stopName: z.string(),
      options: z.array(
        z.object({
          name: z.string(),
          cuisineType: z.string(),
          rating: z.number().optional(),
          reviewSummary: z.string().optional(),
          sourceUrl: z.string().optional(),
          priceRange: z.string(),
          imageUrl: z.string().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
          address: z.string().optional(),
          mustTry: z.string().optional(),
        })
      )
    })
  ).optional(),
  mapPoints: z.array(
    z.object({
      lat: z.number(),
      lng: z.number(),
      label: z.string(),
      type: z.string().optional(),
    })
  ).optional(),
  localTips: z.array(z.string()).optional(),
  transportInfo: z.object({
    localTransport: z.string().optional(),
    bestApps: z.array(z.string()).optional(),
    estimatedLocalCost: z.string().optional(),
    privateTransferLinks: z.array(
      z.object({
        provider: z.string(),
        url: z.string(),
        description: z.string().optional(),
      })
    ).optional(),
  }).optional(),
  travelBlogs: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      description: z.string().optional(),
    })
  ).optional(),
  travelHighlights: z.object({
    whyChosen: z.string(),
    mainStops: z.array(z.object({
      name: z.string(),
      reason: z.string(),
    })),
    whyUnforgettable: z.string(),
  }).optional(),
});

export type TravelPlan = z.infer<typeof TravelPlanSchema>;

