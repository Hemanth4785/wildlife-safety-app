import os
import json
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from random_forest_risk import WildlifeRiskModel, DATA_CACHE_PATH

def generate_graphs():
    print("Loading data...")
    if not os.path.exists(DATA_CACHE_PATH):
        print(f"Error: Data file not found at {DATA_CACHE_PATH}")
        return

    with open(DATA_CACHE_PATH, "r", encoding="utf-8") as f:
        records = json.load(f)

    if not records:
        print("Error: No records found in data file.")
        return

    # Use the existing model class to clean and prepare data
    model = WildlifeRiskModel()
    df_raw = model.validate_and_clean(records)
    
    # We need to manually prepare data because prepare_data might need fit_encoders=True 
    # but we just want the dataframe with risk labels.
    # Actually, prepare_data returns the df with 'risk_label' column.
    print("Processing data...")
    df = model.prepare_data(df_raw, fit_encoders=True)

    # Set up the style
    sns.set(style="whitegrid")
    output_dir = os.path.dirname(os.path.abspath(__file__))

    # 1. Risk Distribution Graph
    plt.figure(figsize=(8, 6))
    risk_counts = df['risk_label'].value_counts()
    # Ensure order Low, Medium, High
    order = [x for x in ['Low', 'Medium', 'High'] if x in risk_counts.index]
    sns.barplot(x=risk_counts.index, y=risk_counts.values, order=order, palette="viridis")
    plt.title("Wildlife Risk Level Distribution")
    plt.xlabel("Risk Level")
    plt.ylabel("Number of Sightings")
    plt.savefig(os.path.join(output_dir, "risk_distribution.png"))
    plt.close()
    print(f"Saved risk_distribution.png to {output_dir}")

    # 2. Top 10 Animals Graph
    plt.figure(figsize=(10, 8))
    top_animals = df['animal'].value_counts().head(10)
    sns.barplot(y=top_animals.index, x=top_animals.values, palette="magma")
    plt.title("Top 10 Recorded Animal Species")
    plt.xlabel("Count")
    plt.ylabel("Species")
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "animal_counts.png"))
    plt.close()
    print(f"Saved animal_counts.png to {output_dir}")

    # 3. Hour of Day vs Risk
    plt.figure(figsize=(10, 6))
    sns.countplot(data=df, x='hour_of_day', hue='risk_label', hue_order=['Low', 'Medium', 'High'], palette="coolwarm")
    plt.title("Risk Distribution by Hour of Day")
    plt.xlabel("Hour (0-23)")
    plt.ylabel("Count")
    plt.legend(title="Risk Level")
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "risk_by_hour.png"))
    plt.close()
    print(f"Saved risk_by_hour.png to {output_dir}")

if __name__ == "__main__":
    try:
        generate_graphs()
    except ImportError as e:
        print(f"Import Error: {e}. Please ensure matplotlib and seaborn are installed.")
    except Exception as e:
        print(f"An error occurred: {e}")
