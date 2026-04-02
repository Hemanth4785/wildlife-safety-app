import math
from datetime import datetime
import logging

# Configure logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def haversine(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees).
    Returns distance in kilometers.
    """
    try:
        # 1. Validation: Handle missing or invalid coordinates
        if any(v is None for v in [lat1, lon1, lat2, lon2]):
            logger.warning("Missing coordinate(s) in Haversine calculation.")
            return 999.0
            
        lat1, lon1, lat2, lon2 = map(float, [lat1, lon1, lat2, lon2])
        
        # Check for non-finite values (NaN, Inf)
        if not all(math.isfinite(v) for v in [lat1, lon1, lat2, lon2]):
            logger.warning("Invalid coordinate(s) in Haversine calculation.")
            return 999.0
            
        # 2. Conversion to Radians
        lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])

        # 3. Haversine Formula
        dlat = lat2 - lat1 
        dlon = lon2 - lon1 
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.asin(math.sqrt(a)) 
        r = 6371.0 # Earth's radius in kilometers
        
        return round(c * r, 2)
    except Exception as e:
        logger.error(f"Error in Haversine calculation: {str(e)}")
        return 999.0

def calculate_time_weight(val):
    """
    Implement time-based weighting for sightings.
    If val is an int/float, it's treated as an hour of the day.
    If val is a string, it's treated as a sighting date (original behavior).
    """
    try:
        if val is None:
            return 0.5
            
        # Case 1: Value is an hour (as requested in the prompt)
        if isinstance(val, (int, float)):
            hour = int(val)
            # Higher weight during dawn (5-8) and dusk (18-21)
            if (5 <= hour <= 8) or (18 <= hour <= 21):
                return 1.0
            return 0.5
            
        # Case 2: Value is a date string (original logic for ml_service.py)
        sighting_date_str = str(val).replace('Z', '')
        if 'T' in sighting_date_str:
            sighting_date = datetime.fromisoformat(sighting_date_str[:19])
        else:
            sighting_date = datetime.strptime(sighting_date_str[:10], "%Y-%m-%d")
            
        now = datetime.now()
        days_old = (now - sighting_date).days
        
        # 30-day decay window
        weight = max(0, 1 - (days_old / 30))
        return round(weight, 3)
        
    except Exception as e:
        logger.error(f"Error calculating time weight: {str(e)}")
        return 0.5 # Default fallback weight
