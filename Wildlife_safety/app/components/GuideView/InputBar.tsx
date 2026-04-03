import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PaperPlaneIcon, AlertTriangleIcon } from '../icons';
import Ionicons from '@expo/vector-icons/Ionicons';

interface InputBarProps {
  input: string;
  setInput: (text: string) => void;
  isLoading: boolean;
  handleSend: () => void;
  onQuickAction: (text: string) => void;
}

export const InputBar: React.FC<InputBarProps> = ({
  input,
  setInput,
  isLoading,
  handleSend,
  onQuickAction
}) => {
  const insets = useSafeAreaInsets();

  const internalHandleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;

    handleSend();
    setInput(""); // Clear input after sending
  };

  return (
    <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 12 }]}>
      
      {/* Quick Action Buttons */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={[styles.quickActionButton, styles.quickActionPrimary]}
          disabled={isLoading}
          activeOpacity={0.85}
          onPress={() => onQuickAction('plan a safe route')}
        >
          <PaperPlaneIcon width={16} height={16} color="#ffffff" />
          <Text style={styles.quickActionPrimaryText}>Plan Safe Route</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickActionButton, styles.quickActionSecondary]}
          disabled={isLoading}
          activeOpacity={0.85}
          onPress={() =>
            onQuickAction(
              'wildlife risks near me'
            )
          }
        >
          <AlertTriangleIcon width={16} height={16} color="#1B8E5A" />
          <Text style={styles.quickActionSecondaryText}>Check Nearby Risks</Text>
        </TouchableOpacity>
      </View>

      {/* Chat Input Row */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about wildlife risks, safe routes, or nearby forest offices..."
          placeholderTextColor="#9ca3af"
          multiline={false}
          numberOfLines={1}
          editable={!isLoading}
          returnKeyType="send"
          onSubmitEditing={internalHandleSend}
          blurOnSubmit={false}
        />

        <TouchableOpacity
          onPress={internalHandleSend}
          disabled={isLoading || !input.trim()}
          activeOpacity={0.85}
          style={[
            styles.sendButton,
            (isLoading || !input.trim()) && styles.sendButtonDisabled
          ]}
        >
          <Ionicons name="arrow-up" size={18} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Disclaimer */}
      <Text style={styles.disclaimer}>
        Always use multiple sources for safety decisions. Trust your instincts in the field.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  inputContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: '#f9fafb',
  },

  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginVertical: 10,
  },

  quickActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },

  quickActionPrimary: {
    backgroundColor: '#1B8E5A',
    borderColor: '#1B8E5A',
  },

  quickActionSecondary: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
  },

  quickActionPrimaryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  quickActionSecondaryText: {
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '600',
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 30,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },

  sendButton: {
    width: 40,
    height: 40,
    backgroundColor: '#1B8E5A',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  sendButtonDisabled: {
    backgroundColor: '#9ca3af',
  },

  disclaimer: {
    fontSize: 11,
    textAlign: 'center',
    color: '#9ca3af',
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
});