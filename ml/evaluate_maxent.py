import os
import json
import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from random_forest_risk import WildlifeRiskModel, DATA_CACHE_PATH

def evaluate_maxent():
    if not os.path.exists(DATA_CACHE_PATH):
        print("Data file not found.")
        return

    with open(DATA_CACHE_PATH, "r", encoding="utf-8") as f:
        records = json.load(f)

    if not records:
        print("No records found.")
        return

    model_wrapper = WildlifeRiskModel()
    df_raw = model_wrapper.validate_and_clean(records)
    df = model_wrapper.prepare_data(df_raw, fit_encoders=True)
    
    # Generic Features
    generic_features = ['animal_encoded'] + model_wrapper.feature_cols
    X = df[generic_features]
    y = df['risk_label']
    
    # Train/Test Split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    # MaxEnt Model (Logistic Regression with Multinomial Loss)
    # Using 'lbfgs' solver approximates Maximum Entropy. In older sklearn versions, 'multi_class' might be implicit or handled differently.
    # We will use standard LogisticRegression which defaults to 'auto' (usually 'multinomial' for multiclass with lbfgs).
    maxent = LogisticRegression(solver='lbfgs', max_iter=1000, class_weight='balanced', random_state=42)
    maxent.fit(X_train, y_train)
    y_pred = maxent.predict(X_test)
    
    # Metrics
    acc = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred, average='weighted', zero_division=0)
    rec = recall_score(y_test, y_pred, average='weighted', zero_division=0)
    f1 = f1_score(y_test, y_pred, average='weighted', zero_division=0)

    print("\nTable V: Performance of MaxEnt (Maximum Entropy) Model\n")
    print("| Model          | Precision (%) | Recall (%) | F1-Score (%) | Accuracy (%) |")
    print("|----------------|---------------|------------|--------------|--------------|")
    print(f"| MaxEnt (LogReg)| {prec*100:.2f}         | {rec*100:.2f}      | {f1*100:.2f}        | {acc*100:.2f}        |")

if __name__ == "__main__":
    evaluate_maxent()
