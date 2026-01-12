import React, { useState } from 'react';
// FIX: Corrected import path for types
import type { Report } from '../types';
// FIX: Corrected import path for icons
import { PlusIcon, CalendarIcon, LocationMarkerIcon, AlertTriangleIcon, CameraIcon } from './icons';

const WILDLIFE_TYPES = ["Bear", "Mountain Lion", "Wolf", "Elk", "Moose", "Deer", "Coyote", "Bobcat"];

interface ReportsViewProps {
    reports: Report[];
    onAddReport: (report: Omit<Report, 'id' | 'timestamp'>) => void;
}

const ReportsView: React.FC<ReportsViewProps> = ({ reports, onAddReport }) => {
    const [activeTab, setActiveTab] = useState<'submit' | 'recent'>('submit');

    const [wildlifeType, setWildlifeType] = useState('');
    const [location, setLocation] = useState('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const handleUseCurrentLocation = () => {
        if (navigator.geolocation) {
            setLocation("Fetching location...");
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude } = position.coords;
                    setLocation(`Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)}`);
                },
                (error: GeolocationPositionError) => {
                    let errorMessage = "Could not get location. Please enter manually.";
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            errorMessage = "Location access denied. Please enable it in your browser settings.";
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMessage = "Location information is unavailable at the moment.";
                            break;
                        case error.TIMEOUT:
                            errorMessage = "The request to get user location timed out.";
                            break;
                    }
                    setLocation(errorMessage); 
                    console.error("Geolocation error:", error.message);
                }
            );
        } else {
           setLocation("Geolocation is not supported by this browser.");
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!wildlifeType || !location || !description) {
            alert("Please fill in all required fields.");
            return;
        }
        setIsSubmitting(true);
        // Simulate network delay
        setTimeout(() => {
            onAddReport({ wildlifeType, location, description });
            setWildlifeType('');
            setLocation('');
            setDescription('');
            setIsSubmitting(false);
            setActiveTab('recent'); // Switch to recent reports after submission
        }, 1000);
    };

    return (
        <div className="h-full w-full bg-gray-50 flex flex-col">
            <header className="p-4 bg-white border-b border-gray-200">
                <h1 className="text-xl font-bold text-gray-800">Wildlife Reports</h1>
                <p className="text-sm text-gray-500">Help keep the community safe</p>
            </header>
            
            <div className="p-4">
                <div className="flex bg-gray-200 rounded-lg p-1">
                    <button onClick={() => setActiveTab('submit')} className={`w-1/2 p-2 rounded-md text-sm font-semibold transition-colors ${activeTab === 'submit' ? 'bg-white text-emerald-600 shadow' : 'text-gray-600'}`}><PlusIcon className="inline-block w-4 h-4 mr-1"/> Submit Report</button>
                    <button onClick={() => setActiveTab('recent')} className={`w-1/2 p-2 rounded-md text-sm font-semibold transition-colors ${activeTab === 'recent' ? 'bg-white text-emerald-600 shadow' : 'text-gray-600'}`}><CalendarIcon className="inline-block w-4 h-4 mr-1"/> Recent Reports</button>
                </div>
            </div>

            <div className="flex-grow p-4 overflow-y-auto">
                {activeTab === 'submit' ? (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Wildlife Type *</label>
                            <div className="flex flex-wrap gap-2">
                                {WILDLIFE_TYPES.map(type => (
                                    <button key={type} type="button" onClick={() => setWildlifeType(type)} className={`px-4 py-2 text-sm rounded-full transition-colors ${wildlifeType === type ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-300 hover:bg-gray-100'}`}>{type}</button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label htmlFor="location" className="block text-sm font-medium text-gray-700">Location *</label>
                            <div className="mt-1">
                                <input type="text" id="location" value={location} onChange={(e) => setLocation(e.target.value)} required placeholder="e.g., Trail Junction A, Mile Marker 3" className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"/>
                            </div>
                            <button type="button" onClick={handleUseCurrentLocation} className="mt-2 text-sm text-emerald-600 hover:underline font-semibold flex items-center gap-1"><LocationMarkerIcon className="w-4 h-4" /> Use Current Location</button>
                        </div>
                        
                        <div>
                            <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description *</label>
                            <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} required rows={4} placeholder="Describe what you observed (behavior, size, direction of travel, etc.)" className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"></textarea>
                        </div>

                        <div>
                             <label className="block text-sm font-medium text-gray-700">Photo (Optional)</label>
                             <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                                <div className="space-y-1 text-center">
                                    <CameraIcon className="mx-auto h-12 w-12 text-gray-400" />
                                    <p className="text-sm text-gray-600">Drag & drop or click to upload</p>
                                </div>
                             </div>
                        </div>

                        <button type="submit" disabled={isSubmitting} className="w-full py-3 px-4 bg-emerald-600 text-white font-semibold rounded-lg shadow hover:bg-emerald-700 transition-colors disabled:bg-gray-400">{isSubmitting ? 'Submitting...' : 'Submit Report'}</button>
                        
                        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded-r-lg text-sm flex items-center gap-3">
                            <AlertTriangleIcon className="w-5 h-5" />
                            <p>Only report from a safe location. If you're in immediate danger, contact emergency services.</p>
                        </div>
                    </form>
                ) : (
                    <div className="space-y-4">
                        {reports.length > 0 ? reports.map(report => (
                            <div key={report.id} className="report-item">
                                <div className="flex justify-between items-start">
                                    <span className="text-lg font-bold text-gray-800">{report.wildlifeType}</span>
                                    <span className="text-xs text-gray-500">{new Date(report.timestamp).toLocaleString()}</span>
                                </div>
                                <p className="text-sm text-gray-600 mt-1"><strong className="font-medium">Location:</strong> {report.location}</p>
                                <p className="text-sm text-gray-800 mt-2 bg-gray-50 p-2 rounded-md">{report.description}</p>
                            </div>
                        )) : (
                             <p className="text-center text-gray-500 py-10">No recent reports submitted.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReportsView;