import React, { useState } from 'react';
import { User } from '../types';
import { AVATARS, NEARBY_KM } from '../constants';
import AvatarSelectionModal from './AvatarSelectionModal';
import { EditIcon, PaperPlaneIcon, ReportIcon, ChartIcon } from './icons';

interface ProfileViewProps {
    user: User;
    onLogout: () => void;
    onUpdateUser: (user: User) => void;
}

const StatCard: React.FC<{ icon: React.ReactNode; value: string | number; label: string }> = ({ icon, value, label }) => (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200/80 flex flex-col items-center justify-center text-center">
        <div className="text-emerald-600 mb-2">{icon}</div>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</p>
    </div>
);

const ProfileView: React.FC<ProfileViewProps> = ({ user, onLogout, onUpdateUser }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(user.name);
    
    const AvatarComponent = AVATARS[user.avatarId]?.icon || AVATARS['tiger'].icon;

    const handleAvatarSave = (avatarId: string) => {
        onUpdateUser({ ...user, avatarId });
        setIsModalOpen(false);
    };

    const handleRadiusChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newRadius = parseInt(e.target.value, 10);
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
        <div className="h-full bg-gray-50 flex flex-col p-4 space-y-6 overflow-y-auto pb-24">
            <header className="text-center">
                <div className="relative w-24 h-24 mx-auto">
                    <AvatarComponent className="w-full h-full rounded-full" />
                    <button 
                        onClick={() => setIsModalOpen(true)}
                        className="absolute bottom-0 right-0 bg-emerald-600 text-white rounded-full p-1.5 border-2 border-gray-50 hover:bg-emerald-700 transition-transform hover:scale-110"
                        aria-label="Edit profile picture"
                    >
                        <EditIcon className="w-4 h-4" />
                    </button>
                </div>
                <div className="mt-4">
                    {!isEditingName ? (
                        <div className="flex justify-center items-center gap-2">
                            <h1 className="text-2xl font-bold text-gray-800">{user.name}</h1>
                            <button
                                onClick={handleNameEditClick}
                                className="p-1 text-gray-500 hover:text-emerald-600 rounded-full transition-colors"
                                aria-label="Edit name"
                            >
                                <EditIcon className="w-5 h-5" />
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <input
                                type="text"
                                value={editedName}
                                onChange={(e) => setEditedName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
                                className="w-full max-w-xs px-3 py-2 text-center text-2xl font-bold text-gray-800 bg-white border border-emerald-500 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                autoFocus
                            />
                            <div className="flex justify-center gap-2">
                                <button onClick={handleNameSave} className="px-4 py-1.5 text-sm font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700">Save</button>
                                <button onClick={handleNameCancel} className="px-4 py-1.5 text-sm font-semibold text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300">Cancel</button>
                            </div>
                        </div>
                    )}
                </div>
                <p className="text-sm text-gray-500">{user.email}</p>
                <div className="mt-2 inline-flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                    Safety Score: 94%
                </div>
            </header>

            <div>
                <h2 className="text-base font-bold text-gray-700 mb-3">Your Safety Journey</h2>
                <div className="grid grid-cols-3 gap-3">
                    <StatCard icon={<PaperPlaneIcon className="w-6 h-6" />} value="47" label="Safe Trips" />
                    <StatCard icon={<ChartIcon className="w-6 h-6" />} value="312" label="Miles Tracked" />
                    <StatCard icon={<ReportIcon className="w-6 h-6" />} value="12" label="Reports" />
                </div>
            </div>

            <div>
                <h2 className="text-base font-bold text-gray-700 mb-3">Settings</h2>
                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200/80">
                    <label htmlFor="radius-slider" className="block text-sm font-medium text-gray-700">
                        Nearby Alert Radius
                    </label>
                    <div className="flex items-center gap-4 mt-2">
                        <input
                            id="radius-slider"
                            type="range"
                            min="1"
                            max="20"
                            step="1"
                            value={nearbyRadius}
                            onChange={handleRadiusChange}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="font-semibold text-emerald-600 w-16 text-center">{nearbyRadius} km</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                        Adjust the distance for which you receive "nearby" wildlife alerts on the map and dashboard.
                    </p>
                </div>
            </div>
            
            <div>
                <h2 className="text-base font-bold text-gray-700 mb-3">Achievements</h2>
                {/* Achievements can be implemented here */}
                <p className="text-center text-gray-500 text-sm py-4">Achievements feature coming soon!</p>
            </div>
            
            <div className="pt-4">
                 <button 
                    onClick={onLogout}
                    className="w-full text-center p-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors"
                 >
                    Logout
                 </button>
            </div>

            {isModalOpen && (
                <AvatarSelectionModal
                    currentAvatarId={user.avatarId}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleAvatarSave}
                />
            )}
        </div>
    );
};

export default ProfileView;