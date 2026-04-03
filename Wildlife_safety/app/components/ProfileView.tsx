import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import { User, View as ViewType } from '../types';
import { AVATARS, NEARBY_KM } from '../constants';
import AvatarSelectionModal from './AvatarSelectionModal';
import { EditIcon, PaperPlaneIcon, ReportIcon, ChartIcon } from './icons';
import { useAppContext } from '../contexts/AppContext';
import { storage } from '../utils/storage';
import { safeObject } from '../utils/safety';

interface ProfileViewProps {
    user?: User;
    onLogout: () => void;
    onUpdateUser?: (user: User) => void;
    onNavigate?: (view: ViewType) => void;
}

const StatCard: React.FC<{ icon: React.ReactNode; value: string | number; label: string }> = ({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) => (
    <View style={styles.statCard}>
        <View style={styles.statIcon}>{icon}</View>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
);

const ProfileView: React.FC<ProfileViewProps> = (props: ProfileViewProps) => {
    const { 
        reports, 
        user: contextUser, 
        updateUser: contextUpdateUser 
    } = useAppContext();

    const user = props.user || contextUser;
    const onUpdateUser = props.onUpdateUser || contextUpdateUser;
    const { onLogout, onNavigate } = props;

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(user?.name || '');
    const [safeTripsCount, setSafeTripsCount] = useState<number>(0);
    const [milesTracked, setMilesTracked] = useState<number>(0);
    
    useEffect(() => {
        if (user?.name) {
            setEditedName(user.name);
        }
    }, [user?.name]);

    if (!user) return null;
    
    const AvatarComponent = AVATARS[user.avatarId]?.icon || AVATARS['tiger'].icon;

    const handleAvatarSave = (avatarId: string) => {
        if (onUpdateUser) {
            console.log("DEBUG:", user);
            onUpdateUser({ ...safeObject<User>(user), avatarId });
        }
        setIsModalOpen(false);
    };

    const handleRadiusChange = (newRadius: number) => {
        if (onUpdateUser) {
            console.log("DEBUG:", user);
            onUpdateUser({ ...safeObject<User>(user), nearbyRadiusKm: newRadius });
        }
    };

    const handleNameEditClick = () => {
        setEditedName(user.name);
        setIsEditingName(true);
    };

    const handleNameSave = () => {
        if (editedName.trim() && onUpdateUser) {
            console.log("DEBUG:", user);
            onUpdateUser({ ...safeObject<User>(user), name: editedName.trim() });
        }
        setIsEditingName(false);
    };

    const handleNameCancel = () => {
        setIsEditingName(false);
        setEditedName(user.name);
    };

    const nearbyRadius = user.nearbyRadiusKm ?? NEARBY_KM;

    useEffect(() => {
        let isMounted = true;
        const loadStats = async () => {
            try {
                // Load lightweight counters if present (populated by navigation)
                const { storage } = await import('../utils/storage');
                const st = await storage.getItem<number>('safeTripsCount');
                const mk = await storage.getItem<number>('milesTrackedKm');
                if (isMounted) {
                    setSafeTripsCount(st ?? 0);
                    setMilesTracked(mk ?? 0);
                }
            } catch {
                // defaults applied above
            }
        };
        loadStats();
        return () => { isMounted = false; };
    }, []);

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
                    <StatCard icon={<PaperPlaneIcon width={24} height={24} color="#059669" />} value={safeTripsCount} label="Safe Trips" />
                    <StatCard icon={<ChartIcon width={24} height={24} color="#059669" />} value={milesTracked} label="Miles Tracked" />
                    <StatCard icon={<ReportIcon width={24} height={24} color="#059669" />} value={reports.length} label="Reports" />
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
                <Text style={styles.sectionTitle}>Tracked Reports</Text>
                {reports.length === 0 ? (
                    <Text style={styles.comingSoon}>No reports yet</Text>
                ) : (
                    <View style={styles.trackedGrid}>
                        {reports.slice(0, 8).map(r => (
                            <TouchableOpacity
                                key={r.id}
                                style={styles.trackedCard}
                                onPress={async () => {
                                    await storage.setItem('reports.defaultTab', 'recent');
                                    await storage.setItem('reports.highlightId', r.id);
                                    if (onNavigate) {
                                        onNavigate(ViewType.REPORTS);
                                    }
                                }}
                            >
                                {r.imageUri ? (
                                    <View style={styles.trackedImageWrap}>
                                        <View style={styles.trackedImage} />
                                    </View>
                                ) : (
                                    <View style={styles.trackedImageWrap}>
                                        <View style={styles.trackedImage} />
                                    </View>
                                )}
                                <Text style={styles.trackedTitle} numberOfLines={1}>{r.wildlifeType}</Text>
                                <Text style={styles.trackedSub} numberOfLines={1}>{new Date(r.timestamp).toLocaleDateString()}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </View>
            
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Achievements</Text>
                {reports.length >= 1 && (
                    <Text style={styles.comingSoon}>🏅 First Report submitted</Text>
                )}
                {reports.length >= 5 && (
                    <Text style={styles.comingSoon}>🥈 Explorer: 5+ reports</Text>
                )}
                {reports.length >= 10 && (
                    <Text style={styles.comingSoon}>🥇 Ranger: 10+ reports</Text>
                )}
                {reports.length === 0 && (
                    <Text style={styles.comingSoon}>No achievements yet</Text>
                )}
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
    trackedGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    trackedCard: {
        width: '48%',
        aspectRatio: 1,
        backgroundColor: '#ffffff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        padding: 10,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    trackedImageWrap: {
        width: '100%',
        height: '60%',
        borderRadius: 6,
        overflow: 'hidden',
        backgroundColor: '#f3f4f6',
        marginBottom: 6,
    },
    trackedImage: {
        width: '100%',
        height: '100%',
        backgroundColor: '#e5e7eb',
    },
    trackedTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
        textAlign: 'center',
        width: '100%',
    },
    trackedSub: {
        fontSize: 12,
        color: '#6b7280',
        textAlign: 'center',
        width: '100%',
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
