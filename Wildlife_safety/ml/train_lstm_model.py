import os
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dropout, Dense
from tensorflow.keras.optimizers import Adam

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(BASE_DIR, "dataset")
X_PATH = os.path.join(DATASET_DIR, "X.npy")
Y_PATH = os.path.join(DATASET_DIR, "y.npy")
MODELS_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)
MODEL_PATH = os.path.join(MODELS_DIR, "wildlife_lstm_model.h5")

EPOCHS = 20
BATCH = 16
VAL_SPLIT = 0.2

def main():
    if not os.path.exists(X_PATH) or not os.path.exists(Y_PATH):
        return
    X = np.load(X_PATH, allow_pickle=False)
    y = np.load(Y_PATH, allow_pickle=False)
    if X.size == 0 or y.size == 0:
        return
    timesteps = X.shape[1]
    features = X.shape[2]
    model = Sequential()
    model.add(LSTM(32, input_shape=(timesteps, features)))
    model.add(Dropout(0.2))
    model.add(Dense(16, activation="relu"))
    model.add(Dense(1, activation="sigmoid"))
    model.compile(optimizer=Adam(), loss="binary_crossentropy", metrics=["accuracy"])
    model.fit(X, y, epochs=EPOCHS, batch_size=BATCH, validation_split=VAL_SPLIT, verbose=1)
    model.save(MODEL_PATH)
    print(MODEL_PATH)

if __name__ == "__main__":
    main()

