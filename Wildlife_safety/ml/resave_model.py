
import os
import sys
import traceback
import json

# Setup paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LSTM_MODEL_DIR = os.path.join(BASE_DIR, "models", "lstm")
GENERIC_MODEL_PATH = os.path.join(LSTM_MODEL_DIR, "lstm_generic.keras")
H5_MODEL_PATH = os.path.join(LSTM_MODEL_DIR, "lstm_generic.h5")

def fix_and_resave():
    try:
        import tensorflow as tf
        import keras
        from keras.models import Sequential
        from keras.layers import LSTM, Dense, Dropout, InputLayer
        
        print(f"TF Version: {tf.__version__}")
        print(f"Keras Version: {keras.__version__}")
        
        # Manually reconstruct the model architecture
        # Based on the error logs: Sequential with LSTM, Dropout, LSTM, Dropout, Dense
        # Input shape: (None, 5, 2)
        
        print("Reconstructing model architecture...")
        model = Sequential([
            InputLayer(shape=(5, 2)),
            LSTM(64, return_sequences=True),
            Dropout(0.2),
            LSTM(32),
            Dropout(0.2),
            Dense(2)
        ])
        
        print("Architecture reconstructed. Saving as H5...")
        model.save(H5_MODEL_PATH)
        print(f"Empty model saved to {H5_MODEL_PATH} as a placeholder.")
        
        return True
    except Exception as e:
        print(f"Error during resave: {str(e)}")
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = fix_and_resave()
    sys.exit(0 if success else 1)
