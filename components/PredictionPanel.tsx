import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Pressable } from 'react-native';
import { XIcon, InfoIcon, AlertTriangleIcon, LocationMarkerIcon } from './icons';

interface PredictionPoint {
    lat: number;
    lon: number;
    address: string;
}

interface PredictionPanelProps {
    animal: string;
    predictedPath: PredictionPoint[];
    riskLevel: string;
    onClose: () => void;
    onPointSelect: (point: PredictionPoint, index: number) => void;
    selectedPointIndex: number | null;
}

const PredictionPanel: React.FC<PredictionPanelProps> = ({
    animal,
    predictedPath,
    riskLevel,
    onClose,
    onPointSelect,
    selectedPointIndex
}) => {
    const isHighRisk = riskLevel === 'High';
    const riskColor = isHighRisk ? '#ef4444' : (riskLevel === 'Medium' ? '#f59e0b' : '#10b981');

    return (
        <View style={styles.container} pointerEvents="box-none">
            {/* Using Pressable with stopPropagation to prevent map clicks */}
            <Pressable 
                style={styles.panel} 
                onPress={(e) => {
                    // Prevent touch from reaching the map underneath
                    if (e.stopPropagation) e.stopPropagation();
                }}
            >
                <View style={styles.header}>
                    <View style={styles.headerTitleContainer}>
                        <InfoIcon width={20} height={20} color="#374151" />
                        <Text style={styles.headerTitle}>{animal} Prediction</Text>
                    </View>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <XIcon width={24} height={24} color="#6b7280" />
                    </TouchableOpacity>
                </View>

                <View style={[styles.riskBadge, { backgroundColor: riskColor + '20' }]}>
                    <AlertTriangleIcon width={16} height={16} color={riskColor} />
                    <Text style={[styles.riskText, { color: riskColor }]}>
                        {riskLevel} Risk Movement Predicted
                    </Text>
                </View>

                <Text style={styles.subTitle}>Predicted Path (Next 30–45 mins)</Text>
                
                <ScrollView 
                    style={styles.scrollList}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={true}
                >
                    {predictedPath.map((point, index) => (
                        <TouchableOpacity 
                            key={index}
                            style={[
                                styles.predictionItem,
                                selectedPointIndex === index && styles.selectedItem
                            ]}
                            onPress={(e) => {
                                if (e.stopPropagation) e.stopPropagation();
                                console.log(`[PredictionPanel] Selected point ${index}`);
                                onPointSelect(point, index);
                            }}
                        >
                            <View style={[styles.indexCircle, { backgroundColor: riskColor }]}>
                                <Text style={styles.indexText}>{index + 1}</Text>
                            </View>
                            <View style={styles.itemContent}>
                                <Text style={styles.itemTitle}>Next Location #{index + 1}</Text>
                                <Text style={styles.itemAddress} numberOfLines={2}>
                                    {point.address || `Lat: ${point.lat.toFixed(4)}, Lon: ${point.lon.toFixed(4)}`}
                                </Text>
                            </View>
                            <LocationMarkerIcon width={18} height={18} color={selectedPointIndex === index ? riskColor : '#d1d5db'} />
                        </TouchableOpacity>
                    ))}
                </ScrollView>

                <View style={styles.footer}>
                    <Text style={styles.footerNote}>
                        * Predictions are AI-generated based on historical movement patterns.
                    </Text>
                </View>
            </Pressable>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 100,
        left: 16,
        right: 16,
        zIndex: 2000,
        alignItems: 'center',
    },
    panel: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        width: '100%',
        maxWidth: 500,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 10,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 15,
    },
    headerTitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    closeButton: {
        padding: 4,
    },
    riskBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        marginBottom: 15,
    },
    riskText: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    subTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    scrollList: {
        maxHeight: 250,
    },
    scrollContent: {
        gap: 8,
    },
    predictionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#f9fafb',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#f3f4f6',
        gap: 12,
    },
    selectedItem: {
        backgroundColor: '#ffffff',
        borderColor: '#e5e7eb',
        borderWidth: 2,
    },
    indexCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    indexText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    itemContent: {
        flex: 1,
    },
    itemTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
    },
    itemAddress: {
        fontSize: 12,
        color: '#6b7280',
        marginTop: 2,
    },
    footer: {
        marginTop: 15,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
        paddingTop: 10,
    },
    footerNote: {
        fontSize: 10,
        color: '#9ca3af',
        fontStyle: 'italic',
        textAlign: 'center',
    },
});

export default PredictionPanel;
