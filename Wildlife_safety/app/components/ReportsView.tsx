import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import type { Report } from '../types';
import { PlusIcon, CalendarIcon, LocationMarkerIcon, AlertTriangleIcon, CameraIcon, TrashIcon } from './icons';
import * as ImagePicker from 'expo-image-picker';
import { reverseGeocode, analyzeReportImage, searchLocations, deleteUserReport as deleteReportApi } from '../services/apiService';
import { auth } from '../services/firebase';
import { useAppContext } from '../contexts/AppContext';

const WILDLIFE_TYPES = ["Sloth Bear", "Tiger", "Leopard", "Asian Elephant", "Gaur", "Bison"];

interface ReportsViewProps {
    onAddReport: (report: Omit<Report, 'id' | 'timestamp'>) => Promise<void>;
}

const ReportsView: React.FC<ReportsViewProps> = ({ onAddReport }) => {
    const { reports, removeReport, setShowPredictions } = useAppContext();
    const [activeTab, setActiveTab] = useState<'submit' | 'recent'>('submit');
    const [wildlifeType, setWildlifeType] = useState('');
    const [location, setLocation] = useState('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [imageUri, setImageUri] = useState<string | undefined>(undefined);
    const [imageData, setImageData] = useState<string | undefined>(undefined);
    const [filterType, setFilterType] = useState<string>('All');
    const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

    const getAnimalLabel = (r: Report) => String((r as any).animal || r.wildlifeType || r.ai?.common || 'Unknown');
    const getCreatedAtDate = (r: Report): Date | null => {
        const createdAt = (r as any).createdAt;
        if (createdAt && typeof createdAt.toDate === 'function') return createdAt.toDate();
        const raw = (typeof (r as any).created_at === 'string' ? (r as any).created_at : r.timestamp);
        if (typeof raw === 'string') {
            const d = new Date(raw);
            return Number.isFinite(d.getTime()) ? d : null;
        }
        return null;
    };

    const isOwner = (r: Report) => {
        const uid = auth.currentUser?.uid;
        const ownerId = (r as any).userId;
        return Boolean(uid && ownerId && ownerId === uid);
    };

    const handleDeleteReport = (reportId: string | number) => {
        Alert.alert(
            'Delete report?',
            'Are you sure you want to delete this report?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const { deleteDoc, doc, getDoc } = await import('firebase/firestore');
                            const { db } = await import('../services/firebase');
                            const uid = auth.currentUser?.uid || '';
                            const ref = doc(db, 'reports', String(reportId));
                            try {
                                const snap = await getDoc(ref);
                                const data: any = snap.exists() ? snap.data() : {};
                                if (data?.userId && data.userId !== uid) {
                                    Alert.alert('Error', 'You do not have permission to delete this report.');
                                    return;
                                }
                            } catch {}
                            await deleteDoc(ref);
                            await removeReport(String(reportId));
                            return;
                        } catch {
                            try {
                                const res = await deleteReportApi(reportId);
                                if (res && res.status === 'success') {
                                    const deletedId = res.deletedId || String(reportId);
                                    await removeReport(deletedId);
                                    return;
                                }
                            } catch {}
                            Alert.alert('Error', 'Could not delete the report.');
                        }
                    }
                }
            ]
        );
    };

    const displayedReports = reports
        .filter(r => {
            if (filterType === 'All') return true;
            return getAnimalLabel(r) === filterType;
        });
    
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const { storage } = await import('../utils/storage');
                const tab = await storage.getItem<string>('reports.defaultTab');
                if (mounted && tab === 'recent') {
                    setActiveTab('recent');
                }
                await storage.removeItem('reports.defaultTab');
            } catch {
                // ignore
            }
        })();
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        if (activeTab === 'recent') {
            try { setShowPredictions(false); } catch {}
        }
    }, [activeTab, setShowPredictions]);

    const handleUseCurrentLocation = async () => {
        try {
            setLocation("Fetching location...");
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setLocation("Location permission denied. Please enable it in settings.");
                return;
            }
            const position = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            });
            const { latitude, longitude } = position.coords;
            setCoords({ lat: latitude, lon: longitude });
            let addr = `Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)}`;
            try {
                const r = await reverseGeocode(latitude, longitude);
                if (r && r !== 'Address not found') {
                    addr = `${r} (Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)})`;
                }
            } catch {}
            setLocation(addr);
        } catch (error: any) {
            let errorMessage = "Could not get location. Please enter manually.";
            if (error.code === 'E_LOCATION_SERVICES_DISABLED') {
                errorMessage = "Location services are disabled. Please enable them in settings.";
            } else if (error.code === 'E_LOCATION_UNAVAILABLE') {
                errorMessage = "Location information is unavailable at the moment.";
            } else if (error.code === 'E_LOCATION_TIMEOUT') {
                errorMessage = "The request to get user location timed out.";
            }
            setLocation(errorMessage);
            // Error handling is done above
        }
    };

    const handlePickImage = async () => {
        try {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
                Alert.alert("Permission required", "Please grant photo library access.");
                return;
            }
            const mediaTypes = (ImagePicker as any).MediaType
                ? [(ImagePicker as any).MediaType.Images]
                : (ImagePicker as any).MediaTypeOptions?.Images;
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes,
                allowsEditing: true,
                quality: 0.7,
                base64: true
            });
            const canceled = (result as any).canceled ?? (result as any).cancelled ?? false;
            const assets = (result as any).assets ?? ((result as any).uri ? [{ uri: (result as any).uri, base64: (result as any).base64 }] : []);
            if (!canceled && Array.isArray(assets) && assets.length > 0) {
                const a = assets[0];
                if (a?.uri) setImageUri(a.uri);
                setImageData(a?.base64 ?? undefined);
            }
        } catch (e: any) {
            Alert.alert("Error", e?.message ? String(e.message) : "Could not open photo picker.");
        }
    };
    const handleCaptureImage = async () => {
        try {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
                Alert.alert("Permission required", "Please grant camera access.");
                return;
            }
            const result = await ImagePicker.launchCameraAsync({
                allowsEditing: true,
                quality: 0.7,
                base64: true
            });
            const canceled = (result as any).canceled ?? (result as any).cancelled ?? false;
            const assets = (result as any).assets ?? ((result as any).uri ? [{ uri: (result as any).uri, base64: (result as any).base64 }] : []);
            if (!canceled && Array.isArray(assets) && assets.length > 0) {
                const a = assets[0];
                if (a?.uri) setImageUri(a.uri);
                setImageData(a?.base64 ?? undefined);
            }
        } catch (e: any) {
            Alert.alert("Error", e?.message ? String(e.message) : "Could not open camera.");
        }
    };

    const handleSubmit = async () => {
        if (!wildlifeType || !location || !description) {
            Alert.alert("Error", "Please fill in all required fields.");
            return;
        }
        if (!imageUri) {
            Alert.alert("Photo required", "Please upload an animal photo before submitting.");
            return;
        }
        setIsSubmitting(true);
        try {
            let aiInfo: { common?: string; scientific?: string; risk?: string; summary?: string } | undefined = undefined;
            if (imageData) {
                const res = await analyzeReportImage({ mimeType: 'image/jpeg', data: imageData });
                if (res) {
                    aiInfo = res;
                    if (!wildlifeType && res.common) {
                        setWildlifeType(res.common);
                    }
                }
            }
            let finalLat = coords?.lat;
            let finalLon = coords?.lon;
            if ((!finalLat || !finalLon) && location.trim().length > 0) {
                try {
                    const results = await searchLocations(location.trim());
                    if (Array.isArray(results) && results.length > 0) {
                        finalLat = results[0].lat;
                        finalLon = results[0].lon;
                    }
                } catch {}
            }
            await onAddReport({ wildlifeType, location, description, imageUri, lat: finalLat, lon: finalLon, ai: aiInfo });
            setWildlifeType('');
            setLocation('');
            setDescription('');
            setImageUri(undefined);
            setImageData(undefined);
            setCoords(null);
            setActiveTab('recent');
            try { setShowPredictions(false); } catch {}
        } catch (error) {
            Alert.alert("Error", "Failed to submit report. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Wildlife Reports</Text>
                <Text style={styles.headerSubtitle}>Help keep the community safe</Text>
            </View>
            
            <View style={styles.tabContainer}>
                <View style={styles.tabs}>
                    <TouchableOpacity 
                        onPress={() => setActiveTab('submit')} 
                        style={[styles.tab, activeTab === 'submit' && styles.activeTab]}
                    >
                        <PlusIcon width={16} height={16} color={activeTab === 'submit' ? '#059669' : '#6b7280'} />
                        <Text style={[styles.tabText, activeTab === 'submit' && styles.activeTabText]}>
                            Submit Report
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        onPress={() => setActiveTab('recent')} 
                        style={[styles.tab, activeTab === 'recent' && styles.activeTab]}
                    >
                        <CalendarIcon width={16} height={16} color={activeTab === 'recent' ? '#059669' : '#6b7280'} />
                        <Text style={[styles.tabText, activeTab === 'recent' && styles.activeTabText]}>
                            Recent Reports
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
                {activeTab === 'submit' ? (
                    <View style={styles.form}>
                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Wildlife Type *</Text>
                            <View style={styles.typeButtons}>
                                {WILDLIFE_TYPES.map(type => (
                                    <TouchableOpacity
                                        key={type}
                                        onPress={() => setWildlifeType(type)}
                                        style={[styles.typeButton, wildlifeType === type && styles.typeButtonActive]}
                                    >
                                        <Text style={[styles.typeButtonText, wildlifeType === type && styles.typeButtonTextActive]}>
                                            {type}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Location *</Text>
                            <TextInput
                                style={styles.input}
                                value={location}
                                onChangeText={setLocation}
                                placeholder="e.g., Trail Junction A, Mile Marker 3"
                                placeholderTextColor="#9ca3af"
                            />
                            <TouchableOpacity onPress={handleUseCurrentLocation} style={styles.locationButton}>
                                <LocationMarkerIcon width={16} height={16} color="#059669" />
                                <Text style={styles.locationButtonText}>Use Current Location</Text>
                            </TouchableOpacity>
                        </View>
                        
                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Description *</Text>
                            <TextInput
                                style={[styles.input, styles.textArea]}
                                value={description}
                                onChangeText={setDescription}
                                placeholder="Describe what you observed (behavior, size, direction of travel, etc.)"
                                placeholderTextColor="#9ca3af"
                                multiline
                                numberOfLines={4}
                                textAlignVertical="top"
                            />
                        </View>

                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Photo (Optional)</Text>
                            <View style={{ flexDirection: 'row', gap: 12 }}>
                                <TouchableOpacity style={[styles.photoUpload, { flex: 1 }]} onPress={handlePickImage}>
                                    <CameraIcon width={48} height={48} color="#9ca3af" />
                                    <Text style={styles.photoUploadText}>Pick from gallery</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.photoUpload, { flex: 1 }]} onPress={handleCaptureImage}>
                                    <CameraIcon width={48} height={48} color="#9ca3af" />
                                    <Text style={styles.photoUploadText}>Capture with camera</Text>
                                </TouchableOpacity>
                            </View>
                            {imageUri ? (
                                <View style={{ marginTop: 12 }}>
                                    <Image source={{ uri: imageUri }} style={{ width: '100%', height: 160, borderRadius: 8 }} />
                                </View>
                            ) : null}
                        </View>

                        <TouchableOpacity 
                            onPress={handleSubmit} 
                            disabled={isSubmitting}
                            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
                        >
                            <Text style={styles.submitButtonText}>
                                {isSubmitting ? 'Submitting...' : 'Submit Report'}
                            </Text>
                        </TouchableOpacity>
                        
                        <View style={styles.warningBox}>
                            <AlertTriangleIcon width={20} height={20} color="#d97706" />
                            <Text style={styles.warningText}>
                                Only report from a safe location. If you're in immediate danger, contact emergency services.
                            </Text>
                        </View>
                    </View>
                ) : (
                    <View style={styles.reportsList}>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                            {['All', ...WILDLIFE_TYPES].map(t => (
                                <TouchableOpacity
                                    key={t}
                                    onPress={() => setFilterType(t)}
                                    style={[
                                        styles.typeButton,
                                        filterType === t && styles.typeButtonActive
                                    ]}
                                >
                                    <Text style={[styles.typeButtonText, filterType === t && styles.typeButtonTextActive]}>
                                        {t}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        {displayedReports.length > 0 ? displayedReports.map((report) => {
                            const animalLabel = getAnimalLabel(report);
                            const createdAt = getCreatedAtDate(report);
                            const dateText = createdAt ? createdAt.toLocaleString() : '';
                            return (
                                <View key={String(report.id)} style={styles.reportItem}>
                                    <View style={styles.reportHeader}>
                                        <View style={styles.animalTag}>
                                            <Text style={styles.animalTagText}>{animalLabel}</Text>
                                        </View>
                                        <View style={styles.headerRight}>
                                            {isOwner(report) ? (
                                                <TouchableOpacity onPress={() => handleDeleteReport(report.id)} style={styles.deleteButton}>
                                                    <TrashIcon width={18} height={18} color="#ef4444" />
                                                </TouchableOpacity>
                                            ) : null}
                                            <Text style={styles.reportDate}>{dateText}</Text>
                                        </View>
                                    </View>
                                    <Text style={styles.reportMeta}>
                                        Reported by: {(report as any).userEmail || 'Unknown'}
                                    </Text>
                                    <Text style={styles.reportLocation}>
                                        <Text style={styles.reportLabel}>Location: </Text>
                                        {report.location || ''}
                                    </Text>
                                    <Text style={styles.reportDescription}>{report.description || ''}</Text>
                                    {(report as any).ai ? (
                                        <View style={styles.aiBox}>
                                            <Text style={styles.aiTitle}>
                                                Identified: {(report as any).ai.common || 'Unknown'}{(report as any).ai.scientific ? ` (${(report as any).ai.scientific})` : ''}
                                            </Text>
                                            {(report as any).ai.summary ? (
                                                <Text style={styles.aiText}>{(report as any).ai.summary}</Text>
                                            ) : null}
                                            {(report as any).ai.risk ? (
                                                <Text style={styles.aiMeta}>Risk: {(report as any).ai.risk}</Text>
                                            ) : null}
                                        </View>
                                    ) : null}
                                    {report.imageUri ? (
                                        <View style={{ marginTop: 10 }}>
                                            <Image source={{ uri: report.imageUri }} style={{ width: '100%', height: 160, borderRadius: 12 }} />
                                        </View>
                                    ) : null}
                                </View>
                            );
                        }) : (
                            <View style={styles.emptyState}>
                                <Text style={styles.emptyStateText}>No recent reports submitted.</Text>
                            </View>
                        )}
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    header: {
        padding: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#6b7280',
    },
    tabContainer: {
        padding: 16,
    },
    tabs: {
        flexDirection: 'row',
        backgroundColor: '#e5e7eb',
        borderRadius: 8,
        padding: 4,
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
        borderRadius: 6,
        gap: 4,
    },
    activeTab: {
        backgroundColor: '#ffffff',
    },
    tabText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
    },
    activeTabText: {
        color: '#059669',
    },
    content: {
        flex: 1,
    },
    contentContainer: {
        padding: 16,
        paddingBottom: 32,
    },
    form: {
        gap: 24,
    },
    formGroup: {
        gap: 8,
    },
    label: {
        fontSize: 14,
        fontWeight: '500',
        color: '#374151',
    },
    typeButtons: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    typeButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#d1d5db',
    },
    typeButtonActive: {
        backgroundColor: '#059669',
        borderColor: '#059669',
    },
    typeButtonText: {
        fontSize: 14,
        color: '#374151',
    },
    typeButtonTextActive: {
        color: '#ffffff',
    },
    input: {
        width: '100%',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 6,
        fontSize: 14,
        color: '#111827',
        backgroundColor: '#ffffff',
    },
    textArea: {
        height: 100,
        paddingTop: 10,
    },
    locationButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 8,
    },
    locationButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#059669',
    },
    photoUpload: {
        marginTop: 8,
        padding: 24,
        borderWidth: 2,
        borderColor: '#d1d5db',
        borderStyle: 'dashed',
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f9fafb',
    },
    photoUploadText: {
        marginTop: 8,
        fontSize: 14,
        color: '#6b7280',
    },
    submitButton: {
        width: '100%',
        paddingVertical: 12,
        backgroundColor: '#059669',
        borderRadius: 8,
        alignItems: 'center',
    },
    submitButtonDisabled: {
        backgroundColor: '#9ca3af',
    },
    submitButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
    },
    warningBox: {
        flexDirection: 'row',
        backgroundColor: '#fef3c7',
        borderLeftWidth: 4,
        borderLeftColor: '#f59e0b',
        padding: 16,
        borderRadius: 4,
        gap: 12,
    },
    warningText: {
        flex: 1,
        fontSize: 14,
        color: '#92400e',
    },
    reportsList: {
        gap: 16,
    },
    reportItem: {
        backgroundColor: '#ffffff',
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
        elevation: 3,
    },
    reportHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    headerRight: {
        alignItems: 'flex-end',
        gap: 6,
    },
    deleteButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#fef2f2',
        borderWidth: 1,
        borderColor: '#fee2e2',
        alignItems: 'center',
        justifyContent: 'center',
    },
    animalTag: {
        backgroundColor: '#ecfdf5',
        borderWidth: 1,
        borderColor: '#d1fae5',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
    },
    animalTagText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#065f46',
    },
    reportDate: {
        fontSize: 12,
        color: '#6b7280',
    },
    reportMeta: {
        fontSize: 12,
        color: '#6b7280',
        marginBottom: 6,
    },
    reportLocation: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 8,
    },
    reportLabel: {
        fontWeight: '500',
    },
    reportDescription: {
        fontSize: 14,
        color: '#111827',
        marginTop: 8,
        backgroundColor: '#f9fafb',
        padding: 10,
        borderRadius: 12,
    },
    aiBox: {
        marginTop: 10,
        backgroundColor: '#f3f4f6',
        padding: 10,
        borderRadius: 12,
    },
    aiTitle: {
        fontWeight: '700',
        color: '#111827',
    },
    aiText: {
        color: '#374151',
        marginTop: 4,
        lineHeight: 18,
    },
    aiMeta: {
        color: '#6b7280',
        marginTop: 4,
    },
    emptyState: {
        paddingVertical: 40,
        alignItems: 'center',
    },
    emptyStateText: {
        fontSize: 14,
        color: '#6b7280',
        textAlign: 'center',
    },
});

export default ReportsView;
