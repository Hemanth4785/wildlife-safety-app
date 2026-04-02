import os
import tensorflow as tf
from tensorflow.keras.models import Sequential, load_model
from tensorflow.keras.layers import LSTM, Dense, Dropout

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OLD_MODEL_H5 = os.path.join(BASE_DIR, "lstm_model.h5")
NEW_MODEL_KERAS = os.path.join(BASE_DIR, "models", "lstm_seq.keras")
WINDOW = 15

def repair_model():
    print(f"Attempting to repair LSTM model from {OLD_MODEL_H5}...")
    
    if not os.path.exists(OLD_MODEL_H5):
        print(f"Error: {OLD_MODEL_H5} not found. Nothing to repair.")
        return

    try:
        # 1. Try to load the full model directly
        print("Step 1: Loading existing model...")
        model = load_model(OLD_MODEL_H5, compile=False)
        print("Success: Model loaded directly.")
    except Exception as e:
        print(f"Direct load failed: {e}")
        print("Step 2: Rebuilding architecture and loading weights...")
        
        # 2. Rebuild the exact architecture from train_lstm_seq.py
        model = Sequential([
            LSTM(64, return_sequences=True, input_shape=(WINDOW, 2)),
            Dropout(0.2),
            LSTM(64),
            Dropout(0.2),
            Dense(32, activation="relu"),
            Dense(2, activation="linear")
        ])
        
        try:
            # Try loading weights from the .h5 file
            model.load_weights(OLD_MODEL_H5)
            print("Success: Weights loaded into new architecture.")
        except Exception as e2:
            print(f"Critical Error: Could not load weights: {e2}")
            return

    # 3. Save in the modern native Keras format
    os.makedirs(os.path.dirname(NEW_MODEL_KERAS), exist_ok=True)
    model.save(NEW_MODEL_KERAS)
    print(f"Model successfully saved to {NEW_MODEL_KERAS} in native Keras format.")

if __name__ == "__main__":
    repair_model()
