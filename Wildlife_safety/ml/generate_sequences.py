import os
import numpy as np
import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(BASE_DIR, "dataset")
CSV_PATH = os.path.join(DATASET_DIR, "wildlife_timeseries.csv")
X_OUT = os.path.join(DATASET_DIR, "X.npy")
Y_OUT = os.path.join(DATASET_DIR, "y.npy")

os.makedirs(DATASET_DIR, exist_ok=True)

WINDOW = 7

def label_next_day(total):
    if total > 3:
        return 1
    return 0

def main():
    if not os.path.exists(CSV_PATH):
        np.save(X_OUT, np.zeros((0, WINDOW, 6), dtype=np.float32))
        np.save(Y_OUT, np.zeros((0, 1), dtype=np.float32))
        print(X_OUT)
        print(Y_OUT)
        return
    df = pd.read_csv(CSV_PATH)
    for c in ["elephant", "tiger", "leopard", "bison", "slothbear", "rainfall"]:
        if c not in df.columns:
            df[c] = 0
    df = df.sort_values("date")
    values = df[["elephant", "tiger", "leopard", "bison", "slothbear", "rainfall"]].values.astype(np.float32)
    totals = df[["elephant", "tiger", "leopard", "bison", "slothbear"]].sum(axis=1).values.astype(np.float32)
    X = []
    y = []
    for i in range(len(values) - WINDOW):
        seq = values[i:i+WINDOW]
        nxt = totals[i+WINDOW]
        X.append(seq)
        y.append([label_next_day(nxt)])
    if len(X) == 0:
        X = np.zeros((0, WINDOW, 6), dtype=np.float32)
        y = np.zeros((0, 1), dtype=np.float32)
    else:
        X = np.array(X, dtype=np.float32)
        y = np.array(y, dtype=np.float32)
    np.save(X_OUT, X)
    np.save(Y_OUT, y)
    print(X_OUT)
    print(Y_OUT)

if __name__ == "__main__":
    main()

