import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { ShieldIcon } from './icons';

interface LoginViewProps {
    onAuth: (mode: 'login' | 'signup', name: string, email: string, pass: string) => Promise<string | null>;
}

const LoginView: React.FC<LoginViewProps> = ({ onAuth }: LoginViewProps) => {
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('explorer@wildlife-safety.com');
    const [password, setPassword] = useState('password');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async () => {
        setError('');
        setIsLoading(true);
        try {
            const result = await onAuth(mode, name, email, password);
            if (result) {
                setError(result);
            }
        } catch (err) {
            setError('An error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const toggleMode = () => {
        setError('');
        setMode((prev: 'login' | 'signup') => prev === 'login' ? 'signup' : 'login');
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
                        <ShieldIcon width={48} height={48} color="#059669" />
                        <Text style={styles.title}>
                            {mode === 'login' ? 'Welcome Back' : 'Create Account'}
                        </Text>
                        <Text style={styles.subtitle}>
                            {mode === 'login' ? 'Sign in to continue to Wildlife Safety' : 'Join to start your safety journey'}
                        </Text>
                    </View>
                    
                    <View style={styles.form}>
                        {mode === 'signup' && (
                            <View style={styles.inputContainer}>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Full Name"
                                    value={name}
                                    onChangeText={setName}
                                    autoCapitalize="words"
                                />
                            </View>
                        )}
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
                                autoComplete={mode === 'login' ? 'password' : 'password-new'}
                            />
                        </View>
                        
                        {error ? <Text style={styles.error}>{error}</Text> : null}

                        <TouchableOpacity
                            style={[styles.button, isLoading && styles.buttonDisabled]}
                            onPress={handleSubmit}
                            disabled={isLoading}
                        >
                            <Text style={styles.buttonText}>
                                {isLoading ? 'Loading...' : mode === 'login' ? 'Sign in' : 'Create Account'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                    
                    <View style={styles.footer}>
                        <Text style={styles.footerText}>
                            {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
                        </Text>
                        <TouchableOpacity onPress={toggleMode}>
                            <Text style={styles.footerLink}>
                                {mode === 'login' ? 'Sign up' : 'Sign in'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                    
                    <Text style={styles.demoText}>
                        For Demo: Use email <Text style={styles.demoBold}>explorer@wildlife-safety.com</Text> and password <Text style={styles.demoBold}>password</Text> to sign in.
                    </Text>
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
    demoText: {
        marginTop: 16,
        fontSize: 12,
        color: '#9ca3af',
        textAlign: 'center',
        paddingHorizontal: 16,
    },
    demoBold: {
        fontWeight: 'bold',
    },
});

export default LoginView;
