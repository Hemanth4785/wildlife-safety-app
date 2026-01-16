import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import * as Location from 'expo-location';
import type { Report } from '../types';
import { PlusIcon, CalendarIcon, LocationMarkerIcon, AlertTriangleIcon, CameraIcon } from './icons';

const WILDLIFE_TYPES = ["Bear", "Mountain Lion", "Wolf", "Elk", "Moose", "Deer", "Coyote", "Bobcat"];

interface ReportsViewProps {
    reports: Report[];
    onAddReport: (report: Omit<Report, 'id' | 'timestamp'>) => Promise<void>;
}

const ReportsView: React.FC<ReportsViewProps> = ({ reports, onAddReport }) => {
    const [activeTab, setActiveTab] = useState<'submit' | 'recent'>('submit');
    const [wildlifeType, setWildlifeType] = useState('');
    const [location, setLocation] = useState('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
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
            setLocation(`Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)}`);
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

    const handleSubmit = async () => {
        if (!wildlifeType || !location || !description) {
            Alert.alert("Error", "Please fill in all required fields.");
            return;
        }
        setIsSubmitting(true);
        try {
            await onAddReport({ wildlifeType, location, description });
            setWildlifeType('');
            setLocation('');
            setDescription('');
            setActiveTab('recent');
        } catch (error) {
            Alert.alert("Error", "Failed to submit report. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <View style={styles.container}>
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
                            <View style={styles.photoUpload}>
                                <CameraIcon width={48} height={48} color="#9ca3af" />
                                <Text style={styles.photoUploadText}>Tap to upload photo</Text>
                            </View>
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
                        {reports.length > 0 ? reports.map(report => (
                            <View key={report.id} style={styles.reportItem}>
                                <View style={styles.reportHeader}>
                                    <Text style={styles.reportType}>{report.wildlifeType}</Text>
                                    <Text style={styles.reportDate}>
                                        {new Date(report.timestamp).toLocaleString()}
                                    </Text>
                                </View>
                                <Text style={styles.reportLocation}>
                                    <Text style={styles.reportLabel}>Location: </Text>
                                    {report.location}
                                </Text>
                                <Text style={styles.reportDescription}>{report.description}</Text>
                            </View>
                        )) : (
                            <View style={styles.emptyState}>
                                <Text style={styles.emptyStateText}>No recent reports submitted.</Text>
                            </View>
                        )}
                    </View>
                )}
            </ScrollView>
        </View>
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
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    reportHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    reportType: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
    },
    reportDate: {
        fontSize: 12,
        color: '#6b7280',
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
        padding: 8,
        borderRadius: 4,
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
