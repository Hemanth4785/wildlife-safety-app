import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ScrollView, Image } from 'react-native';
import type { AnimalPrediction } from '../types';
import { XIcon } from './icons';
import { safeArray } from '../utils/safety';

interface AnimalDetailModalProps {
    animal: AnimalPrediction;
    onClose: () => void;
}

const AnimalDetailModal: React.FC<AnimalDetailModalProps> = ({ animal, onClose }: AnimalDetailModalProps) => {
    if (!animal) return null;
    console.log("DEBUG:", (animal as any)?.preds);
    const preds = safeArray<any>((animal as any)?.preds);
    return (
        <Modal
            visible={true}
            transparent={true}
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableOpacity 
                style={styles.overlay} 
                activeOpacity={1} 
                onPress={onClose}
            >
                <View style={styles.content} onStartShouldSetResponder={() => true}>
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            <Text style={styles.emoji}>{animal.emoji}</Text>
                            <View>
                                <Text style={styles.title}>{animal.common}</Text>
                                <Text style={styles.scientific}>{animal.scientific}</Text>
                            </View>
                        </View>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <XIcon width={24} height={24} color="#6b7280" />
                        </TouchableOpacity>
                    </View>
                    
                    <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollContentContainer}>
                        {animal.image && (
                            <Image 
                                source={{ uri: animal.image }} 
                                style={styles.image}
                                resizeMode="cover"
                            />
                        )}

                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Current Sighting</Text>
                            <View style={styles.infoBox}>
                                <View style={styles.infoItem}>
                                    <Text style={styles.infoLabel}>Location</Text>
                                    <Text style={styles.infoValue}>{animal?.current?.addr || 'Unknown location'}</Text>
                                </View>
                                <View style={styles.infoItem}>
                                    <Text style={styles.infoLabel}>Distance</Text>
                                    <Text style={styles.infoValue}>{Number.isFinite(Number(animal?.current?.dist_km)) ? Number(animal?.current?.dist_km) : 0} km from you</Text>
                                </View>
                            </View>
                        </View>

                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Predicted Path</Text>
                            {preds.length > 0 ? (
                                <View style={styles.predictionsList}>
                                    {preds.map((pred: any, index: number) => (
                                        <TouchableOpacity 
                                            key={index} 
                                            style={styles.predictionItem}
                                            onPress={(e) => {
                                                if (e.stopPropagation) e.stopPropagation();
                                                console.log(`[AnimalDetailModal] Prediction item ${index} clicked`);
                                                // We don't have a map reference here to pan, 
                                                // but we stop propagation to prevent closing.
                                            }}
                                        >
                                            <View style={styles.predictionNumber}>
                                                <Text style={styles.predictionNumberText}>{index + 1}</Text>
                                            </View>
                                            <View style={styles.predictionContent}>
                                                <Text style={styles.predictionTitle}>Next Location #{index + 1}</Text>
                                                <Text style={styles.predictionAddress}>
                                                    {pred?.addr
                                                        ? String(pred.addr)
                                                        : `Lat: ${Number(pred?.lat || 0).toFixed(4)}, Lon: ${Number(pred?.lon || 0).toFixed(4)}`}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            ) : (
                                <View style={styles.emptyPredictions}>
                                    <Text style={styles.emptyText}>No specific movement prediction available.</Text>
                                </View>
                            )}
                        </View>
                    </ScrollView>
                </View>
            </TouchableOpacity>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    content: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        width: '100%',
        maxWidth: 500,
        maxHeight: '80%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        flex: 1,
    },
    emoji: {
        fontSize: 48,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
    },
    scientific: {
        fontSize: 14,
        color: '#6b7280',
        fontStyle: 'italic',
        marginTop: -4,
    },
    closeButton: {
        padding: 4,
    },
    scrollContent: {
        flex: 1,
    },
    scrollContentContainer: {
        padding: 20,
        paddingBottom: 32,
    },
    image: {
        width: '100%',
        height: 192,
        borderRadius: 8,
        marginBottom: 24,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111827',
        marginBottom: 8,
    },
    infoBox: {
        backgroundColor: '#f9fafb',
        padding: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        gap: 12,
    },
    infoItem: {
        gap: 4,
    },
    infoLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    infoValue: {
        fontSize: 14,
        color: '#111827',
        lineHeight: 20,
    },
    predictionsList: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
    },
    predictionItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 16,
        gap: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    predictionNumber: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#059669',
        justifyContent: 'center',
        alignItems: 'center',
    },
    predictionNumberText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#ffffff',
    },
    predictionContent: {
        flex: 1,
    },
    predictionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
        marginBottom: 4,
    },
    predictionAddress: {
        fontSize: 14,
        color: '#6b7280',
        lineHeight: 20,
    },
    emptyPredictions: {
        padding: 16,
        backgroundColor: '#f9fafb',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
        color: '#6b7280',
        textAlign: 'center',
    },
});

export default AnimalDetailModal;
