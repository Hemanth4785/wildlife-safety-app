import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Pressable } from 'react-native';
import { XIcon, InfoIcon, AlertTriangleIcon, LocationMarkerIcon, ErrorIcon } from './icons';

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
    visible?: boolean;
}

const PredictionPanel: React.FC<PredictionPanelProps> = ({
    animal,
    predictedPath,
    riskLevel,
    onClose,
    onPointSelect,
    selectedPointIndex,
    visible = true
}) => {
    const safePath = Array.isArray(predictedPath) ? predictedPath : [];
    const hasData = safePath.length > 0;
    const riskLower = riskLevel?.toLowerCase() || 'low';
    const isHighRisk = riskLower === 'high';
    const riskColor = isHighRisk ? '#ef4444' : (riskLower === 'medium' ? '#f59e0b' : '#10b981');

    return (
        <View 
            style={[
                styles.containerOverlay, 
                visible ? styles.visibleOverlay : styles.hiddenOverlay
            ]}
            pointerEvents={visible ? 'auto' : 'none'}
        >
            <TouchableOpacity style={styles.overlayTouch} activeOpacity={1} onPress={onClose}>
                <Pressable style={styles.panel} onPress={(e) => { if ((e as any).stopPropagation) (e as any).stopPropagation(); }}>
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
                            {hasData ? `${riskLevel} Risk Movement Predicted` : 'Prediction Unavailable'}
                        </Text>
                    </View>

                    <Text style={styles.subTitle}>Predicted Path (Next 30–45 mins)</Text>
                    
                    <ScrollView 
                        style={styles.scrollList}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={true}
                    >
                        {hasData ? safePath.map((point, index) => (
                            <TouchableOpacity 
                                key={index}
                                style={[
                                    styles.predictionItem,
                                    selectedPointIndex === index && styles.selectedItem
                                ]}
                                onPress={(e) => {
                                    if (e.stopPropagation) e.stopPropagation();
                                    onPointSelect(point, index);
                                }}
                            >
                                <View style={[styles.indexCircle, { backgroundColor: riskColor }]}>
                                    <Text style={styles.indexText}>{index + 1}</Text>
                                </View>
                                <View style={styles.itemContent}>
                                    <Text style={styles.itemTitle}>Next Location #{index + 1}</Text>
                                    <Text style={styles.itemAddress} numberOfLines={2}>
                                        {point.address || `Unknown forest area (Lat: ${point.lat.toFixed(4)}, Lon: ${point.lon.toFixed(4)})`}
                                    </Text>
                                </View>
                                <LocationMarkerIcon width={18} height={18} color={selectedPointIndex === index ? riskColor : '#d1d5db'} />
                            </TouchableOpacity>
                        )) : (
                            <View style={styles.fallbackContainer}>
                                <ErrorIcon width={24} height={24} color="#ef4444" />
                                <Text style={styles.fallbackText}>Prediction unavailable – using degraded mode</Text>
                            </View>
                        )}
                    </ScrollView>

                    <View style={styles.footer}>
                        <Text style={styles.footerNote}>
                            * Predictions are AI-generated based on historical movement patterns.
                        </Text>
                    </View>
                </Pressable>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    containerOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    visibleOverlay: {
        backgroundColor: 'rgba(0,0,0,0.5)',
        opacity: 1,
    },
    hiddenOverlay: {
        backgroundColor: 'transparent',
        opacity: 0,
    },
    overlayTouch: {
        flex: 1,
        width: '100%',
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    panel: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        width: '100%',
        maxWidth: 500,
        padding: 20,
        paddingBottom: 40, // Extra padding for bottom
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -10 },
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
    fallbackContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 20,
        backgroundColor: '#fef2f2',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#fecaca',
    },
    fallbackText: {
        fontSize: 14,
        color: '#dc2626',
        fontWeight: '600',
    },
});

export default PredictionPanel;
