
import os
import tensorflow as tf
from tensorflow.keras.models import load_model

# Run this script in an environment with tensorflow==2.15.0
# pip install tensorflow==2.15.0 keras==2.15.0

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OLD_MODEL_PATH = os.path.join(BASE_DIR, "models", "lstm_seq.h5") # Existing model
NEW_MODEL_PATH = os.path.join(BASE_DIR, "lstm_model.h5") # Fixed model for Render

def resave_model():
    print(f"Current TF version: {tf.__version__}")
    if not os.path.exists(OLD_MODEL_PATH):
        print(f"Error: {OLD_MODEL_PATH} not found.")
        return
    
    try:
        print(f"Loading old model from {OLD_MODEL_PATH}...")
        # Load with compile=False to avoid issues with custom optimizers/losses during load
        model = load_model(OLD_MODEL_PATH, compile=False)
        print("Model loaded successfully!")
        
        print(f"Re-saving model to {NEW_MODEL_PATH} using TF 2.15 format...")
        model.save(NEW_MODEL_PATH)
        print("Model re-saved successfully!")
        
    except Exception as e:
        print(f"Failed to re-save model: {e}")

if __name__ == "__main__":
    resave_model()
