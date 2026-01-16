import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { View as ViewType } from '../types';
import { HomeIcon, MapIcon, ChatIcon, ReportIcon, ProfileIcon } from './icons';

interface BottomNavProps {
    currentView: ViewType;
    onNavigate: (view: ViewType) => void;
}

const NavItem: React.FC<{
    icon: React.ReactNode;
    label: string;
    isActive: boolean;
    onPress: () => void;
}> = ({ icon, label, isActive, onPress }) => {
    return (
        <TouchableOpacity
            onPress={onPress}
            style={styles.navItem}
            activeOpacity={0.7}
        >
            <View style={[styles.iconContainer, isActive && styles.activeIcon]}>
                {icon}
            </View>
            <Text style={[styles.label, isActive && styles.activeLabel]}>{label}</Text>
        </TouchableOpacity>
    );
};

const BottomNav: React.FC<BottomNavProps> = ({ currentView, onNavigate }) => {
    const navItems = [
        { view: ViewType.HOME, icon: <HomeIcon width={24} height={24} color={currentView === ViewType.HOME ? '#059669' : '#6b7280'} />, label: 'Home' },
        { view: ViewType.MAP, icon: <MapIcon width={24} height={24} color={currentView === ViewType.MAP ? '#059669' : '#6b7280'} />, label: 'Map' },
        { view: ViewType.GUIDE, icon: <ChatIcon width={24} height={24} color={currentView === ViewType.GUIDE ? '#059669' : '#6b7280'} />, label: 'AI Guide' },
        { view: ViewType.REPORTS, icon: <ReportIcon width={24} height={24} color={currentView === ViewType.REPORTS ? '#059669' : '#6b7280'} />, label: 'Reports' },
        { view: ViewType.PROFILE, icon: <ProfileIcon width={24} height={24} color={currentView === ViewType.PROFILE ? '#059669' : '#6b7280'} />, label: 'Profile' },
    ];

    return (
        <View style={styles.container}>
            <View style={styles.navContainer}>
                {navItems.map(item => (
                    <NavItem
                        key={item.label}
                        icon={item.icon}
                        label={item.label}
                        isActive={currentView === item.view}
                        onPress={() => onNavigate(item.view)}
                    />
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 64,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 5,
    },
    navContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        height: '100%',
        paddingHorizontal: 8,
    },
    navItem: {
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: 64,
    },
    iconContainer: {
        marginBottom: 4,
    },
    activeIcon: {
        // Icon color is handled in the icon component
    },
    label: {
        fontSize: 12,
        fontWeight: '500',
        color: '#6b7280',
    },
    activeLabel: {
        color: '#059669',
    },
});

export default BottomNav;
