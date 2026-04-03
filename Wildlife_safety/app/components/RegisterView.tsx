import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';

interface RegisterViewProps {
    onSignup: (name: string, email: string, pass: string) => Promise<string | null>;
    onSwitchToLogin: () => void;
}

const RegisterView: React.FC<RegisterViewProps> = ({ onSignup, onSwitchToLogin }: RegisterViewProps) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const validate = () => {
        if (!name || !email || !password) {
            setError('All fields are required.');
            return false;
        }
        if (!/\S+@\S+\.\S+/.test(email)) {
            setError('Please enter a valid email address.');
            return false;
        }
        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            return false;
        }
        return true;
    };

    const handleSubmit = async () => {
        setError('');
        if (!validate()) return;
        
        setIsLoading(true);
        try {
            const result = await onSignup(name, email, password);
            if (result) {
                if (result.includes('auth/email-already-in-use')) {
                    setError('An account already exists with this email.');
                } else if (result.includes('auth/invalid-email')) {
                    setError('Invalid email address.');
                } else if (result.includes('auth/weak-password')) {
                    setError('Password is too weak.');
                } else {
                    setError(result);
                }
            }
        } catch (err) {
            setError('An error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView 
            style={styles.container} 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ScrollView 
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.card}>
                    <View style={styles.header}>
                        <Text style={{ fontSize: 48 }}>🛡️</Text>
                        <Text style={styles.title}>Create Account</Text>
                        <Text style={styles.subtitle}>Join to start your safety journey</Text>
                    </View>
                    
                    <View style={styles.form}>
                        <View style={styles.inputContainer}>
                            <TextInput
                                style={styles.input}
                                placeholder="Full Name"
                                value={name}
                                onChangeText={setName}
                                autoCapitalize="words"
                            />
                        </View>
                        <View style={styles.inputContainer}>
                            <TextInput
                                style={styles.input}
                                placeholder="Email address"
                                value={email}
                                onChangeText={setEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoComplete="email"
                            />
                        </View>
                        <View style={styles.inputContainer}>
                            <TextInput
                                style={styles.input}
                                placeholder="Password"
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                                autoComplete="password-new"
                            />
                        </View>
                        
                        {error ? <Text style={styles.error}>{error}</Text> : null}

                        <TouchableOpacity
                            style={[styles.button, isLoading && styles.buttonDisabled]}
                            onPress={handleSubmit}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <ActivityIndicator color="#ffffff" />
                            ) : (
                                <Text style={styles.buttonText}>Create Account</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                    
                    <View style={styles.footer}>
                        <Text style={styles.footerText}>Already have an account? </Text>
                        <TouchableOpacity onPress={onSwitchToLogin}>
                            <Text style={styles.footerLink}>Sign in</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        padding: 16,
    },
    card: {
        width: '100%',
        maxWidth: 400,
        alignSelf: 'center',
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 32,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    header: {
        alignItems: 'center',
        marginBottom: 32,
    },
    title: {
        marginTop: 16,
        fontSize: 28,
        fontWeight: 'bold',
        color: '#111827',
    },
    subtitle: {
        marginTop: 8,
        fontSize: 14,
        color: '#6b7280',
        textAlign: 'center',
    },
    form: {
        marginTop: 8,
    },
    inputContainer: {
        marginBottom: 12,
    },
    input: {
        width: '100%',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 6,
        fontSize: 14,
        color: '#111827',
        backgroundColor: '#ffffff',
    },
    button: {
        width: '100%',
        paddingVertical: 12,
        backgroundColor: '#059669',
        borderRadius: 6,
        alignItems: 'center',
        marginTop: 8,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    buttonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '600',
    },
    error: {
        fontSize: 14,
        color: '#dc2626',
        textAlign: 'center',
        marginBottom: 8,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
    footerText: {
        fontSize: 14,
        color: '#6b7280',
    },
    footerLink: {
        fontSize: 14,
        fontWeight: '600',
        color: '#059669',
    },
});

export default RegisterView;
