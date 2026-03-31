import React from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { ChatIcon } from './icons';
import { useChat } from './GuideView/useChat';
import { MessageItem } from './GuideView/MessageItem';
import { InputBar } from './GuideView/InputBar';

interface GuideViewProps {
    onOpenRouteLink?: (startQuery: string, destQuery: string) => void;
    recentSightings?: any[];
    riskZones?: any[];
}

const GuideView: React.FC<GuideViewProps> = ({ onOpenRouteLink, recentSightings, riskZones }) => {
    const { 
        messages, 
        input, 
        setInput, 
        isLoading, 
        scrollViewRef, 
        handleSend,
        addMessage 
    } = useChat(onOpenRouteLink, recentSightings, riskZones);

    return (
        <View style={styles.container}>
            <KeyboardAvoidingView 
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
                {/* Header Section */}
                <View style={styles.header}>
                    <View style={styles.headerCard}>
                        <View style={styles.headerRow}>
                            <View style={styles.headerIcon}>
                                <ChatIcon width={18} height={18} color="#065f46" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.title}>AI Wildlife Guide</Text>
                                <Text style={styles.subtitle}>Ask about risks, safe places, and routes</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Chat Section */}
                <ScrollView 
                    ref={scrollViewRef}
                    style={styles.messagesContainer}
                    contentContainerStyle={[
                        styles.messagesContent,
                        messages.length <= 1 && { justifyContent: 'center', flexGrow: 1 }
                    ]}
                    keyboardShouldPersistTaps="handled"
                >
                    {messages.length <= 1 && !isLoading ? (
                        <View style={styles.emptyState}>
                            <View style={styles.emptyIcon}>
                                <ChatIcon width={22} height={22} color="#059669" />
                            </View>
                            <Text style={styles.emptyTitle}>Ask about wildlife safety near you</Text>
                            <Text style={styles.emptyText}>
                                Try: “Wildlife risks in Ooty” or “Plan route from Kotagiri to Coonoor”.
                            </Text>
                        </View>
                    ) : null}

                    {messages.map((msg, index) => (
                        <MessageItem 
                            key={index} 
                            message={msg} 
                            onOpenRouteLink={onOpenRouteLink} 
                        />
                    ))}

                    {isLoading && (
                        <MessageItem 
                            message={{ role: 'model', text: '' }} 
                            isLoading={true} 
                        />
                    )}
                </ScrollView>

                {/* Input Section */}
                <InputBar 
                    input={input}
                    setInput={setInput}
                    isLoading={isLoading}
                    handleSend={handleSend}
                    onQuickAction={(text) => {
                        handleSend(text);
                    }}
                />
            </KeyboardAvoidingView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    header: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 12,
        backgroundColor: '#f9fafb',
    },
    headerCard: {
        backgroundColor: '#ecfdf5',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#d1fae5',
        padding: 14,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headerIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#d1fae5',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
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
        paddingBottom: 20, 
        flexGrow: 1,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        paddingHorizontal: 16,
        marginBottom: 16,
    },
    emptyIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f3f4f6',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    emptyTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1f2937',
        marginBottom: 4,
        textAlign: 'center',
    },
    emptyText: {
        fontSize: 12,
        color: '#6b7280',
        textAlign: 'center',
        lineHeight: 18,
    },
});

export default GuideView;
