import { useState, useRef, useEffect, useCallback } from 'react';
import { ScrollView } from 'react-native';
import { ChatMessage } from '../../types';
import { detectIntent, parsePlacePrefs } from './intentEngine';
import {
  searchLocations,
  getRoute,
  getAnimalsNearRoute,
  fetchRecentWildlife,
  findSafePlacesNear,
  getAIGuideResponse,
  predictRouteRisk
} from '../../services/apiService';
import { ANIMALS } from '../../constants';
import Constants from 'expo-constants';
import { safeArray, safeObject } from '../../utils/safety';

export const useChat = (
  onOpenRouteLink?: (start: string, dest: string) => void,
  recentSightings?: any[],
  riskZones?: any[]
) => {

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'model',
      text: "Hi! Ask about wildlife risks near you, safe places, or planning a safe route."
    }
  ]);

  const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [routeState, setRouteState] = useState<'none' | 'awaiting_start' | 'awaiting_destination'>('none');
    const [startLocation, setStartLocation] = useState<string | null>(null);
    const scrollViewRef = useRef<ScrollView>(null);

  const scrollToBottom = useCallback(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const addMessage = (role: 'user' | 'model', text: string) => {
    setMessages(prev => [...prev, { role, text }]);
  };

  const getImageUrl = (rec: any): string => {
    const direct = rec?.image_url;
    if (!direct) return '';

    const base = (Constants.expoConfig?.extra as any)?.API_BASE_URL;

    if (!base) return direct;

    try {
      new URL(direct);
      return `${base}/api/proxy-image?u=${encodeURIComponent(direct)}`;
    } catch {
      return direct;
    }
  };

  const toKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const R = 6371; // Earth's radius in km
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;

    const x =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };

  const animalSafetyTips: Record<string, string[]> = {
    elephant: [
      "Maintain at least 50 meters distance",
      "Avoid honking or flashing headlights",
      "Keep windows closed and stay inside vehicle"
    ],
    tiger: [
      "Remain inside vehicle",
      "Do not approach the animal",
      "Avoid sudden movement"
    ],
    leopard: [
      "Stay inside vehicle",
      "Avoid night travel",
      "Do not provoke wildlife"
    ],
    bear: [
      "Back away slowly",
      "Avoid sudden noise",
      "Do not carry food openly"
    ],
    gaur: [
      "Maintain 50–70m distance",
      "Stay inside vehicle",
      "Move slowly away"
    ],
    bison: [
      "Maintain distance",
      "Avoid loud noise",
      "Stay in vehicle"
    ]
  };

  const simplifyPlaceName = (name: string) => {
    const short = name.split(",")[0].trim();
    if (short.toLowerCase() === "udhagamandalam") {
      return "Ooty";
    }
    return short;
  };

  const getSpeciesTips = (species: string[]) => {
    const tips = new Set<string>();

    tips.add("Avoid travel after sunset");
    tips.add("Stay on main roads");

      safeArray<string>(species).forEach(s => {
      const lower = String(s || '').toLowerCase();

      console.log("DEBUG:", animalSafetyTips);
      Object.keys(safeObject<Record<string, unknown>>(animalSafetyTips)).forEach(key => {
        if (lower.includes(key)) {
          const safetyTips = (animalSafetyTips as any)?.[key];
          if (Array.isArray(safetyTips)) {
            safetyTips.forEach(t => tips.add(t));
          }
        }
      });
    });

    return Array.from(tips).slice(0, 5);
  };

    const handleSend = async (textOverride?: string) => {

      const trimmedInput = (textOverride || input).trim();

      if (!trimmedInput || isLoading) return;

      addMessage("user", trimmedInput);

      if (!textOverride) setInput("");

      setIsLoading(true);

      try {
        /* --------------------------
           GUIDED ROUTE FLOW
        -------------------------- */
        if (routeState === 'awaiting_start') {
          setStartLocation(trimmedInput);
          setRouteState('awaiting_destination');
          addMessage('model', "Got it. Now enter your destination.");
          setIsLoading(false);
          return;
        }

        if (routeState === 'awaiting_destination') {
          const origin = startLocation;
          const dest = trimmedInput;
          if (origin && dest) {
            const origins = await searchLocations(origin);
            const dests = await searchLocations(dest);
            const o = origins[0];
            const d = dests[0];
            if (o && d) {
              const route = await getRoute(
                { lat: o.lat, lon: o.lon, name: o.name },
                { lat: d.lat, lon: d.lon, name: d.name }
              );
              if (route?.path?.length) {
                const [riskInfo, ar, weatherData] = await Promise.all([
                  predictRouteRisk(route.path),
                  getAnimalsNearRoute(route.path),
                  searchLocations(dest).then(locs => locs[0] ? api.getWeatherData(locs[0].lat, locs[0].lon) : null)
                ]);
                
                console.log("API Response:", riskInfo);
                console.log("API Response:", ar);
                if (!ar) {
                  addMessage('model', "Route risk data is currently unavailable. Please try again.");
                  setStartLocation(null);
                  setRouteState('none');
                  setIsLoading(false);
                  return;
                }
                
                const sOrigin = simplifyPlaceName(o.name);
                const sDest = simplifyPlaceName(d.name);
                
                const animalsFromRisk = riskInfo?.animalsDetected || [];
                const animalsFromRoute = (ar?.riskZones || []).map((z: any) => z?.name);
                const animalsList = [...animalsFromRisk, ...animalsFromRoute];
                
                const cleanAnimals = Array.from(new Set(animalsList))
                  .filter(Boolean)
                  .map(a => String(a).trim())
                  .filter(a => a.length > 0);
                  
                const animalsStr = cleanAnimals.length > 0 
                  ? cleanAnimals.join(', ') 
                  : "No recent sightings within alert radius";
                  
                const riskLevel = riskInfo?.routeRisk || 'Medium';
                const recommendedPath = sOrigin === 'Mudumalai' && sDest === 'Ooty' ? "Mudumalai → Masinagudi → Ooty" : "Direct route recommended";
                const tips = getSpeciesTips(cleanAnimals).join(';');
                
                const weatherStr = weatherData ? `${Math.round(weatherData.temperature)}°C, ${weatherData.windSpeed}km/h wind` : 'N/A';
                
                const structuredMsg = `__ROUTE_SAFE__|${sOrigin}|${sDest}|${riskLevel}|${animalsStr}|${recommendedPath}|${tips}|${weatherStr}`;
                addMessage('model', structuredMsg);
                addMessage('model', `__ROUTE_LINK__|${o.name}|${d.name}`);
                setStartLocation(null);
                setRouteState('none');
                setIsLoading(false);
                return;
              }
            } else {
              addMessage('model', "I couldn't find those locations. Let's try again. Please enter your starting location.");
              setRouteState('awaiting_start');
              setStartLocation(null);
              setIsLoading(false);
              return;
            }
          }
        }

        const result = detectIntent(trimmedInput);
        const { intent, confidence, entities } = result;
        const lower = trimmedInput.toLowerCase();
        let handled = false;

        /* --------------------------
           INTENT DISPATCH
        -------------------------- */
        if (intent === "LOCATION_ONLY" && confidence > 0.7) {
          const loc = entities?.location || trimmedInput;
          addMessage(
            "model",
            `I see you mentioned "${loc}". Would you like to:\n• Check nearby wildlife risks\n• Plan a safe route\n• Find forest offices nearby?`
          );
          handled = true;
        } else if (intent !== "UNKNOWN" && confidence > 0.6) {
          switch (intent) {
            case "GREETING": {
              addMessage(
                "model",
                "Hi! Tell me a place name, or share your start and destination."
              );
              handled = true;
              break;
            }

            case "ROUTE_PLAN": {

            const origin = entities?.origin;
            const dest = entities?.dest;

            if (origin && dest) {

              const origins = await searchLocations(origin);
              const dests = await searchLocations(dest);

              const o = origins[0];
              const d = dests[0];

              if (o && d) {
                  const route = await getRoute(
                    { lat: o.lat, lon: o.lon, name: o.name },
                    { lat: d.lat, lon: d.lon, name: d.name }
                  );

                  if (route?.path?.length) {
                    const riskInfo = await predictRouteRisk(route.path);
                    console.log("API Response:", riskInfo);
                    const ar = await getAnimalsNearRoute(route.path);
                    console.log("API Response:", ar);
                    if (!ar) {
                      addMessage("model", "Route risk data is currently unavailable. Please try again.");
                      handled = true;
                      break;
                    }

                    const sOrigin = simplifyPlaceName(o.name);
                    const sDest = simplifyPlaceName(d.name);

                    const animalsFromRisk = riskInfo?.animalsDetected || [];
                    const animalsFromRoute = (ar?.riskZones || []).map((z: any) => z?.name);
                    const animalsList = [...animalsFromRisk, ...animalsFromRoute];

                    const cleanAnimals = Array.from(new Set(animalsList))
                      .filter(Boolean)
                      .map(a => String(a).trim())
                      .filter(a => a.length > 0);

                    const animalsStr = cleanAnimals.length > 0 
                      ? cleanAnimals.join(", ") 
                      : "No recent sightings within alert radius";

                    const riskLevel = riskInfo?.routeRisk || "Medium";
                    const recommendedPath = sOrigin === 'Mudumalai' && sDest === 'Ooty' ? "Mudumalai → Masinagudi → Ooty" : "Direct route recommended";

                    const tips = getSpeciesTips(cleanAnimals).join(";");

                    const structuredMsg =
                      `__ROUTE_SAFE__|${sOrigin}|${sDest}|${riskLevel}|${animalsStr}|${recommendedPath}|${tips}`;

                    addMessage("model", structuredMsg);

                    addMessage("model", `__ROUTE_LINK__|${o.name}|${d.name}`);

                    handled = true;
                  }
                }

            } else {

              setRouteState("awaiting_start");

              addMessage(
                "model",
                "Let's plan a safe route. Please enter your starting location."
              );

              handled = true;
            }

            break;
          }

          case "SAFE_PLACES": {

            const locQuery = entities?.location || trimmedInput;

            const locs = await searchLocations(locQuery);

            const p = locs[0];

            if (p) {

              const prefs = parsePlacePrefs(trimmedInput);

              const safePlaces = await findSafePlacesNear(p.lat, p.lon, 10);
              console.log("API Response:", safePlaces);
              const safePlacesList = Array.isArray(safePlaces) ? safePlaces : [];

              const police = safePlacesList
                .filter(s => s.type === "police")
                .slice(0, prefs.policeCount);

              const ranger = safePlacesList
                .filter(s => s.type !== "police")
                .slice(0, prefs.forestCount);

              const policeData =
                police.map(s => `${s.name}|${s.type}|${s.lat}|${s.lon}`).join(";");

              const rangerData =
                ranger.map(s => `${s.name}|${s.type}|${s.lat}|${s.lon}`).join(";");

              const msg =
                `__SAFE_PLACES_CARD__|${p.name}|${policeData}|${rangerData}`;

              addMessage("model", msg);

              handled = true;
            }

            break;
          }

          case "AREA_RISK": {

            const locQuery = entities?.location || trimmedInput;

            const locs = await searchLocations(locQuery);

            const p = locs[0];

            if (p) {
              // Combine sightings and risk zones for consistency with map
              const combined = [
                ...(recentSightings || []),
                ...(riskZones || [])
              ];
              
              // Remove duplicates
              const uniqueSightings = combined.reduce((acc: any[], current) => {
                const isDuplicate = acc.some(item => 
                  (item.id && item.id === current.id) || 
                  (Math.abs(item.lat - current.lat) < 0.0001 && Math.abs(item.lon - current.lon) < 0.0001)
                );
                if (!isDuplicate) acc.push(current);
                return acc;
              }, []);

              const near = uniqueSightings.filter(
                (r: any) =>
                  toKm(
                    { lat: p.lat, lon: p.lon },
                    { lat: r.lat, lon: r.lon }
                  ) <= 35 // Increased radius to 35km for better matching
              );

              const species = Array.from(new Set((near || []).map((n: any) => n?.name)));

              const safePlaces = await findSafePlacesNear(p.lat, p.lon, 10);
              console.log("API Response:", safePlaces);
              const safePlacesList = Array.isArray(safePlaces) ? safePlaces : [];
              const safetyAreasStr = safePlacesList.slice(0, 5).map(s => s?.name).filter(Boolean).join(";");

              const tips = getSpeciesTips(species).join(";");

              const msg =
                `__AREA_RISK_CARD__|${p.name}|${species.join(", ") || "No recent sightings found near this location"}|${safetyAreasStr}|${tips}`;

              addMessage("model", msg);

              // Also show up to 3 recent wildlife images
              near.slice(0, 3).forEach(r => {
                const img = getImageUrl(r);
                if (img) {
                  addMessage("model", `__IMG__|${img}|${r.name}|${r.address || p.name}`);
                }
              });

              handled = true;
            } else {
              addMessage("model", "I couldn't detect your location. Please enter a place name (e.g., 'Ooty') to check for nearby wildlife risks.");
              handled = true;
            }

            break;
          }

          case "IMAGE_SEARCH": {

            console.log("DEBUG:", ANIMALS);
            const animalNames =
              safeArray<any>(Object.values(safeObject<any>(ANIMALS))).map(a => String(a?.common || '').toLowerCase());

            const foundAnimal =
              animalNames.find(n => lower.includes(n));

            const locQuery = entities?.location || trimmedInput;

            const locs = await searchLocations(locQuery);

            const p = locs[0];

            if (foundAnimal && p) {
              // Combine sightings and risk zones
              const combined = [
                ...(recentSightings || []),
                ...(riskZones || [])
              ];
              
              const uniqueSightings = combined.reduce((acc: any[], current) => {
                const isDuplicate = acc.some(item => 
                  (item.id && item.id === current.id) || 
                  (Math.abs(item.lat - current.lat) < 0.0001 && Math.abs(item.lon - current.lon) < 0.0001)
                );
                if (!isDuplicate) acc.push(current);
                return acc;
              }, []);

              const near = uniqueSightings.filter(
                (r: any) =>
                  r.name.toLowerCase().includes(foundAnimal) &&
                  toKm(
                    { lat: p.lat, lon: p.lon },
                    { lat: r.lat, lon: r.lon }
                  ) <= 40 // Increased radius for image search
              );

              near.slice(0, 6).forEach(r => {

                const img = getImageUrl(r);

                if (img)
                  addMessage(
                    "model",
                    `__IMG__|${img}|${r.name}|${r.address || p.name}`
                  );
              });

              handled = true;
            }

            break;
          }

          case "ANIMAL_SAFETY": {
            const animal = entities?.animal || "";
            if (animal) {
              const tips = animalSafetyTips[animal.toLowerCase()] || ["Maintain safe distance", "Do not provoke", "Stay in vehicle"];
              const description = `The ${animal} is common in this region. Maintain caution at forest edges and during dawn/dusk hours.`;
              const msg = `__ANIMAL_SAFETY_CARD__|${animal}|${description}|${tips.join(';')}`;
              addMessage("model", msg);
              handled = true;
            }
            break;
          }
        }
      }

      /* --------------------------
         FALLBACK AI
      -------------------------- */

      if (!handled) {
        let aiContext = "";
        try {
          // Use provided context if available, otherwise fallback to fetching
          const combined = [
            ...(recentSightings || []),
            ...(riskZones || [])
          ];
          
          // Remove duplicates
          const uniqueSightings = combined.reduce((acc: any[], current) => {
            const isDuplicate = acc.some(item => 
              (item.id && item.id === current.id) || 
              (Math.abs(item.lat - current.lat) < 0.0001 && Math.abs(item.lon - current.lon) < 0.0001)
            );
            if (!isDuplicate) acc.push(current);
            return acc;
          }, []);

          if (uniqueSightings.length > 0) {
            const top5 = uniqueSightings.slice(0, 5).map(r => `${r.name} at ${r.address || `${r.lat}, ${r.lon}`}`).join("; ");
            aiContext = `Recent wildlife sightings: ${top5}.`;
          }
        } catch (e) {
          console.warn("[AI Guide] Failed to fetch context", e);
        }

        const aiResponse =
          await getAIGuideResponse([...messages, { role: "user", text: trimmedInput }], undefined, aiContext);

        if (!aiResponse || aiResponse.length < 10) {

          addMessage(
            "model",
            "I couldn't understand that. You can ask:\n• wildlife risks near Ooty\n• plan route from Mudumalai to Ooty\n• nearest forest office"
          );

        } else {

          addMessage("model", aiResponse);
        }
      }

    } catch (err) {

      addMessage(
        "model",
        "I'm having trouble connecting to safety servers. Please try again."
      );

    } finally {

      setIsLoading(false);
    }
  };

  return {
    messages,
    input,
    setInput,
    isLoading,
    scrollViewRef,
    handleSend,
    addMessage
  };
};