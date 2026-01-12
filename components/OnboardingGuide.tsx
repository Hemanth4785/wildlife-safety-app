import React, { useState } from 'react';
import { ShieldIcon, LocationIcon, PaperPlaneIcon, AlertTriangleIcon, XIcon } from './icons';

interface OnboardingGuideProps {
    onClose: () => void;
}

const STEPS = [
    {
        icon: <ShieldIcon className="w-16 h-16 text-emerald-500" />,
        title: "Welcome to Wildlife Safety!",
        description: "Your guide to navigating safely in areas with wildlife. Let's walk through the key features to get you started.",
    },
    {
        icon: <LocationIcon className="w-16 h-16 text-blue-500" />,
        title: "Find Your Location",
        description: "Start by searching for a location on the Home screen. We'll analyze real-time data to show you recent wildlife activity and calculate a risk score for that area.",
    },
    {
        icon: <PaperPlaneIcon className="w-16 h-16 text-green-500 -rotate-45" />,
        title: "Plan Safe Routes",
        description: "Once you have a location, use the Safe Route Planner to get directions. Our routing AI automatically avoids areas with recent, high-risk animal sightings.",
    },
    {
        icon: <AlertTriangleIcon className="w-16 h-16 text-yellow-500" />,
        title: "Stay Alert While Navigating",
        description: "When you start navigation, we monitor your live location. If a new wildlife threat appears on your path, you'll get an alert and we'll automatically find a safer route for you.",
    },
];

const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ onClose }) => {
    const [step, setStep] = useState(0);
    const currentStep = STEPS[step];

    const handleNext = () => {
        if (step < STEPS.length - 1) {
            setStep(s => s + 1);
        } else {
            onClose();
        }
    };

    return (
        <div className="h-screen w-screen bg-gray-50 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-sm text-center">
                <div className="flex justify-center items-center h-24">
                    {currentStep.icon}
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mt-8 mb-3">{currentStep.title}</h2>
                <p className="text-gray-600 mb-8 min-h-[72px]">{currentStep.description}</p>
                
                <div className="flex justify-center items-center gap-2 mb-8">
                    {STEPS.map((_, index) => (
                         <div key={index} className={`w-2.5 h-2.5 rounded-full transition-all ${step === index ? 'bg-emerald-500 scale-110' : 'bg-gray-300'}`}></div>
                    ))}
                </div>

                <button 
                    onClick={handleNext} 
                    className="w-full py-3 bg-emerald-600 text-white font-semibold rounded-lg shadow hover:bg-emerald-700 transition-colors"
                >
                    {step === STEPS.length - 1 ? "Let's Go!" : 'Next'}
                </button>

                 {step < STEPS.length - 1 && (
                    <button onClick={onClose} className="mt-4 text-sm text-gray-500 hover:text-gray-700 font-medium">
                        Skip for now
                    </button>
                )}
            </div>
        </div>
    );
};

export default OnboardingGuide;