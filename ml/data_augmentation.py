import numpy as np
import pandas as pd
from scipy.interpolate import interp1d

def augment_data_with_interpolation(df, time_interval_minutes=15):
    """
    Rectifies sparse data by interpolating intermediate points.
    
    Args:
        df: DataFrame with 'animal', 'lat', 'lon', 'eventDate'
        time_interval_minutes: Desired gap between points (resampling rate)
        
    Returns:
        DataFrame with dense, regular time intervals.
    """
    augmented_records = []
    
    for animal_id, group in df.groupby('animal'):
        group = group.sort_values('eventDate')
        
        # We can only interpolate between points that are somewhat close (e.g., < 24 hours gap)
        # If gap is > 24 hours, we treat it as a separate segment
        group['time_diff'] = group['eventDate'].diff().dt.total_seconds() / 3600.0
        group['segment_id'] = (group['time_diff'] > 24).cumsum()
        
        for _, segment in group.groupby('segment_id'):
            if len(segment) < 2:
                continue
                
            # Set time as index for resampling
            segment = segment.set_index('eventDate')
            
            # Resample to regular intervals (e.g., 15T = 15 mins)
            # We use 'linear' interpolation for lat/lon
            try:
                # Create a comprehensive time index
                start_time = segment.index.min()
                end_time = segment.index.max()
                new_index = pd.date_range(start=start_time, end=end_time, freq=f'{time_interval_minutes}T')
                
                # Reindex and Interpolate
                # We need to drop duplicates in index if any
                segment = segment[~segment.index.duplicated(keep='first')]
                
                resampled = segment[['lat', 'lon']].reindex(segment.index.union(new_index)).interpolate(method='time')
                resampled = resampled.reindex(new_index).dropna()
                
                # Add back metadata
                resampled['animal'] = animal_id
                resampled['is_synthetic'] = True
                # Original points are not synthetic, but for simplicity we mark this batch
                
                augmented_records.append(resampled.reset_index().rename(columns={'index': 'eventDate'}))
            except Exception as e:
                continue

    if not augmented_records:
        return pd.DataFrame()
        
    return pd.concat(augmented_records, ignore_index=True)

# Example Usage Code (Commented out)
# df = pd.DataFrame(records)
# df['eventDate'] = pd.to_datetime(df['eventDate'])
# dense_df = augment_data_with_interpolation(df)
# print(f"Expanded from {len(df)} to {len(dense_df)} points")
