import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { ChatMessage } from '../../types';
import { SpinnerIcon } from '../icons';

interface MessageItemProps {
    message: ChatMessage;
    onOpenRouteLink?: (startQuery: string, destQuery: string) => void;
    isLoading?: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, onOpenRouteLink, isLoading }) => {
    const { role, text } = message;

    // Handle Route Link Format: __ROUTE_LINK__|start|dest
    if (role === 'model' && typeof text === 'string' && text.startsWith('__ROUTE_LINK__|')) {
        const parts = text.split('|');
        const startQ = parts[1] || '';
        const destQ = parts[2] || '';
        return (
            <View style={[styles.bubble, styles.modelBubble]}>
                <TouchableOpacity
                    onPress={() => onOpenRouteLink && onOpenRouteLink(startQ, destQ)}
                    style={styles.routeButton}
                >
                    <Text style={styles.routeButtonText}>
                        View Route on Map: {startQ} → {destQ}
                    </Text>
                </TouchableOpacity>
            </View>
        );
    }

    // Handle Structured Route Safe Format: __ROUTE_SAFE__|origin|dest|risk|animals|path|tips|weather
    if (role === 'model' && typeof text === 'string' && text.startsWith('__ROUTE_SAFE__|')) {
        const parts = text.split('|');
        const origin = parts[1] || '';
        const dest = parts[2] || '';
        const risk = parts[3] || 'Medium';
        const animals = parts[4] || 'None';
        const path = parts[5] || '';
        const tips = (parts[6] || '').split(';');
        const weather = parts[7] || 'N/A';

        const riskColor = risk.toUpperCase() === 'HIGH' ? '#ef4444' : risk.toUpperCase() === 'MEDIUM' ? '#f59e0b' : '#10b981';

        return (
            <View style={[styles.bubble, styles.modelBubble, styles.card]}>
                <Text style={styles.cardTitle}>Safe Route Analysis</Text>
                
                <View style={styles.cardSection}>
                    <Text style={styles.label}>📍 Journey</Text>
                    <Text style={styles.value}>{origin} → {dest}</Text>
                </View>

                <View style={[styles.riskBadge, { backgroundColor: riskColor + '20', borderColor: riskColor }]}>
                    <Text style={[styles.riskLabel, { color: riskColor }]}>⚠ Risk Level: {risk}</Text>
                </View>

                <View style={styles.cardSection}>
                    <Text style={styles.label}>🌦 Destination Weather</Text>
                    <Text style={styles.value}>{weather}</Text>
                </View>

                <View style={styles.cardSection}>
                    <Text style={styles.label}>🐾 Animals Near Route</Text>
                    <Text style={styles.value}>{animals}</Text>
                </View>

                <View style={styles.cardSection}>
                    <Text style={styles.label}>🛣 Recommended Route</Text>
                    <Text style={styles.value}>{path}</Text>
                </View>

                <View style={styles.cardSection}>
                    <Text style={styles.label}>🛡 Safety Tips</Text>
                    {tips.map((tip, i) => (
                        <Text key={i} style={styles.value}>• {tip}</Text>
                    ))}
                </View>
            </View>
        );
    }

    // Handle Structured Area Risk Format: __AREA_RISK_CARD__|area|animals|safetyAreas|tips
    if (role === 'model' && typeof text === 'string' && text.startsWith('__AREA_RISK_CARD__|')) {
        const parts = text.split('|');
        const area = parts[1] || '';
        const animals = parts[2] || 'None';
        const safetyAreas = (parts[3] || '').split(';');
        const tips = (parts[4] || '').split(';');

        return (
            <View style={[styles.bubble, styles.modelBubble, styles.card]}>
                <Text style={styles.cardTitle}>Area Safety Report</Text>
                
                <View style={styles.cardSection}>
                    <Text style={styles.label}>📍 Location</Text>
                    <Text style={styles.value}>{area}</Text>
                </View>

                <View style={styles.cardSection}>
                    <Text style={styles.label}>🐾 Recent Wildlife Sightings</Text>
                    <Text style={styles.value}>{animals}</Text>
                </View>

                <View style={styles.cardSection}>
                    <Text style={styles.label}>🛡 Nearby Safety Areas</Text>
                    {safetyAreas.length > 0 && safetyAreas[0] !== '' ? (
                        safetyAreas.map((s, i) => <Text key={i} style={styles.value}>• {s}</Text>)
                    ) : (
                        <Text style={styles.value}>None reported nearby</Text>
                    )}
                </View>

                <View style={styles.cardSection}>
                    <Text style={styles.label}>⚠️ Safety Guidelines</Text>
                    {tips.map((tip, i) => (
                        <Text key={i} style={styles.value}>• {tip}</Text>
                    ))}
                </View>
            </View>
        );
    }

    // Handle Structured Safe Places Format: __SAFE_PLACES_CARD__|area|policeData|rangerData
    if (role === 'model' && typeof text === 'string' && text.startsWith('__SAFE_PLACES_CARD__|')) {
        const parts = text.split('|');
        const area = parts[1] || '';
        const policeList = (parts[2] || '').split(';').filter(Boolean);
        const rangerList = (parts[3] || '').split(';').filter(Boolean);

        return (
            <View style={[styles.bubble, styles.modelBubble, styles.card]}>
                <Text style={styles.cardTitle}>Safe Places Near {area}</Text>
                
                <View style={styles.cardSection}>
                    <Text style={styles.label}>👮 Police Stations</Text>
                    {policeList.length > 0 ? (
                        policeList.map((p, i) => {
                            const [name] = p.split('|');
                            return <Text key={i} style={styles.value}>• {name}</Text>;
                        })
                    ) : (
                        <Text style={styles.value}>No police stations found nearby</Text>
                    )}
                </View>

                <View style={styles.cardSection}>
                    <Text style={styles.label}>🌲 Forest Ranger Offices</Text>
                    {rangerList.length > 0 ? (
                        rangerList.map((r, i) => {
                            const [name] = r.split('|');
                            return <Text key={i} style={styles.value}>• {name}</Text>;
                        })
                    ) : (
                        <Text style={styles.value}>No forest offices found nearby</Text>
                    )}
                </View>
                
                <Text style={styles.cardFooter}>These areas are monitored and offer immediate assistance during wildlife encounters.</Text>
            </View>
        );
    }

    // Handle Structured Animal Safety Format: __ANIMAL_SAFETY_CARD__|animal|description|tips
    if (role === 'model' && typeof text === 'string' && text.startsWith('__ANIMAL_SAFETY_CARD__|')) {
        const parts = text.split('|');
        const animal = parts[1] || '';
        const description = parts[2] || '';
        const tips = (parts[3] || '').split(';');

        return (
            <View style={[styles.bubble, styles.modelBubble, styles.card, styles.safetyCard]}>
                <Text style={styles.cardTitle}>{animal.toUpperCase()} SAFETY GUIDE</Text>
                
                <View style={styles.cardSection}>
                    <Text style={styles.label}>🦁 Animal Behavior</Text>
                    <Text style={styles.value}>{description}</Text>
                </View>

                <View style={styles.cardSection}>
                    <Text style={styles.label}>🛡️ Safety Actions</Text>
                    {tips.map((tip, i) => (
                        <Text key={i} style={styles.value}>• {tip}</Text>
                    ))}
                </View>
                
                <View style={[styles.riskBadge, { backgroundColor: '#fee2e2', borderColor: '#ef4444' }]}>
                    <Text style={[styles.riskLabel, { color: '#ef4444' }]}>⚠️ HIGH CAUTION ADVISED</Text>
                </View>
            </View>
        );
    }

    // Handle Image Card Format: __IMG__|url|title|caption
    if (role === 'model' && typeof text === 'string' && text.startsWith('__IMG__|')) {
        const parts = text.split('|');
        const url = parts[1] || '';
        const title = parts[2] || '';
        const caption = parts[3] || '';
        return (
            <View style={[styles.bubble, styles.modelBubble]}>
                {url ? <Image source={{ uri: url }} style={styles.image} /> : null}
                <Text style={[styles.text, styles.modelText, styles.imageTitle]}>{title}</Text>
                <Text style={[styles.text, styles.modelText]}>{caption}</Text>
            </View>
        );
    }

    // Handle Loading State
    if (isLoading) {
        return (
            <View style={[styles.bubble, styles.modelBubble, styles.loadingBubble]}>
                <SpinnerIcon width={20} height={20} color="#059669" />
                <Text style={[styles.text, styles.modelText]}>Thinking...</Text>
            </View>
        );
    }

    return (
        <View style={[styles.bubble, role === 'user' ? styles.userBubble : styles.modelBubble]}>
            <Text style={[styles.text, role === 'user' ? styles.userText : styles.modelText]}>
                {text}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    bubble: {
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
        backgroundColor: '#f3f4f6',
        borderTopLeftRadius: 4,
    },
    text: {
        fontSize: 14,
        lineHeight: 22,
    },
    userText: {
        color: '#ffffff',
    },
    modelText: {
        color: '#111827',
    },
    routeButton: {
        backgroundColor: '#10b981',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    routeButtonText: {
        color: '#fff',
        fontWeight: '600',
    },
    image: {
        width: '100%',
        height: 180,
        borderRadius: 8,
        marginBottom: 8,
    },
    imageTitle: {
        fontWeight: '600',
        marginBottom: 4,
    },
    loadingBubble: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    card: {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        padding: 16,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 3,
    },
    safetyCard: {
        borderColor: '#ef4444',
        borderLeftWidth: 4,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 12,
        textAlign: 'center',
    },
    cardSection: {
        marginBottom: 10,
    },
    label: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6b7280',
        marginBottom: 2,
    },
    value: {
        fontSize: 14,
        color: '#1f2937',
    },
    cardFooter: {
        fontSize: 11,
        color: '#9ca3af',
        fontStyle: 'italic',
        marginTop: 8,
        textAlign: 'center',
    },
    riskBadge: {
        alignSelf: 'flex-start',
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 12,
        borderWidth: 1,
        marginVertical: 10,
    },
    riskLabel: {
        fontSize: 12,
        fontWeight: 'bold',
    },
});
