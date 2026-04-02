const payload = {
  animal: "Asian Elephant",
  recent_path: [
    { lat: 11.32, lon: 76.58, time: "2025-02-01" },
    { lat: 11.35, lon: 76.62, time: "2025-02-02" },
    { lat: 11.38, lon: 76.66, time: "2025-02-03" }
  ],
  user_location: { lat: 11.4064, lon: 76.6932 }
};

async function main() {
  try {
    const resp = await fetch("https://wildlife-safety-api.onrender.com/api/predict-movement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    console.log(JSON.stringify(json, null, 2));
  } catch (e) {
    console.error("request_failed:", e.message);
    process.exit(1);
  }
}

main();
