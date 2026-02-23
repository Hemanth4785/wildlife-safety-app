import os
import json
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score
from random_forest_risk import WildlifeRiskModel, DATA_CACHE_PATH

def evaluate_all_models():
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
    
    animals = df['animal'].unique()
    results = []

    print(f"\nEvaluating models for {len(animals)} species + Generic model...\n")

    # 1. Evaluate Per-Species Models
    for animal in animals:
        animal_df = df[df['animal'] == animal]
        if len(animal_df) < 10:  # Skip sparse species as per implementation threshold
            continue
            
        X = animal_df[model_wrapper.feature_cols]
        y = animal_df['risk_label']
        
        # Use simple split if stratified fails (small samples)
        try:
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        except:
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
        if len(X_test) == 0: continue

        clf = RandomForestClassifier(n_estimators=50, max_depth=8, class_weight="balanced", random_state=42)
        clf.fit(X_train, y_train)
        y_pred = clf.predict(X_test)
        
        report = classification_report(y_test, y_pred, output_dict=True, zero_division=0)
        acc = accuracy_score(y_test, y_pred)
        
        # We focus on Weighted Avg for the table summary per model
        results.append({
            "Model": animal,
            "Accuracy": acc,
            "Precision": report['weighted avg']['precision'],
            "Recall": report['weighted avg']['recall'],
            "F1-Score": report['weighted avg']['f1-score'],
            "Samples": len(animal_df)
        })

    # 2. Evaluate Generic Model
    generic_features = ['animal_encoded'] + model_wrapper.feature_cols
    X_gen = df[generic_features]
    y_gen = df['risk_label']
    
    X_train_g, X_test_g, y_train_g, y_test_g = train_test_split(X_gen, y_gen, test_size=0.2, random_state=42, stratify=y_gen)
    
    gen_clf = RandomForestClassifier(n_estimators=100, class_weight="balanced", random_state=42)
    gen_clf.fit(X_train_g, y_train_g)
    y_pred_g = gen_clf.predict(X_test_g)
    
    report_g = classification_report(y_test_g, y_pred_g, output_dict=True)
    acc_g = accuracy_score(y_test_g, y_pred_g)
    
    results.append({
        "Model": "Generic (All Species)",
        "Accuracy": acc_g,
        "Precision": report_g['weighted avg']['precision'],
        "Recall": report_g['weighted avg']['recall'],
        "F1-Score": report_g['weighted avg']['f1-score'],
        "Samples": len(df)
    })

    # Print Table
    print("\nTable III: Performance Comparison of Species-Specific vs. Generic Models\n")
    print("| Model Name           | Accuracy | Precision | Recall | F1-Score | Samples |")
    print("|----------------------|----------|-----------|--------|----------|---------|")
    
    for r in results:
        print(f"| {r['Model']:<20} | {r['Accuracy']:.4f}   | {r['Precision']:.4f}    | {r['Recall']:.4f} | {r['F1-Score']:.4f}   | {r['Samples']:<7} |")

if __name__ == "__main__":
    evaluate_all_models()
