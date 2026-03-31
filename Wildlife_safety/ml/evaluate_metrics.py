import os
import json
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
from random_forest_risk import WildlifeRiskModel, DATA_CACHE_PATH

def evaluate_model():
    if not os.path.exists(DATA_CACHE_PATH):
        print("Data file not found.")
        return

    with open(DATA_CACHE_PATH, "r", encoding="utf-8") as f:
        records = json.load(f)

    if not records:
        print("No records found.")
        return

    # Initialize model wrapper and prepare data
    model_wrapper = WildlifeRiskModel()
    df_raw = model_wrapper.validate_and_clean(records)
    df = model_wrapper.prepare_data(df_raw, fit_encoders=True)
    
    # We will evaluate the 'Generic' model performance on the entire dataset
    # as it provides a consolidated view of risk classification performance.
    # Alternatively, we could average per-species performance, but for the table,
    # a single model evaluation is clearer. 
    # Let's evaluate the Generic model approach which uses 'animal_encoded'.

    generic_features = ['animal_encoded'] + model_wrapper.env_feature_cols
    X = df[generic_features]
    y = df['risk_label']

    # Stratified Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # Train Generic Model
    clf = RandomForestClassifier(n_estimators=100, class_weight="balanced", random_state=42)
    clf.fit(X_train, y_train)
    
    y_pred = clf.predict(X_test)
    
    # Metrics
    report = classification_report(y_test, y_pred, output_dict=True)
    acc = accuracy_score(y_test, y_pred)
    cm = confusion_matrix(y_test, y_pred, labels=["High", "Medium", "Low"])

    # Print Table Format
    print("\nTable X: Classification Performance of Risk Prediction Model\n")
    print("| Class        | Precision | Recall | F1-Score |")
    print("|-------------|----------|--------|----------|")
    
    for label in ["High", "Medium", "Low"]:
        if label in report:
            metrics = report[label]
            print(f"| {label:11} | {metrics['precision']:.4f}   | {metrics['recall']:.4f} | {metrics['f1-score']:.4f}   |")
        else:
            print(f"| {label:11} | 0.0000   | 0.0000 | 0.0000   |")

    macro = report['macro avg']
    weighted = report['weighted avg']
    
    print(f"| **Macro Avg** | {macro['precision']:.4f}   | {macro['recall']:.4f} | {macro['f1-score']:.4f}   |")
    print(f"| **Weighted Avg** | {weighted['precision']:.4f}   | {weighted['recall']:.4f} | {weighted['f1-score']:.4f}   |")
    
    # Calculate MAE and RMSE for classification (treating classes as ordinal High=3, Med=2, Low=1)
    # This is an approximation since Risk is categorical, but useful if we treat risk as ordinal severity
    risk_map = {"Low": 1, "Medium": 2, "High": 3}
    y_test_num = y_test.map(risk_map)
    y_pred_num = pd.Series(y_pred).map(risk_map)
    
    # Drop any NaNs if mapping failed
    mask = y_test_num.notna() & y_pred_num.notna()
    y_true = y_test_num[mask]
    y_p = y_pred_num[mask]
    
    mae = np.mean(np.abs(y_true - y_p))
    rmse = np.sqrt(np.mean((y_true - y_p)**2))
    
    print(f"\n**Overall Accuracy**: {acc:.4f}")
    print(f"**MAE (Mean Absolute Error)**: {mae:.4f}")
    print(f"**RMSE (Root Mean Squared Error)**: {rmse:.4f}")
    
    print("\n**Confusion Matrix** (Rows: True [High, Med, Low], Cols: Pred [High, Med, Low]):")
    print(cm)

if __name__ == "__main__":
    evaluate_model()
