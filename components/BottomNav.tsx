import React from 'react';
// FIX: Corrected import path for types
import { View } from '../types';
// FIX: Corrected import path for icons
import { HomeIcon, MapIcon, ChatIcon, ReportIcon, ProfileIcon } from './icons';

interface BottomNavProps {
    currentView: View;
    onNavigate: (view: View) => void;
}

const NavItem: React.FC<{
    icon: React.ReactNode;
    label: string;
    isActive: boolean;
    onClick: () => void;
}> = ({ icon, label, isActive, onClick }) => {
    const activeClass = isActive ? 'text-emerald-600' : 'text-gray-500 hover:text-emerald-500';
    return (
        <button
            onClick={onClick}
            className={`flex flex-col items-center justify-center w-full h-16 transition-colors duration-200 ease-in-out ${activeClass}`}
        >
            {icon}
            <span className="text-xs font-medium mt-1">{label}</span>
        </button>
    );
};


const BottomNav: React.FC<BottomNavProps> = ({ currentView, onNavigate }) => {
    const navItems = [
        { view: View.HOME, icon: <HomeIcon className="w-6 h-6"/>, label: 'Home' },
        { view: View.MAP, icon: <MapIcon className="w-6 h-6"/>, label: 'Map' },
        { view: View.GUIDE, icon: <ChatIcon className="w-6 h-6"/>, label: 'AI Guide' },
        { view: View.REPORTS, icon: <ReportIcon className="w-6 h-6"/>, label: 'Reports' },
        { view: View.PROFILE, icon: <ProfileIcon className="w-6 h-6"/>, label: 'Profile' },
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-200 shadow-[0_-1px_3px_rgba(0,0,0,0.05)] z-[1500]">
            <div className="flex items-center justify-around max-w-lg mx-auto h-full">
                {navItems.map(item => (
                    <NavItem
                        key={item.label}
                        icon={item.icon}
                        label={item.label}
                        isActive={currentView === item.view}
                        onClick={() => onNavigate(item.view)}
                    />
                ))}
            </div>
        </div>
    );
};

export default BottomNav;