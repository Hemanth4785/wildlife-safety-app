import React, { useState } from 'react';
import { AVATARS } from '../constants';
import { XIcon } from './icons';

interface AvatarSelectionModalProps {
    currentAvatarId: string;
    onClose: () => void;
    onSave: (avatarId: string) => void;
}

const AvatarSelectionModal: React.FC<AvatarSelectionModalProps> = ({ currentAvatarId, onClose, onSave }) => {
    const [selectedId, setSelectedId] = useState(currentAvatarId);

    const handleSave = () => {
        onSave(selectedId);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800">Choose Your Avatar</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <XIcon />
                    </button>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 py-4">
                    {Object.values(AVATARS).map(avatar => {
                        const isSelected = selectedId === avatar.id;
                        return (
                            <div key={avatar.id} className="flex flex-col items-center" onClick={() => setSelectedId(avatar.id)}>
                                <button className={`w-20 h-20 rounded-full transition-all duration-200 ${isSelected ? 'ring-4 ring-emerald-500' : 'hover:scale-105'}`}>
                                    <avatar.icon className="w-full h-full" />
                                </button>
                                <p className={`mt-2 text-sm font-semibold ${isSelected ? 'text-emerald-600' : 'text-gray-600'}`}>{avatar.name}</p>
                            </div>
                        );
                    })}
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300">
                        Cancel
                    </button>
                    <button onClick={handleSave} className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">
                        Save Avatar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AvatarSelectionModal;
