import os
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import load_model

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OLD_MODEL_H5 = os.path.join(BASE_DIR, "lstm_model.h5")
NEW_MODEL_KERAS = os.path.join(BASE_DIR, "models", "lstm_seq.keras")
WINDOW = 15

def resave_and_verify():
    print(f"--- LSTM Model Repair & Verification ---")
    
    if not os.path.exists(OLD_MODEL_H5):
        print(f"Error: {OLD_MODEL_H5} not found. Ensure the original .h5 file is in the ml/ folder.")
        return

    try:
        # 1. Load the FULL model (not just weights)
        print(f"Step 1: Loading full model from {OLD_MODEL_H5}...")
        # Use compile=False to avoid issues with custom objects or optimizers during repair
        model = load_model(OLD_MODEL_H5, compile=False)
        print("Success: Model loaded completely.")
        
        # 2. Verify integrity
        print("\nStep 2: Verifying model integrity...")
        model.summary()
        
        # 3. Test with dummy prediction
        print("\nStep 3: Running test prediction...")
        dummy_input = np.random.rand(1, WINDOW, 2).astype(np.float32)
        prediction = model.predict(dummy_input, verbose=0)
        print(f"Test Success: Input (1, {WINDOW}, 2) -> Output {prediction.shape}")
        
        if prediction.shape != (1, 2):
            print(f"Warning: Unexpected output shape {prediction.shape}. Expected (1, 2).")

        # 4. Save in native Keras format
        print(f"\nStep 4: Saving to native Keras format: {NEW_MODEL_KERAS}")
        os.makedirs(os.path.dirname(NEW_MODEL_KERAS), exist_ok=True)
        model.save(NEW_MODEL_KERAS)
        print("--- REPAIR COMPLETE ---")
        print(f"Please commit and push: {os.path.relpath(NEW_MODEL_KERAS)}")

    except Exception as e:
        print(f"\nCRITICAL FAILURE: {str(e)}")
        print("Possible cause: The .h5 file is severely corrupted or incompatible with TensorFlow 2.15.")

if __name__ == "__main__":
    resave_and_verify()
