import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LocationIcon, PaperPlaneIcon, AlertTriangleIcon } from './icons';

interface OnboardingGuideProps {
    onClose: () => void;
}

const STEPS = [
    {
        icon: <Text style={{ fontSize: 64 }}>🛡️</Text>,
        title: "Welcome to Wildlife Safety!",
        description: "Your guide to navigating safely in areas with wildlife. Let's walk through the key features to get you started.",
    },
    {
        icon: <LocationIcon width={64} height={64} color="#2563eb" />,
        title: "Find Your Location",
        description: "Start by searching for a location on the Home screen. We'll analyze real-time data to show you recent wildlife activity and calculate a risk score for that area.",
    },
    {
        icon: <PaperPlaneIcon width={64} height={64} color="#10b981" />,
        title: "Plan Safe Routes",
        description: "Once you have a location, use the Safe Route Planner to get directions. Our routing AI automatically avoids areas with recent, high-risk animal sightings.",
    },
    {
        icon: <AlertTriangleIcon width={64} height={64} color="#eab308" />,
        title: "Stay Alert While Navigating",
        description: "When you start navigation, we monitor your live location. If a new wildlife threat appears on your path, you'll get an alert and we'll automatically find a safer route for you.",
    },
];

const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ onClose }: OnboardingGuideProps) => {
    const [step, setStep] = useState(0);
    const currentStep = STEPS[step];

    const handleNext = () => {
        if (step < STEPS.length - 1) {
            setStep((s: number) => s + 1);
        } else {
            onClose();
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <View style={styles.iconContainer}>
                    {currentStep.icon}
                </View>
                <Text style={styles.title}>{currentStep.title}</Text>
                <Text style={styles.description}>{currentStep.description}</Text>
                
                <View style={styles.dots}>
                    {STEPS.map((_, index) => (
                        <View 
                            key={index} 
                            style={[
                                styles.dot, 
                                step === index && styles.dotActive
                            ]} 
                        />
                    ))}
                </View>

                <TouchableOpacity 
                    onPress={handleNext} 
                    style={styles.nextButton}
                >
                    <Text style={styles.nextButtonText}>
                        {step === STEPS.length - 1 ? "Let's Go!" : 'Next'}
                    </Text>
                </TouchableOpacity>

                {step < STEPS.length - 1 && (
                    <TouchableOpacity onPress={onClose} style={styles.skipButton}>
                        <Text style={styles.skipButtonText}>Skip for now</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    content: {
        width: '100%',
        maxWidth: 400,
        alignItems: 'center',
    },
    iconContainer: {
        height: 96,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 32,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 12,
        textAlign: 'center',
    },
    description: {
        fontSize: 16,
        color: '#6b7280',
        marginBottom: 32,
        minHeight: 72,
        textAlign: 'center',
        lineHeight: 24,
    },
    dots: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        marginBottom: 32,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#d1d5db',
    },
    dotActive: {
        backgroundColor: '#059669',
        transform: [{ scale: 1.1 }],
    },
    nextButton: {
        width: '100%',
        paddingVertical: 12,
        backgroundColor: '#059669',
        borderRadius: 8,
        alignItems: 'center',
    },
    nextButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
    },
    skipButton: {
        marginTop: 16,
    },
    skipButtonText: {
        fontSize: 14,
        color: '#6b7280',
        fontWeight: '500',
    },
});

export default OnboardingGuide;
