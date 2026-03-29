import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score, 
    confusion_matrix, classification_report
)

def evaluate_classification_model(model, X_test, y_test, labels=None):
    """
    Comprehensive evaluation of a classification model.
    Handles both binary and multi-class classification.
    
    Args:
        model: Trained classifier (Random Forest, LSTM, etc.)
        X_test: Test features
        y_test: True labels
        labels: Optional list of label names for the confusion matrix
    """
    
    # 1. Generate Predictions
    # Check if the model is an LSTM/Keras model (returns probabilities)
    if hasattr(model, 'predict_proba') or str(type(model)).find('keras') != -1:
        y_probs = model.predict(X_test)
        # For multi-class Keras models, use argmax to get the class index
        if len(y_probs.shape) > 1 and y_probs.shape[1] > 1:
            y_pred = np.argmax(y_probs, axis=1)
        else:
            # For binary Keras models or probability outputs
            y_pred = (y_probs > 0.5).astype(int).flatten()
    else:
        # Standard sklearn-like model
        y_pred = model.predict(X_test)

    # 2. Calculate Metrics
    # Determine if it's binary or multi-class for average parameter
    is_binary = len(np.unique(y_test)) <= 2
    avg_method = 'binary' if is_binary else 'weighted'

    metrics = {
        "Accuracy": accuracy_score(y_test, y_pred),
        "Precision": precision_score(y_test, y_pred, average=avg_method),
        "Recall": recall_score(y_test, y_pred, average=avg_method),
        "F1 Score": f1_score(y_test, y_pred, average=avg_method)
    }

    # 3. Print Metric Values
    print("\n" + "="*40)
    print("      MODEL PERFORMANCE METRICS")
    print("="*40)
    for metric, value in metrics.items():
        print(f"{metric:15}: {value:.4f}")
    
    print("\n" + "="*40)
    print("      CLASSIFICATION REPORT")
    print("="*40)
    print(classification_report(y_test, y_pred, target_names=labels))

    # 4. Plot Confusion Matrix
    cm = confusion_matrix(y_test, y_pred)
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
                xticklabels=labels if labels else 'auto', 
                yticklabels=labels if labels else 'auto')
    plt.title('Confusion Matrix')
    plt.ylabel('Actual Label')
    plt.xlabel('Predicted Label')
    plt.show()

    return metrics

if __name__ == "__main__":
    # Example usage with dummy data
    from sklearn.datasets import make_classification
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split

    # Create dummy data (3 classes)
    X, y = make_classification(n_samples=1000, n_features=20, n_classes=3, n_clusters_per_class=1, random_state=42)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # Train a sample model
    model = RandomForestClassifier(random_state=42)
    model.fit(X_train, y_train)

    # Evaluate
    class_names = ['Class A', 'Class B', 'Class C']
    evaluate_classification_model(model, X_test, y_test, labels=class_names)
