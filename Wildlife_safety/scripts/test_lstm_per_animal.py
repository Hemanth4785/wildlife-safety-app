import json
import subprocess
import os

ML_PYTHON_EXE = r"c:\Users\hemac\Downloads\Wildlife_safety\wildlife_safety\lstm_env\Scripts\python.exe"
SCRIPT_PATH = r"c:\Users\hemac\Downloads\Wildlife_safety\wildlife_safety\ml\predict_lstm_seq.py"

payload = {
    "trajectory": [[11.4102, 76.695], [11.411, 76.696], [11.412, 76.697]],
    "animal": "Elephas maximus",
    "steps": 3
}

try:
    # Run script manually to verify output
    result = subprocess.run([ML_PYTHON_EXE, SCRIPT_PATH, json.dumps(payload)], 
                            capture_output=True, text=True)
    
    print("STDOUT:", result.stdout)
    print("STDERR:", result.stderr)
    
    if result.stdout:
        # Extract JSON
        s = result.stdout.strip()
        start = s.find('{')
        end = s.rfind('}')
        if start != -1 and end != -1:
            parsed = json.loads(s[start:end+1])
            print("Successfully parsed JSON response:")
            print(json.dumps(parsed, indent=2))
        else:
            print("No JSON found in stdout")
except Exception as e:
    print("Error:", str(e))
