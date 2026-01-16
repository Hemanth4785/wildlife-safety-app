import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { getAIGuideResponse } from '../services/apiService';
import type { ChatMessage } from '../types';
import { PaperPlaneIcon, SpinnerIcon } from './icons';

const GuideView: React.FC = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            role: 'model',
            text: "Hi there! I'm your AI Wildlife Safety Guide, powered by real-time GBIF biodiversity data. I analyze actual wildlife occurrence patterns to help you navigate safely. I can explain route recommendations based on recent animal sightings, provide species-specific safety tips, and answer questions about wildlife behavior in your area. How can I help you stay safe today?"
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const scrollViewRef = useRef<ScrollView>(null);

    const scrollToBottom = () => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        const trimmedInput = input.trim();
        if (!trimmedInput || isLoading) return;

        const newMessages: ChatMessage[] = [...messages, { role: 'user', text: trimmedInput }];
        setMessages(newMessages);
        setInput('');
        setIsLoading(true);

        try {
            const response = await getAIGuideResponse(newMessages);
            setMessages((prev: ChatMessage[]) => [...prev, { role: 'model', text: response }]);
        } catch (error: any) {
            // Error already logged in apiService
            setMessages((prev: ChatMessage[]) => [...prev, {
                role: 'model',
                text: error?.message || "I'm sorry, I'm having trouble connecting right now. Please try again later."
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView 
            style={styles.container} 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={90}
        >
            <View style={styles.header}>
                <Text style={styles.title}>AI Wildlife Guide</Text>
                <Text style={styles.subtitle}>Your personal safety expert</Text>
            </View>
            
            <ScrollView 
                ref={scrollViewRef}
                style={styles.messagesContainer}
                contentContainerStyle={styles.messagesContent}
            >
                {messages.map((msg, index) => (
                    <View key={index} style={[styles.messageBubble, msg.role === 'user' ? styles.userBubble : styles.modelBubble]}>
                        <Text style={[styles.messageText, msg.role === 'user' ? styles.userText : styles.modelText]}>
                            {msg.text}
                        </Text>
                    </View>
                ))}
                {isLoading && (
                    <View style={[styles.messageBubble, styles.modelBubble, styles.loadingBubble]}>
                        <SpinnerIcon width={20} height={20} color="#059669" />
                        <Text style={styles.modelText}>Thinking...</Text>
                    </View>
                )}
            </ScrollView>

            <View style={styles.inputContainer}>
                <View style={styles.inputRow}>
                    <TextInput
                        style={styles.input}
                        value={input}
                        onChangeText={setInput}
                        placeholder="Ask about wildlife, routes, or general tips..."
                        placeholderTextColor="#9ca3af"
                        multiline={false}
                        editable={!isLoading}
                    />
                    <TouchableOpacity 
                        onPress={handleSend}
                        disabled={isLoading || !input.trim()}
                        style={[styles.sendButton, (isLoading || !input.trim()) && styles.sendButtonDisabled]}
                    >
                        <PaperPlaneIcon width={20} height={20} color="#ffffff" />
                    </TouchableOpacity>
                </View>
                <Text style={styles.disclaimer}>
                    Always use multiple sources for safety decisions. Trust your instincts in the field.
                </Text>
            </View>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    header: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        backgroundColor: '#f9fafb',
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 14,
        color: '#6b7280',
    },
    messagesContainer: {
        flex: 1,
    },
    messagesContent: {
        padding: 16,
        paddingBottom: 8,
    },
    messageBubble: {
        maxWidth: '80%',
        padding: 12,
        borderRadius: 16,
        marginBottom: 8,
    },
    userBubble: {
        alignSelf: 'flex-end',
        backgroundColor: '#059669',
    },
    modelBubble: {
        alignSelf: 'flex-start',
        backgroundColor: '#f3f4f6',
    },
    loadingBubble: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    messageText: {
        fontSize: 14,
        lineHeight: 20,
    },
    userText: {
        color: '#ffffff',
    },
    modelText: {
        color: '#111827',
    },
    inputContainer: {
        padding: 16,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    input: {
        flex: 1,
        paddingHorizontal: 16,
        paddingVertical: 10,
        fontSize: 14,
        color: '#374151',
        backgroundColor: '#f3f4f6',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 20,
    },
    sendButton: {
        padding: 12,
        backgroundColor: '#059669',
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendButtonDisabled: {
        backgroundColor: '#9ca3af',
    },
    disclaimer: {
        fontSize: 12,
        textAlign: 'center',
        color: '#9ca3af',
        marginTop: 8,
        paddingHorizontal: 16,
    },
});

export default GuideView;
