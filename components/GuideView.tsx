import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, NativeModules, Image } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAIGuideResponse, searchLocations, getRoute, getAnimalsNearRoute, findSafePlacesAlongRoute, fetchRecentWildlife, findSafePlacesNear } from '../services/apiService';
import { ANIMALS } from '../constants';
import type { ChatMessage } from '../types';
import { PaperPlaneIcon, SpinnerIcon, MicIcon, ChatIcon, AlertTriangleIcon } from './icons';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Localization from 'expo-localization';

interface GuideViewProps {
    onOpenRouteLink?: (startQuery: string, destQuery: string) => void;
}

const GuideView: React.FC<GuideViewProps> = ({ onOpenRouteLink }) => {
    const insets = useSafeAreaInsets();
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            role: 'model',
            text: "Hi! Ask about wildlife risks near you, safe places, or planning a safe route."
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [voiceAvailable, setVoiceAvailable] = useState(false);
    const scrollViewRef = useRef<ScrollView>(null);
    const [pendingOrigin, setPendingOrigin] = useState<string | null>(null);
    const [pendingDest, setPendingDest] = useState<string | null>(null);

    const scrollToBottom = () => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        if (Platform.OS === 'web') {
            const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
            setVoiceAvailable(!!SR);
        } else {
            const owned = (Constants.appOwnership as any) !== 'expo';
            setVoiceAvailable(owned && !!NativeModules && !!NativeModules.ExpoSpeechRecognition);
        }
    }, []);

    const parseRouteQuery = (text: string): { origin?: string; dest?: string } => {
        const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
        let m = t.match(/i(?:'| a)m (?:at|from)\s+(.+?)\s+i (?:want|need) to go\s+(.+)/i);
        if (m && m[1] && m[2]) return { origin: m[1].trim(), dest: m[2].trim() };
        m = t.match(/go\s+(.+?)\s+from\s+(.+)/i);
        if (m && m[1] && m[2]) return { origin: m[2].trim(), dest: m[1].trim() };
        m = t.match(/(.+?)\s+(?:to|->)\s+(.+)/i);
        if (m && m[1] && m[2]) return { origin: m[1].trim(), dest: m[2].trim() };
        return {};
    };

    const toKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
        const R = 6371;
        const dLat = ((b.lat - a.lat) * Math.PI) / 180;
        const dLon = ((b.lon - a.lon) * Math.PI) / 180;
        const lat1 = (a.lat * Math.PI) / 180;
        const lat2 = (b.lat * Math.PI) / 180;
        const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
        return 2 * R * Math.asin(Math.sqrt(x));
    };
    const getImageUrl = (rec: any): string => {
        const direct = rec?.image_url;
        if (!direct) return '';
        const base = (Constants.expoConfig?.extra as any)?.API_BASE_URL;
        if (!base) return direct;
        try {
            const u = new URL(direct);
            return `${base}/api/proxy-image?u=${encodeURIComponent(direct)}`;
        } catch {
            return direct;
        }
    };
    const parsePlacePrefs = (text: string): { policeCount: number; forestCount: number; order: 'police' | 'forest' } => {
        const t = text.toLowerCase();
        let policeCount = 3;
        let forestCount = 3;
        let order: 'police' | 'forest' = 'police';
        if (t.includes('forest first') || t.includes('ranger first') || t.includes('forest priority')) order = 'forest';
        if (t.includes('police first') || t.includes('police priority')) order = 'police';
        const pm = t.match(/police\s*(\d{1,2})/);
        if (pm && pm[1]) {
            const n = parseInt(pm[1], 10);
            if (!isNaN(n)) policeCount = Math.max(1, Math.min(10, n));
        }
        const fm = t.match(/(?:forest|ranger)\s*(\d{1,2})/);
        if (fm && fm[1]) {
            const n = parseInt(fm[1], 10);
            if (!isNaN(n)) forestCount = Math.max(1, Math.min(10, n));
        }
        return { policeCount, forestCount, order };
    };

    const handleSend = async () => {
        const trimmedInput = input.trim();
        if (!trimmedInput || isLoading) return;

        const newMessages: ChatMessage[] = [...messages, { role: 'user', text: trimmedInput }];
        setMessages(newMessages);
        setInput('');
        setIsLoading(true);

        try {
            let produced = false;
            let contextMessages = newMessages;
            const lower = trimmedInput.toLowerCase();
            const rq = parseRouteQuery(trimmedInput);
            const isGreeting = /^(hi|hello|hey|hai|hola|namaste|vanakkam|good (morning|afternoon|evening))\b/.test(lower);
            const destOnlyMatch = lower.match(/(?:destination(?: address)?(?: is)?|go to)\s+(.+)/i);
            const originOnlyMatch = lower.match(/i(?:'| a)m (?:at|from)\s+(.+)$/i) || lower.match(/current address(?: is)?\s+(.+)$/i);
            if (isGreeting) {
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: "Hi! Tell me a place name, or share your start and destination." }]);
                produced = true;
            } else
            if (lower.includes('safe place') || lower.includes('safety place') || lower.includes('safe places') || lower.includes('safety places') || lower.includes('police') || lower.includes('forest office') || lower.includes('ranger')) {
                const locs = await searchLocations(trimmedInput);
                const p = locs[0];
                if (p) {
                    const prefs = parsePlacePrefs(trimmedInput);
                    const safePlaces = await findSafePlacesNear(p.lat, p.lon, 10);
                    const police = (safePlaces || []).filter(s => s.type === 'police').slice(0, prefs.policeCount);
                    const ranger = (safePlaces || []).filter(s => s.type !== 'police').slice(0, prefs.forestCount);
                    const policeNames = police.map(s => s.name).filter(Boolean);
                    const rangerNames = ranger.map(s => s.name).filter(Boolean);
                    const summary = prefs.order === 'police'
                        ? `Safety areas near ${p.name} — Police: ${policeNames.join(', ') || 'None'} | Forest: ${rangerNames.join(', ') || 'None'}.`
                        : `Safety areas near ${p.name} — Forest: ${rangerNames.join(', ') || 'None'} | Police: ${policeNames.join(', ') || 'None'}.`;
                    setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: summary }]);
                    produced = true;
                } else {
                    const ask = `Please mention the location to list safety areas. Example: “Share safety places in Kotagiri”.`;
                    setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: ask }]);
                    produced = true;
                }
            } else
            if (rq.origin && rq.dest) {
                const origins = await searchLocations(rq.origin);
                const dests = await searchLocations(rq.dest);
                const o = origins[0];
                const d = dests[0];
                    if (o && d) {
                    setPendingOrigin(null);
                    setPendingDest(null);
                    const route = await getRoute({ lat: o.lat, lon: o.lon, name: o.name }, { lat: d.lat, lon: d.lon, name: d.name });
                    if (route && route.path.length > 0) {
                        const ar = await getAnimalsNearRoute(route.path);
                        const sp = await findSafePlacesAlongRoute(route.path);
                        const segCount = (ar.riskySegments || []).length;
                        const rzCount = (ar.riskZones || []).length;
                        const safeNames = (sp || []).slice(0, 5).map(s => s.name).filter(Boolean);
                        const dist = Math.round((route.distanceKm || 0) * 10) / 10;
                        const dur = Math.round(route.durationMinutes || 0);
                        const summary = `Route plan: ${o.name} → ${d.name}. Distance: ${dist} km, Duration: ${dur} min. Risk zones: ${rzCount}, risky segments: ${segCount}. Nearby safe places: ${safeNames.join(', ') || 'None found'}.`;
                        contextMessages = [...contextMessages, { role: 'model', text: summary }];
                        setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: summary }]);
                            const recents = await fetchRecentWildlife();
                            const nearStart = recents.filter((r: any) => toKm({ lat: o.lat, lon: o.lon }, { lat: r.lat, lon: r.lon }) <= 20).slice(0, 6);
                            const nearDest = recents.filter((r: any) => toKm({ lat: d.lat, lon: d.lon }, { lat: r.lat, lon: r.lon }) <= 20).slice(0, 6);
                            const startIcons = nearStart.map((r: any) => `${r.emoji || '🐾'} ${r.name}`).join(', ');
                            const destIcons = nearDest.map((r: any) => `${r.emoji || '🐾'} ${r.name}`).join(', ');
                            const animalsMsg = `Nearby wildlife — Start: ${startIcons || 'None'} | Destination: ${destIcons || 'None'}`;
                            contextMessages = [...contextMessages, { role: 'model', text: animalsMsg }];
                            setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: animalsMsg }]);
                            const seenStart = new Set<string>();
                            for (const r of nearStart) {
                                const key = String(r.name).toLowerCase();
                                if (seenStart.has(key)) continue;
                                seenStart.add(key);
                                const img = getImageUrl(r);
                                if (img) setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__IMG__|${img}|${r.name}|${r.address || o.name}` }]);
                            }
                            const seenDest = new Set<string>();
                            for (const r of nearDest) {
                                const key = String(r.name).toLowerCase();
                                if (seenDest.has(key)) continue;
                                seenDest.add(key);
                                const img = getImageUrl(r);
                                if (img) setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__IMG__|${img}|${r.name}|${r.address || d.name}` }]);
                            }
                        setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__ROUTE_LINK__|${o.name}|${d.name}` }]);
                        produced = true;
                    }
                }
            } else if (!rq.origin && destOnlyMatch && !rq.dest) {
                const destText = destOnlyMatch[1].trim();
                const locs = await searchLocations(destText);
                const d = locs[0];
                if (d) {
                    setPendingDest(destText);
                    if (pendingOrigin) {
                        const origins = await searchLocations(pendingOrigin);
                        const o = origins[0];
                        if (o) {
                            const route = await getRoute({ lat: o.lat, lon: o.lon, name: o.name }, { lat: d.lat, lon: d.lon, name: d.name });
                            if (route && route.path.length > 0) {
                                const ar = await getAnimalsNearRoute(route.path);
                                const sp = await findSafePlacesAlongRoute(route.path);
                                const segCount = (ar.riskySegments || []).length;
                                const rzCount = (ar.riskZones || []).length;
                                const safeNames = (sp || []).slice(0, 5).map(s => s.name).filter(Boolean);
                                const dist = Math.round((route.distanceKm || 0) * 10) / 10;
                                const dur = Math.round(route.durationMinutes || 0);
                                const summary = `Route plan: ${o.name} → ${d.name}. Distance: ${dist} km, Duration: ${dur} min. Risk zones: ${rzCount}, risky segments: ${segCount}. Nearby safe places: ${safeNames.join(', ') || 'None found'}.`;
                                contextMessages = [...contextMessages, { role: 'model', text: summary }];
                                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: summary }]);
                                const recents = await fetchRecentWildlife();
                                const nearStart = recents.filter((r: any) => toKm({ lat: o.lat, lon: o.lon }, { lat: r.lat, lon: r.lon }) <= 20).slice(0, 6);
                                const nearDestFull = recents.filter((r: any) => toKm({ lat: d.lat, lon: d.lon }, { lat: r.lat, lon: r.lon }) <= 20).slice(0, 6);
                                const startIcons = nearStart.map((r: any) => `${r.emoji || '🐾'} ${r.name}`).join(', ');
                                const destIcons = nearDestFull.map((r: any) => `${r.emoji || '🐾'} ${r.name}`).join(', ');
                                const animalsMsg = `Nearby wildlife — Start: ${startIcons || 'None'} | Destination: ${destIcons || 'None'}`;
                                contextMessages = [...contextMessages, { role: 'model', text: animalsMsg }];
                                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: animalsMsg }]);
                                const seenStart = new Set<string>();
                                for (const r of nearStart) {
                                    const key = String(r.name).toLowerCase();
                                    if (seenStart.has(key)) continue;
                                    seenStart.add(key);
                                    const img = getImageUrl(r);
                                    if (img) setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__IMG__|${img}|${r.name}|${r.address || o.name}` }]);
                                }
                                const seenDest = new Set<string>();
                                for (const r of nearDestFull) {
                                    const key = String(r.name).toLowerCase();
                                    if (seenDest.has(key)) continue;
                                    seenDest.add(key);
                                    const img = getImageUrl(r);
                                    if (img) setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__IMG__|${img}|${r.name}|${r.address || d.name}` }]);
                                }
                                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__ROUTE_LINK__|${o.name}|${d.name}` }]);
                                setPendingOrigin(null);
                                setPendingDest(null);
                                produced = true;
                            }
                        }
                    }
                    const recents = await fetchRecentWildlife();
                    const nearDest = recents.filter((r: any) => toKm({ lat: d.lat, lon: d.lon }, { lat: r.lat, lon: r.lon }) <= 25).slice(0, 8);
                    const destIcons = nearDest.map((r: any) => `${r.emoji || '🐾'} ${r.name}`).join(', ');
                    const summary = `Wildlife near ${d.name}: ${destIcons || 'None'} within 25 km. Share your start address to plan route and open the route link.`;
                    contextMessages = [...contextMessages, { role: 'model', text: summary }];
                    setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: summary }]);
                    const seen = new Set<string>();
                    for (const r of nearDest) {
                        const key = String(r.name).toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        const img = getImageUrl(r);
                        if (img) setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__IMG__|${img}|${r.name}|${r.address || d.name}` }]);
                    }
                    const ask = `Please tell your current address to build the safest route to ${d.name} and provide a route link.`;
                    setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: ask }]);
                    produced = true;
                }
            } else if ((lower.includes('route') || lower.includes('plan') || lower.includes('navigate') || lower.includes('directions')) && !(rq.origin && rq.dest)) {
                const ask = `Please tell your current address and destination to plan safety and show nearby animal sightings for both.`;
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: ask }]);
                produced = true;
            } else if (originOnlyMatch && !rq.dest) {
                const ask = `Please tell your destination address to plan safety and show nearby animal sightings around your start: ${originOnlyMatch[1].trim()}.`;
                setPendingOrigin(originOnlyMatch[1].trim());
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: ask }]);
                produced = true;
            } else if (lower.includes('nearby') || lower.includes('area') || lower.includes('animals in ') || lower.includes('wildlife in ')) {
                const locs = await searchLocations(trimmedInput);
                const p = locs[0];
                if (p) {
                    const recents = await fetchRecentWildlife();
                    const near = recents.filter((r: any) => toKm({ lat: p.lat, lon: p.lon }, { lat: r.lat, lon: r.lon }) <= 25);
                    const species = Array.from(new Set(near.map((n: any) => n.name)));
                    const safePlaces = await findSafePlacesNear(p.lat, p.lon, 5);
                    const detour = species.some(s => s.toLowerCase().includes('elephant') || s.toLowerCase().includes('tiger'))
                        ? 'Avoid dense forest edges; prefer main roads with lighting.'
                        : 'Use well-used paths; avoid thick brush and isolated trails.';
                    const timeGuidance = 'Prefer daylight; avoid dawn/dusk near forest edges; postpone after heavy rain.';
                    const summary = [
                        `Area: ${p.name}`,
                        `Animals: ${species.join(', ') || 'None'} within 25 km`,
                        `Safety Areas: ${safePlaces.slice(0,5).map(s => s.name).join(', ') || 'None found'}`,
                        `Detour Suggestion: ${detour}`,
                        `Time-of-Day Guidance: ${timeGuidance}`
                    ].join('\\n');
                    contextMessages = [...contextMessages, { role: 'model', text: summary }];
                    setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: summary }]);
                    const seen = new Set<string>();
                    for (const r of near) {
                        const key = String(r.name).toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        const img = getImageUrl(r);
                        if (img) setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__IMG__|${img}|${r.name}|${r.address || p.name}` }]);
                    }
                    produced = true;
                }
            } else if (!rq.origin && !rq.dest && !isGreeting && trimmedInput.replace(/\s+/g, '').length >= 3) {
                const locs = await searchLocations(trimmedInput);
                const p = locs[0];
                if (p) {
                    const recents = await fetchRecentWildlife();
                    const near = recents.filter((r: any) => toKm({ lat: p.lat, lon: p.lon }, { lat: r.lat, lon: r.lon }) <= 25);
                    const species = Array.from(new Set(near.map((n: any) => n.name)));
                    const safePlaces = await findSafePlacesNear(p.lat, p.lon, 5);
                    const detour = species.some(s => s.toLowerCase().includes('elephant') || s.toLowerCase().includes('tiger'))
                        ? 'Avoid dense forest edges; prefer main roads with lighting.'
                        : 'Use well-used paths; avoid thick brush and isolated trails.';
                    const timeGuidance = 'Prefer daylight; avoid dawn/dusk near forest edges; postpone after heavy rain.';
                    const summary = [
                        `Area: ${p.name}`,
                        `Animals: ${species.join(', ') || 'None'} within 25 km`,
                        `Safety Areas: ${safePlaces.slice(0,5).map(s => s.name).join(', ') || 'None found'}`,
                        `Detour Suggestion: ${detour}`,
                        `Time-of-Day Guidance: ${timeGuidance}`
                    ].join('\\n');
                    contextMessages = [...contextMessages, { role: 'model', text: summary }];
                    setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: summary }]);
                    const seen = new Set<string>();
                    for (const r of near) {
                        const key = String(r.name).toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        const img = getImageUrl(r);
                        if (img) setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__IMG__|${img}|${r.name}|${r.address || p.name}` }]);
                    }
                    produced = true;
                }
            } else if (lower.includes('share') && lower.includes('image')) {
                const animalNames = Object.values(ANIMALS).map(a => a.common.toLowerCase());
                const foundAnimal = animalNames.find(n => lower.includes(n));
                const locs = await searchLocations(trimmedInput);
                const p = locs[0];
                if (foundAnimal && p) {
                    const recents = await fetchRecentWildlife();
                    const near = recents.filter((r: any) => r.name.toLowerCase().includes(foundAnimal) && toKm({ lat: p.lat, lon: p.lon }, { lat: r.lat, lon: r.lon }) <= 30);
                    const imgs = near.slice(0, 8);
                    if (imgs.length > 0) {
                        for (const r of imgs) {
                            const img = getImageUrl(r);
                            if (img) setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__IMG__|${img}|${r.name}|${r.address || p.name}` }]);
                        }
                        produced = true;
                    } else {
                        setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `No recent photos for ${foundAnimal} near ${p.name}.` }]);
                        produced = true;
                    }
                } else if (!foundAnimal || !p) {
                    const ask = `Please tell the animal name and location to share images. Example: “Share image of Tiger in Masinagudi”.`;
                    setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: ask }]);
                    produced = true;
                }
            } else {
                const animalNames = Object.values(ANIMALS).map(a => a.common.toLowerCase());
                const t = trimmedInput.toLowerCase();
                const found = animalNames.find(n => t.includes(n));
                if (found) {
                    const locs = await searchLocations(trimmedInput);
                    const p = locs[0];
                    if (p) {
                        const recents = await fetchRecentWildlife();
                        const near = recents.filter((r: any) => r.name.toLowerCase().includes(found) && toKm({ lat: p.lat, lon: p.lon }, { lat: r.lat, lon: r.lon }) <= 30).slice(0, 2);
                        for (const r of near) {
                            const img = getImageUrl(r);
                            if (img) setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: `__IMG__|${img}|${r.name}|${r.address || p.name}` }]);
                        }
                        const text = `Recent ${found} sightings near ${p.name}. ${near.length} photo${near.length === 1 ? '' : 's'} shown above. Keep 50+ meters distance and prefer daylight paths.`;
                        setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text }]);
                        produced = true;
                    }
                }
            }
            if (!produced) {
                const response = `Please share an area name (e.g., Ooty) to check safety and nearby safe places with recent wildlife images, or share both your current address and destination to generate a safe route with a route link.`;
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: response }]);
            }
        } catch (error: any) {
            // Error already logged in apiService
            setMessages((prev: ChatMessage[]) => [...prev, {
                role: 'model',
                text: error?.message || "I'm sorry, I'm having trouble connecting right now. Please try again later."
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const startWebSpeech = async () => {
        if (Platform.OS !== 'web' || isRecording) return;
        try {
            setIsRecording(true);
            const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
            if (!SR) {
                setIsRecording(false);
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: 'Voice input is not supported in this browser. Please use Chrome on web.' }]);
                return;
            }
            const recog = new SR();
            recog.lang = 'en-US';
            recog.interimResults = true;
            recog.continuous = false;
            recog.onresult = (e: any) => {
                const t = Array.from(e.results).map((r: any) => r[0].transcript).join(' ');
                setInput(t);
            };
            recog.onerror = () => {
                setIsRecording(false);
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: 'Voice input error. Please try again or type your message.' }]);
            };
            recog.onend = () => {
                setIsRecording(false);
            };
            recog.start();
        } catch {
            setIsRecording(false);
            setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: 'Voice input could not be started.' }]);
        }
    };

    const startNativeSpeech = async () => {
        if (Platform.OS === 'web' || isRecording) return;
        setIsRecording(true);
        try {
            if ((Constants.appOwnership as any) === 'expo') {
                setIsRecording(false);
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: 'Voice input is not available in Expo Go. Build a dev client to enable microphone recognition.' }]);
                return;
            }
            // Skip entirely if native module is not present (Expo Go)
            if (!NativeModules || !NativeModules.ExpoSpeechRecognition) {
                setIsRecording(false);
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: 'Voice input module is not installed. Please use a development build.' }]);
                return;
            }
            // Dynamically import the native module to avoid crashing in Expo Go
            let mod: any = null;
            try {
                mod = await import('expo-speech-recognition');
            } catch {
                mod = null;
            }
            if (!mod || !mod.ExpoSpeechRecognitionModule) {
                setIsRecording(false);
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: 'Voice input module is unavailable.' }]);
                return;
            }
            const { ExpoSpeechRecognitionModule, addSpeechRecognitionListener } = mod;
            const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
            if (!perm?.granted) {
                setIsRecording(false);
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: 'Microphone permission not granted.' }]);
                return;
            }
            const resultListener = addSpeechRecognitionListener('result', (event: any) => {
                const t = (event?.results?.[0]?.transcript as string) || '';
                if (t) setInput(t);
            });
            const endListener = addSpeechRecognitionListener('end', () => {
                resultListener.remove();
                endListener.remove();
                errorListener.remove();
                setIsRecording(false);
            });
            const errorListener = addSpeechRecognitionListener('error', () => {
                resultListener.remove();
                endListener.remove();
                errorListener.remove();
                setIsRecording(false);
                setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: 'Voice input error.' }]);
            });
            await ExpoSpeechRecognitionModule.start({
                lang: Localization.locale || 'en-US',
                interimResults: true,
                continuous: false
            });
        } catch {
            setIsRecording(false);
            setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: 'Voice input could not be started.' }]);
        }
    };

    return (
        <View style={styles.container}>
            <KeyboardAvoidingView 
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                <View style={styles.header}>
                    <View style={styles.headerCard}>
                        <View style={styles.headerRow}>
                            <View style={styles.headerIcon}>
                                <ChatIcon width={18} height={18} color="#065f46" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.title}>AI Wildlife Guide</Text>
                                <Text style={styles.subtitle}>Ask about risks, safe places, and routes</Text>
                            </View>
                        </View>
                    </View>
                </View>

                <ScrollView 
                    ref={scrollViewRef}
                    style={styles.messagesContainer}
                    contentContainerStyle={[
                        styles.messagesContent,
                        messages.length <= 1 && { justifyContent: 'center', flexGrow: 1 }
                    ]}
                    keyboardShouldPersistTaps="handled"
                >
                    {messages.length <= 1 && !isLoading ? (
                        <View style={styles.emptyState}>
                            <View style={styles.emptyIcon}>
                                <ChatIcon width={22} height={22} color="#059669" />
                            </View>
                            <Text style={styles.emptyTitle}>Ask about wildlife safety near you</Text>
                            <Text style={styles.emptyText}>
                                Try: “Wildlife risks in Ooty” or “Plan route from Kotagiri to Coonoor”.
                            </Text>
                        </View>
                    ) : null}
                    {messages.map((msg, index) => {
                        const isRouteLink = msg.role === 'model' && typeof msg.text === 'string' && msg.text.startsWith('__ROUTE_LINK__|');
                        if (isRouteLink) {
                            const parts = msg.text.split('|');
                            const startQ = parts[1] || '';
                            const destQ = parts[2] || '';
                            return (
                                <View key={index} style={[styles.messageBubble, styles.modelBubble]}>
                                    <TouchableOpacity
                                        onPress={() => onOpenRouteLink && onOpenRouteLink(startQ, destQ)}
                                        style={{ backgroundColor: '#10b981', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 }}
                                    >
                                        <Text style={{ color: '#fff', fontWeight: '600' }}>
                                            Open Route: {startQ} → {destQ}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            );
                        }
                        const isImageCard = msg.role === 'model' && typeof msg.text === 'string' && msg.text.startsWith('__IMG__|');
                        if (isImageCard) {
                            const parts = msg.text.split('|');
                            const url = parts[1] || '';
                            const title = parts[2] || '';
                            const caption = parts[3] || '';
                            return (
                                <View key={index} style={[styles.messageBubble, styles.modelBubble]}>
                                    {url ? <Image source={{ uri: url }} style={{ width: '100%', height: 180, borderRadius: 8, marginBottom: 8 }} /> : null}
                                    <Text style={[styles.modelText, { fontWeight: '600' }]}>{title}</Text>
                                    <Text style={styles.modelText}>{caption}</Text>
                                </View>
                            );
                        }
                        return (
                            <View key={index} style={[styles.messageBubble, msg.role === 'user' ? styles.userBubble : styles.modelBubble]}>
                                <Text style={[styles.messageText, msg.role === 'user' ? styles.userText : styles.modelText]}>
                                    {msg.text}
                                </Text>
                            </View>
                        );
                    })}
                    {isLoading && (
                        <View style={[styles.messageBubble, styles.modelBubble, styles.loadingBubble]}>
                            <SpinnerIcon width={20} height={20} color="#059669" />
                            <Text style={styles.modelText}>Thinking...</Text>
                        </View>
                    )}
                </ScrollView>

                <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 12 }]}>
                    <View style={styles.quickActions}>
                        <TouchableOpacity
                            style={[styles.quickActionButton, styles.quickActionPrimary]}
                            disabled={isLoading}
                            onPress={() => setInput('Plan the safest route from my current location considering recent wildlife activity.')}
                        >
                            <PaperPlaneIcon width={16} height={16} color="#ffffff" />
                            <Text style={styles.quickActionPrimaryText}>Plan Safe Route</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.quickActionButton, styles.quickActionSecondary]}
                            disabled={isLoading}
                            onPress={() => setInput('What wildlife risks are nearby right now based on recent sightings and movement?')}
                        >
                            <AlertTriangleIcon width={16} height={16} color="#1B8E5A" />
                            <Text style={styles.quickActionSecondaryText}>Check Nearby Risks</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.inputRow}>
                        {voiceAvailable && (
                            <TouchableOpacity 
                                onPress={Platform.OS === 'web' ? startWebSpeech : startNativeSpeech}
                                disabled={isLoading}
                                style={[styles.attachButton, isLoading && styles.sendButtonDisabled]}
                            >
                                {isRecording ? <SpinnerIcon width={20} height={20} color="#374151" /> : <MicIcon width={20} height={20} color="#374151" />}
                            </TouchableOpacity>
                        )}
                        <TextInput
                            style={styles.input}
                            value={input}
                            onChangeText={setInput}
                            placeholder="Ask about wildlife, routes, or safe places..."
                            placeholderTextColor="#9ca3af"
                            multiline={false}
                            numberOfLines={1}
                            editable={!isLoading}
                            returnKeyType="send"
                            onSubmitEditing={handleSend}
                        />
                        <TouchableOpacity 
                            onPress={handleSend}
                            disabled={isLoading || !input.trim()}
                            style={[styles.sendButton, (isLoading || !input.trim()) && styles.sendButtonDisabled]}
                        >
                            <Ionicons name="arrow-up" size={18} color="#ffffff" />
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.disclaimer}>
                        Always use multiple sources for safety decisions. Trust your instincts in the field.
                    </Text>
                </View>
            </KeyboardAvoidingView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    header: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 12,
        backgroundColor: '#f9fafb',
    },
    headerCard: {
        backgroundColor: '#ecfdf5',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#d1fae5',
        padding: 14,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headerIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#d1fae5',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
    },
    subtitle: {
        fontSize: 14,
        color: '#6b7280',
    },
    messagesContainer: {
        flex: 1,
    },
    messagesContent: {
        padding: 16,
        paddingBottom: 140, // Reduced from 220 as input is no longer absolute
        flexGrow: 1,
    },
    messageBubble: {
        maxWidth: '85%',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 20,
        marginBottom: 12,
    },
    userBubble: {
        alignSelf: 'flex-end',
        backgroundColor: '#059669',
        borderTopRightRadius: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    modelBubble: {
        alignSelf: 'flex-start',
        backgroundColor: '#f3f4f6', // Softer grey instead of white with border
        borderTopLeftRadius: 4,
        borderWidth: 0, // Removed border for cleaner look
    },
    loadingBubble: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    messageText: {
        fontSize: 14,
        lineHeight: 22,
    },
    userText: {
        color: '#ffffff',
    },
    modelText: {
        color: '#111827',
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        paddingHorizontal: 16,
        marginBottom: 16,
        // Removed border and background for cleaner UI
    },
    emptyIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f3f4f6',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    emptyTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1f2937',
        marginBottom: 4,
        textAlign: 'center',
    },
    emptyText: {
        fontSize: 12,
        color: '#6b7280',
        textAlign: 'center',
        lineHeight: 18,
    },
    inputContainer: {
        paddingHorizontal: 16,
        paddingTop: 8,
        backgroundColor: '#f9fafb', // Added background color
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 20, // Increased spacing
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 30,
        backgroundColor: '#ffffff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 }, // Reduced shadow
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    attachButton: {
        width: 40, // Reduced size
        height: 40,
        backgroundColor: '#f3f4f6',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        alignItems: 'center',
        justifyContent: 'center',
    },
    input: {
        flex: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        color: '#111827',
        // Removed fixed width/height constraints implicitly
    },
    sendButton: {
        width: 40, // Reduced size
        height: 40,
        backgroundColor: '#1B8E5A',
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    sendButtonDisabled: {
        backgroundColor: '#9ca3af',
    },
    disclaimer: {
        fontSize: 11,
        textAlign: 'center',
        color: '#9ca3af',
        marginTop: 14, // Increased spacing
        marginBottom: 8,
        paddingHorizontal: 20, // Added horizontal padding
    },
    quickActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        marginTop: 0,
        marginVertical: 20, // Added vertical margin
    },
    quickActionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 20,
        borderWidth: 1,
    },
    quickActionPrimary: {
        backgroundColor: '#1B8E5A',
        borderColor: '#1B8E5A',
    },
    quickActionSecondary: {
        backgroundColor: '#ffffff',
        borderColor: '#e5e7eb', // Softer border
    },
    quickActionPrimaryText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '700',
    },
    quickActionSecondaryText: {
        color: '#1f2937', // Dark text for secondary
        fontSize: 14,
        fontWeight: '600',
    },
});

export default GuideView;
