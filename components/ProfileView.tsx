import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import { User } from '../types';
import { AVATARS, NEARBY_KM } from '../constants';
import AvatarSelectionModal from './AvatarSelectionModal';
import { EditIcon, PaperPlaneIcon, ReportIcon, ChartIcon } from './icons';

interface ProfileViewProps {
    user: User;
    onLogout: () => void;
    onUpdateUser: (user: User) => void;
}

const StatCard: React.FC<{ icon: React.ReactNode; value: string | number; label: string }> = ({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) => (
    <View style={styles.statCard}>
        <View style={styles.statIcon}>{icon}</View>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
);

const ProfileView: React.FC<ProfileViewProps> = ({ user, onLogout, onUpdateUser }: ProfileViewProps) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(user.name);
    
    const AvatarComponent = AVATARS[user.avatarId]?.icon || AVATARS['tiger'].icon;

    const handleAvatarSave = (avatarId: string) => {
        onUpdateUser({ ...user, avatarId });
        setIsModalOpen(false);
    };

    const handleRadiusChange = (newRadius: number) => {
        onUpdateUser({ ...user, nearbyRadiusKm: newRadius });
    };

    const handleNameEditClick = () => {
        setEditedName(user.name);
        setIsEditingName(true);
    };

    const handleNameSave = () => {
        if (editedName.trim()) {
            onUpdateUser({ ...user, name: editedName.trim() });
        }
        setIsEditingName(false);
    };

    const handleNameCancel = () => {
        setIsEditingName(false);
        setEditedName(user.name);
    };

    const nearbyRadius = user.nearbyRadiusKm ?? NEARBY_KM;

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
            <View style={styles.header}>
                <View style={styles.avatarContainer}>
                    <View style={styles.avatarWrapper}>
                        <AvatarComponent width={96} height={96} />
                    </View>
                    <TouchableOpacity 
                        onPress={() => setIsModalOpen(true)}
                        style={styles.editAvatarButton}
                    >
                        <EditIcon width={16} height={16} color="#ffffff" />
                    </TouchableOpacity>
                </View>
                <View style={styles.nameSection}>
                    {!isEditingName ? (
                        <View style={styles.nameRow}>
                            <Text style={styles.name}>{user.name}</Text>
                            <TouchableOpacity
                                onPress={handleNameEditClick}
                                style={styles.editNameButton}
                            >
                                <EditIcon width={20} height={20} color="#6b7280" />
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.editNameContainer}>
                            <TextInput
                                style={styles.nameInput}
                                value={editedName}
                                onChangeText={setEditedName}
                                autoFocus
                            />
                            <View style={styles.nameActions}>
                                <TouchableOpacity onPress={handleNameSave} style={styles.saveButton}>
                                    <Text style={styles.saveButtonText}>Save</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={handleNameCancel} style={styles.cancelButton}>
                                    <Text style={styles.cancelButtonText}>Cancel</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                </View>
                <Text style={styles.email}>{user.email}</Text>
                <View style={styles.safetyScore}>
                    <Text style={styles.safetyScoreText}>Safety Score: 94%</Text>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Your Safety Journey</Text>
                <View style={styles.statsGrid}>
                    <StatCard icon={<PaperPlaneIcon width={24} height={24} color="#059669" />} value="47" label="Safe Trips" />
                    <StatCard icon={<ChartIcon width={24} height={24} color="#059669" />} value="312" label="Miles Tracked" />
                    <StatCard icon={<ReportIcon width={24} height={24} color="#059669" />} value="12" label="Reports" />
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Settings</Text>
                <View style={styles.settingsCard}>
                    <Text style={styles.settingsLabel}>Nearby Alert Radius</Text>
                    <View style={styles.sliderContainer}>
                        <Slider
                            style={styles.slider}
                            minimumValue={1}
                            maximumValue={20}
                            step={1}
                            value={nearbyRadius}
                            onValueChange={handleRadiusChange}
                            minimumTrackTintColor="#059669"
                            maximumTrackTintColor="#e5e7eb"
                            thumbTintColor="#059669"
                        />
                        <Text style={styles.sliderValue}>{nearbyRadius} km</Text>
                    </View>
                    <Text style={styles.settingsHint}>
                        Adjust the distance for which you receive "nearby" wildlife alerts on the map and dashboard.
                    </Text>
                </View>
            </View>
            
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Achievements</Text>
                <Text style={styles.comingSoon}>Achievements feature coming soon!</Text>
            </View>
            
            <View style={styles.logoutSection}>
                <TouchableOpacity onPress={onLogout} style={styles.logoutButton}>
                    <Text style={styles.logoutButtonText}>Logout</Text>
                </TouchableOpacity>
            </View>

            {isModalOpen && (
                <AvatarSelectionModal
                    currentAvatarId={user.avatarId}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleAvatarSave}
                />
            )}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    contentContainer: {
        padding: 16,
        paddingBottom: 100,
    },
    header: {
        alignItems: 'center',
        marginBottom: 24,
    },
    avatarContainer: {
        position: 'relative',
        marginBottom: 16,
    },
    avatarWrapper: {
        width: 96,
        height: 96,
        borderRadius: 48,
        overflow: 'hidden',
    },
    editAvatarButton: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        backgroundColor: '#059669',
        borderRadius: 16,
        padding: 6,
        borderWidth: 2,
        borderColor: '#ffffff',
    },
    nameSection: {
        marginBottom: 8,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    name: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
    },
    editNameButton: {
        padding: 4,
    },
    editNameContainer: {
        alignItems: 'center',
        gap: 8,
    },
    nameInput: {
        width: '100%',
        maxWidth: 300,
        paddingHorizontal: 12,
        paddingVertical: 8,
        fontSize: 24,
        fontWeight: 'bold',
        textAlign: 'center',
        color: '#111827',
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#059669',
        borderRadius: 6,
    },
    nameActions: {
        flexDirection: 'row',
        gap: 8,
    },
    saveButton: {
        paddingHorizontal: 16,
        paddingVertical: 6,
        backgroundColor: '#059669',
        borderRadius: 6,
    },
    saveButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#ffffff',
    },
    cancelButton: {
        paddingHorizontal: 16,
        paddingVertical: 6,
        backgroundColor: '#e5e7eb',
        borderRadius: 6,
    },
    cancelButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
    },
    email: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 8,
    },
    safetyScore: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        backgroundColor: '#d1fae5',
        borderRadius: 20,
    },
    safetyScoreText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#065f46',
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#374151',
        marginBottom: 12,
    },
    statsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
    },
    statCard: {
        flex: 1,
        backgroundColor: '#ffffff',
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    statIcon: {
        marginBottom: 8,
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 12,
        fontWeight: '500',
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    settingsCard: {
        backgroundColor: '#ffffff',
        padding: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    settingsLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#374151',
        marginBottom: 8,
    },
    sliderContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        marginBottom: 8,
    },
    slider: {
        flex: 1,
        height: 40,
    },
    sliderValue: {
        fontSize: 16,
        fontWeight: '600',
        color: '#059669',
        width: 64,
        textAlign: 'center',
    },
    settingsHint: {
        fontSize: 12,
        color: '#6b7280',
        marginTop: 8,
    },
    comingSoon: {
        textAlign: 'center',
        color: '#6b7280',
        fontSize: 14,
        paddingVertical: 16,
    },
    logoutSection: {
        paddingTop: 16,
    },
    logoutButton: {
        width: '100%',
        paddingVertical: 12,
        backgroundColor: '#e5e7eb',
        borderRadius: 8,
        alignItems: 'center',
    },
    logoutButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
    },
});

export default ProfileView;
