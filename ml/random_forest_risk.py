"""
Wildlife Risk Classification Model using Random Forest.

This script implements PER-ANIMAL risk modeling:
- Trains independent Random Forest models for each animal species.
- Uses a minimum sample threshold (10) for species-specific training.
- Trains a 'Generic' fallback model using all available data.
- Standardizes feature pipelines across all models.
"""

import os
import json
import joblib
import pandas as pd
import numpy as np
from datetime import datetime
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, accuracy_score

# ---------------- CONFIGURATION ---------------- #

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_PATH = os.path.join(BASE_DIR, "risk_models.pkl")
ENCODERS_PATH = os.path.join(BASE_DIR, "encoders.pkl")
FEATURE_ORDER_PATH = os.path.join(BASE_DIR, "feature_order.json")
DATA_CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))

MIN_SAMPLES_PER_ANIMAL = 10  # Minimum samples to train a species-specific model

# ---------------- UTILS ---------------- #

def haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1 
    dlon = lon2 - lon1 
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a)) 
    r = 6371 
    return c * r

# ---------------- MODEL CLASS ---------------- #

class WildlifeRiskModel:
    def __init__(self):
        self.models = {}  # Dictionary to store { animal_name: model_object }
        self.encoders = {}
        # 'animal_encoded' is removed from features since we are training PER animal
        self.feature_cols = ['distance_km', 'hour_of_day', 'confidence_encoded', 'scope_encoded']

    def _label_risk_heuristic(self, distance):
        if distance < 2.0: return "High"
        elif 2.0 <= distance < 10.0: return "Medium"
        else: return "Low"

    def validate_and_clean(self, records):
        initial_count = len(records)
        valid_records = []
        for r in records:
            if r.get('lat') is not None and r.get('lon') is not None:
                valid_records.append(r)
        print(f"Data Cleaning: Loaded {initial_count}, Dropped {initial_count - len(valid_records)} missing coordinates.")
        return pd.DataFrame(valid_records)

    def prepare_data(self, df, fit_encoders=True):
        """
        Transforms raw dataframe into features. 
        Note: animal_encoded is only used for the 'Generic' fallback model.
        """
        # 1. Distance Calculation (Multiple User Hotspots)
        center_lat, center_lon = df['lat'].mean(), df['lon'].mean()
        hotspot_indices = df.sample(n=min(10, len(df)), random_state=42).index
        user_locations = df.loc[hotspot_indices, ['lat', 'lon']].values.tolist()
        user_locations.extend([(0, 0), (center_lat + 1.0, center_lon + 1.0)])

        def get_min_distance(row):
            return min([haversine(row['lat'], row['lon'], u_lat, u_lon) for u_lat, u_lon in user_locations])

        df['distance_km'] = df.apply(get_min_distance, axis=1)
        
        # 2. Time & Meta features
        df['hour_of_day'] = df['eventDate'].apply(lambda x: pd.to_datetime(x).hour if pd.notnull(x) else 12)
        
        # Handle flat or nested metadata (compatibility)
        if 'metadata' in df.columns:
            df['confidence'] = df.apply(lambda row: row['metadata'].get('confidence', 'unknown') if isinstance(row.get('metadata'), dict) else row.get('confidence', 'unknown'), axis=1)
            df['scope'] = df.apply(lambda row: row['metadata'].get('scope', 'unknown') if isinstance(row.get('metadata'), dict) else row.get('scope', 'unknown'), axis=1)
        else:
             if 'confidence' not in df.columns: df['confidence'] = 'unknown'
             if 'scope' not in df.columns: df['scope'] = 'unknown'
        
        df['confidence'] = df['confidence'].fillna('unknown')
        df['scope'] = df['scope'].fillna('unknown')
        
        df['risk_label'] = df['distance_km'].apply(self._label_risk_heuristic)

        # 3. Categorical Encoding
        categorical_cols = ['animal', 'confidence', 'scope']
        for col in categorical_cols:
            if fit_encoders:
                le = LabelEncoder()
                le.fit(pd.concat([df[col], pd.Series(['unknown'])]))
                self.encoders[col] = le
            
            le = self.encoders[col]
            df[f'{col}_encoded'] = df[col].apply(lambda x: le.transform([x])[0] if x in le.classes_ else le.transform(['unknown'])[0])

        return df

    def train_per_animal(self, records):
        """
        Orchestrates training for each animal and a generic fallback.
        """
        df_raw = self.validate_and_clean(records)
        df = self.prepare_data(df_raw, fit_encoders=True)
        
        # --- 1. Train Species-Specific Models ---
        animals = df['animal'].unique()
        print("\n--- Starting Per-Animal Training ---")
        
        for animal in animals:
            animal_df = df[df['animal'] == animal]
            count = len(animal_df)
            
            if count < MIN_SAMPLES_PER_ANIMAL:
                print(f"Skipping {animal}: Only {count} samples (Threshold: {MIN_SAMPLES_PER_ANIMAL})")
                continue

            dist_stats = animal_df['risk_label'].value_counts().to_dict()
            print(f"Training: {animal} | Samples: {count} | Dist: {dist_stats}")

            # Train Model
            X = animal_df[self.feature_cols]
            y = animal_df['risk_label']
            
            # Use Stratified split if possible
            try:
                X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
            except:
                X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

            model = RandomForestClassifier(n_estimators=50, max_depth=8, class_weight="balanced", random_state=42)
            model.fit(X_train, y_train)
            
            acc = accuracy_score(y_test, model.predict(X_test))
            print(f"Accuracy for {animal}: {acc:.2f}")
            self.models[animal] = model

        # --- 2. Train Generic Fallback Model ---
        print("\nTraining Generic Fallback Model...")
        # The generic model includes 'animal_encoded' as a feature
        generic_features = ['animal_encoded'] + self.feature_cols
        X_gen = df[generic_features]
        y_gen = df['risk_label']
        
        gen_model = RandomForestClassifier(n_estimators=100, class_weight="balanced", random_state=42)
        gen_model.fit(X_gen, y_gen)
        self.models['Generic'] = gen_model
        
        # Save Assets
        joblib.dump(self.models, MODELS_PATH)
        joblib.dump(self.encoders, ENCODERS_PATH)
        with open(FEATURE_ORDER_PATH, "w") as f:
            json.dump({"per_animal": self.feature_cols, "generic": ['animal_encoded'] + self.feature_cols}, f)
            
        print(f"\nSaved {len(self.models)-1} species models + 1 Generic model to {BASE_DIR}")

def main():
    if not os.path.exists(DATA_CACHE_PATH): return
    with open(DATA_CACHE_PATH, "r", encoding="utf-8") as f:
        records = json.load(f)
    if not records: return

    model_wrapper = WildlifeRiskModel()
    model_wrapper.train_per_animal(records)

if __name__ == "__main__":
    main()
