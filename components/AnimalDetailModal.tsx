import React from 'react';
import type { AnimalPrediction } from '../types';
import { XIcon } from './icons';

interface AnimalDetailModalProps {
    animal: AnimalPrediction;
    onClose: () => void;
}

const AnimalDetailModal: React.FC<AnimalDetailModalProps> = ({ animal, onClose }) => {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex justify-between items-start pb-4 border-b border-gray-200">
                    <div className="flex items-center gap-4">
                        <span className="text-4xl">{animal.emoji}</span>
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900">{animal.common}</h2>
                            <p className="text-sm text-gray-500 italic -mt-1">{animal.scientific}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 -mt-2 -mr-2">
                        <XIcon className="w-6 h-6" />
                    </button>
                </div>
                
                {/* Scrollable Content Area */}
                <div className="pt-5 space-y-6 max-h-[60vh] overflow-y-auto pr-2 -mr-4">
                    {/* Image */}
                    {animal.image && (
                         <img src={animal.image} alt={animal.common} className="w-full h-48 object-cover rounded-lg shadow-md" />
                    )}

                    {/* Current Location Section */}
                    <div>
                        <h3 className="text-md font-semibold text-gray-800 mb-2">Current Sighting</h3>
                        <div className="text-sm bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
                            <div>
                                <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Location</p>
                                <p className="text-gray-800 leading-relaxed mt-1">{animal.current.addr}</p>
                            </div>
                            <div>
                                <p className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Distance</p>
                                <p className="text-gray-800 mt-1">{animal.current.dist_km} km from you</p>
                            </div>
                        </div>
                    </div>

                    {/* Predicted Path Section */}
                    <div>
                        <h3 className="text-md font-semibold text-gray-800 mb-2">Predicted Path</h3>
                        {animal.preds.length > 0 ? (
                            <div className="border border-gray-200 rounded-lg">
                                <ul className="divide-y divide-gray-200">
                                    {animal.preds.map((pred, index) => (
                                        <li key={index} className="p-4 flex items-start gap-4">
                                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow">
                                                {index + 1}
                                            </div>
                                            <div className="text-sm flex-grow">
                                                <p className="font-semibold text-gray-800">Next Location #{index + 1}</p>
                                                <p className="text-gray-600 leading-relaxed mt-1">
                                                    {pred.addr ? pred.addr : `Lat: ${pred.lat.toFixed(4)}, Lon: ${pred.lon.toFixed(4)}`}
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : (
                            <div className="text-center text-sm text-gray-500 py-4 bg-gray-50 rounded-lg border border-gray-200">
                                <p>No specific movement prediction available.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AnimalDetailModal;