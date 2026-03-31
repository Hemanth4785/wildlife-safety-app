import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { AVATARS } from '../constants';
import { XIcon } from './icons';

interface AvatarSelectionModalProps {
    currentAvatarId: string;
    onClose: () => void;
    onSave: (avatarId: string) => void;
}

const AvatarSelectionModal: React.FC<AvatarSelectionModalProps> = ({ currentAvatarId, onClose, onSave }: AvatarSelectionModalProps) => {
    const [selectedId, setSelectedId] = useState(currentAvatarId);

    const handleSave = () => {
        onSave(selectedId);
    };

    return (
        <Modal
            visible={true}
            transparent={true}
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableOpacity 
                style={styles.overlay} 
                activeOpacity={1} 
                onPress={onClose}
            >
                <View style={styles.content} onStartShouldSetResponder={() => true}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Choose Your Avatar</Text>
                        <TouchableOpacity onPress={onClose}>
                            <XIcon width={24} height={24} color="#6b7280" />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.grid}>
                        {Object.values(AVATARS).map(avatar => {
                            const isSelected = selectedId === avatar.id;
                            const AvatarIcon = avatar.icon;
                            return (
                                <TouchableOpacity
                                    key={avatar.id}
                                    onPress={() => setSelectedId(avatar.id)}
                                    style={styles.avatarItem}
                                >
                                    <View style={[styles.avatarButton, isSelected && styles.avatarButtonSelected]}>
                                        <AvatarIcon width={80} height={80} />
                                    </View>
                                    <Text style={[styles.avatarName, isSelected && styles.avatarNameSelected]}>
                                        {avatar.name}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                    <View style={styles.actions}>
                        <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
                            <Text style={styles.saveButtonText}>Save Avatar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </TouchableOpacity>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    content: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        width: '100%',
        maxWidth: 400,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        paddingVertical: 16,
        gap: 16,
    },
    avatarItem: {
        alignItems: 'center',
        width: '22%',
    },
    avatarButton: {
        width: 80,
        height: 80,
        borderRadius: 40,
        overflow: 'hidden',
    },
    avatarButtonSelected: {
        borderWidth: 4,
        borderColor: '#059669',
    },
    avatarName: {
        marginTop: 8,
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
    },
    avatarNameSelected: {
        color: '#059669',
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 12,
        marginTop: 24,
    },
    cancelButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: '#e5e7eb',
        borderRadius: 8,
    },
    cancelButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
    },
    saveButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: '#059669',
        borderRadius: 8,
    },
    saveButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#ffffff',
    },
});

export default AvatarSelectionModal;
