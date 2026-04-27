import React, { useEffect, useRef } from 'react';

interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  type?: 'attraction' | 'hotel' | 'restaurant' | 'activity';
}

interface TravelMapProps {
  points: MapPoint[];
  destination: string;
}

const typeColors: Record<string, string> = {
  attraction: '#5a5a40',
  hotel: '#2563eb',
  restaurant: '#dc2626',
  activity: '#16a34a',
};

const typeEmoji: Record<string, string> = {
  attraction: '🏛️',
  hotel: '🏨',
  restaurant: '🍽️',
  activity: '🎯',
};

export const TravelMap: React.FC<TravelMapProps> = ({ points, destination }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    let isCancelled = false;

    // Filtra punti con coordinate valide
    const validPoints = points.filter(
      (p) => p.lat !== 0 && p.lng !== 0 && !isNaN(p.lat) && !isNaN(p.lng)
    );

    if (validPoints.length === 0) return;

    // Importa Leaflet dinamicamente per evitare SSR issues
    import('leaflet').then((L) => {
      if (isCancelled || mapInstance.current) return;

      // Fix icone Leaflet con Vite
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      // Verifica se il container ha già una mappa (Leaflet aggiunge una classe o proprietà)
      // @ts-expect-error -- Leaflet internal property not in types
      if (mapRef.current?._leaflet_id) return;

      try {
        const center: [number, number] = [
          validPoints.reduce((s, p) => s + p.lat, 0) / validPoints.length,
          validPoints.reduce((s, p) => s + p.lng, 0) / validPoints.length,
        ];

        const map = L.map(mapRef.current!, {
          center,
          zoom: 13,
          zoomControl: true,
          scrollWheelZoom: true,
        });

        mapInstance.current = map;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map);

      // Colori per tipo
      const markers: any[] = [];
      validPoints.forEach((point, idx) => {
        const color = typeColors[point.type || 'attraction'];
        const emoji = typeEmoji[point.type || 'attraction'];

        const icon = L.divIcon({
          html: `
            <div style="
              background: ${color};
              color: white;
              border-radius: 50% 50% 50% 0;
              transform: rotate(-45deg);
              width: 36px;
              height: 36px;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 3px 10px rgba(0,0,0,0.3);
              border: 2px solid white;
              font-size: 14px;
            ">
              <span style="transform: rotate(45deg); display:block;">${emoji}</span>
            </div>
          `,
          className: '',
          iconSize: [36, 36],
          iconAnchor: [18, 36],
          popupAnchor: [0, -38],
        });

        const marker = L.marker([point.lat, point.lng], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family: Inter, sans-serif; min-width: 160px;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 4px;">
                ${point.type || 'Punto'}
              </div>
              <strong style="font-size: 14px; color: #1a1a1a;">${point.label}</strong>
            </div>
          `);

        markers.push(marker);
      });

      // Disegna la polyline dell'itinerario (solo punti attraction/activity in ordine)
      const routePoints = validPoints
        .filter((p) => p.type === 'attraction' || p.type === 'activity' || !p.type)
        .map((p) => [p.lat, p.lng] as [number, number]);

      if (routePoints.length > 1) {
        L.polyline(routePoints, {
          color: '#5a5a40',
          weight: 2.5,
          opacity: 0.7,
          dashArray: '6, 10',
        }).addTo(map);
      }

      // Fit bounds su tutti i marker
      if (validPoints.length > 1) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.15));
      }
      } catch (e) {
        console.error('Error initializing map:', e);
      }
    });

    return () => {
      isCancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [points, destination]);

  return (
    <div className="relative">
      <div ref={mapRef} style={{ height: '480px', width: '100%', borderRadius: '1.5rem', overflow: 'hidden' }} />
      {/* Legenda */}
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur px-4 py-3 rounded-2xl shadow-lg border border-white/50 text-xs space-y-1.5 z-[1000]">
        {Object.entries(typeEmoji).map(([type, emoji]) => (
          <div key={type} className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ background: typeColors[type] }}
            />
            <span className="capitalize text-gray-600">{emoji} {type === 'attraction' ? 'Attrazione' : type === 'hotel' ? 'Hotel' : type === 'restaurant' ? 'Ristorante' : 'Attività'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
