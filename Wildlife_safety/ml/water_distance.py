import httpx
import json
import os
import asyncio
import logging
from utils import haversine

# Configure logger
logger = logging.getLogger(__name__)

# --- CONFIGURATION ---
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
RADIUS_KM = 5.0
DEFAULT_DISTANCE = 3.0  # fallback km
CACHE_FILE = os.path.join(os.path.dirname(__file__), "water_cache.json")

# In-memory cache
water_cache = {}

def load_cache():
    """Load the cache from a JSON file."""
    global water_cache
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r') as f:
                water_cache = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"Error loading water cache: {str(e)}")
            water_cache = {}

def save_cache():
    """Save the in-memory cache to a JSON file."""
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump(water_cache, f)
    except IOError as e:
        logger.error(f"Error saving water cache: {str(e)}")

async def get_distance_to_water_async(lat, lon):
    """
    Fetch the nearest water feature using the Overpass API 
    within a 5 km radius.
    Asynchronous version for FastAPI.
    """
    try:
        # 1. Coordinate Validation
        if lat is None or lon is None:
            return DEFAULT_DISTANCE, False
            
        lat, lon = float(lat), float(lon)
        
        # 2. Cache Lookup (Round coordinates to ~1.1km precision for efficiency)
        lat_rounded = round(lat, 2)
        lon_rounded = round(lon, 2)
        cache_key = f"{lat_rounded},{lon_rounded}"

        load_cache()
        if cache_key in water_cache:
            return float(water_cache[cache_key]), True

        # 3. Build Overpass Query
        overpass_query = f"""
        [out:json][timeout:25];
        (
          node["waterway"~"river|stream"](around:{RADIUS_KM * 1000},{lat},{lon});
          way["waterway"~"river|stream"](around:{RADIUS_KM * 1000},{lat},{lon});
          node["natural"="water"](around:{RADIUS_KM * 1000},{lat},{lon});
          way["natural"="water"](around:{RADIUS_KM * 1000},{lat},{lon});
          node["water"="reservoir"](around:{RADIUS_KM * 1000},{lat},{lon});
          way["water"="reservoir"](around:{RADIUS_KM * 1000},{lat},{lon});
        );
        out body;
        >;
        out skel qt;
        """

        # 4. Asynchronous HTTP request
        async with httpx.AsyncClient() as client:
            response = await client.post(OVERPASS_URL, data={'data': overpass_query}, timeout=15.0)
            if response.status_code != 200:
                logger.error(f"Overpass API error: {response.status_code}")
                return DEFAULT_DISTANCE, False
                
            data = response.json()

        # 5. Extract nodes and calculate minimum distance
        min_dist = 999.0
        found_water = False

        if 'elements' in data:
            for element in data['elements']:
                if element['type'] == 'node':
                    dist = haversine(lat, lon, element['lat'], element['lon'])
                    if dist < min_dist:
                        min_dist = dist
                        found_water = True

        # Result handling
        final_dist = round(min_dist, 2) if (found_water and min_dist <= RADIUS_KM) else DEFAULT_DISTANCE
        is_real_water = found_water and min_dist <= RADIUS_KM
        
        # Cache the result
        water_cache[cache_key] = final_dist
        save_cache()
        
        return final_dist, is_real_water
        
    except Exception as e:
        logger.error(f"Error in async water distance fetch: {str(e)}")
        return DEFAULT_DISTANCE, False

# For backward compatibility and scripts
def get_distance_to_water(lat, lon):
    """Synchronous wrapper around the async logic (for CLI usage)."""
    return asyncio.run(get_distance_to_water_async(lat, lon))[0]
