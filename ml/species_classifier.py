import os
import sys
import json
import base64
import io
from typing import Dict, Any
import urllib.request
import urllib.parse
import time

def safe_print(s: str):
    try:
        print(s)
    except Exception:
        pass

ALLOWED = [
    ("Elephas maximus", "Asian Elephant"),
    ("Panthera tigris", "Tiger"),
    ("Panthera pardus", "Leopard"),
    ("Bos gaurus", "Gaur"),
    ("Melursus ursinus", "Sloth Bear"),
    ("Bison bison", "Bison"),
]

IDX_TO_SPECIES = {i: {"scientific": sci, "common": com} for i, (sci, com) in enumerate(ALLOWED)}
SPECIES_TO_IDX = {sci: i for i, (sci, _com) in enumerate(ALLOWED)}
ALLOWED_SCI = set(SPECIES_TO_IDX.keys())
COMMON_TO_SCI = {
    "asian elephant": "Elephas maximus",
    "elephant": "Elephas maximus",
    "indian elephant": "Elephas maximus",
    "tiger": "Panthera tigris",
    "bengal tiger": "Panthera tigris",
    "royal bengal tiger": "Panthera tigris",
    "leopard": "Panthera pardus",
    "indian leopard": "Panthera pardus",
    "gaur": "Bos gaurus",
    "indian bison": "Bos gaurus",
    "sloth bear": "Melursus ursinus",
    "bear": "Melursus ursinus",
    "bison": "Bison bison",
    "american bison": "Bison bison",
}

def _http_json(url: str, timeout: int = 15) -> Dict[str, Any]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "WildlifeSafetyApp/1.0 (dataset-builder)"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8", errors="ignore"))
    except Exception:
        return {}

def _download_image(url: str, out_path: str, timeout: int = 20) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "WildlifeSafetyApp/1.0 (dataset-builder)"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(data)
        return True
    except Exception:
        return False

def _normalize_species_name(sci: str, common: str) -> str:
    sci = (sci or "").strip()
    com = (common or "").strip().lower()
    if sci in ALLOWED_SCI:
        return sci
    mapped = COMMON_TO_SCI.get(com)
    if mapped:
        return mapped
    return ""

def build_dataset(api_urls: list, output_dir: str, per_species_limit: int = 100):
    """
    Fetch images from iNaturalist/GBIF endpoints and build a local dataset directory:
      output_dir/<scientific_name>/<id>.jpg
    """
    counts = {sci: 0 for sci in ALLOWED_SCI}
    os.makedirs(output_dir, exist_ok=True)

    for base_url in api_urls or []:
        # Detect source and paginate
        is_inat = "inaturalist.org/v1/observations" in base_url
        is_gbif = "api.gbif.org/v1/occurrence/search" in base_url

        if is_inat:
            # iNaturalist pagination: page=1..N, per_page already in URL
            page = 1
            max_pages = 20
            while page <= max_pages:
                url_parts = urllib.parse.urlparse(base_url)
                qs = urllib.parse.parse_qs(url_parts.query)
                qs["page"] = [str(page)]
                new_query = urllib.parse.urlencode({k: v[0] for k, v in qs.items()})
                paged_url = urllib.parse.urlunparse((url_parts.scheme, url_parts.netloc, url_parts.path, url_parts.params, new_query, url_parts.fragment))
                data = _http_json(paged_url)
                results = data.get("results") or []
                if not results:
                    break
                for r in results:
                    taxon = r.get("taxon") or {}
                    sci = taxon.get("name") or ""
                    common = taxon.get("preferred_common_name") or ""
                    species = _normalize_species_name(sci, common)
                    if not species:
                        continue
                    if counts[species] >= per_species_limit:
                        continue
                    # Prefer observation photos array
                    photos = r.get("photos") or []
                    url = ""
                    if photos:
                        p0 = photos[0]
                        # iNat photos often have 'url' template ending with 'medium.jpg'
                        url = p0.get("url") or p0.get("medium_url") or ""
                        if url and "{size}" in url:
                            url = url.replace("{size}", "medium")
                    if not url:
                        dp = taxon.get("default_photo") or {}
                        url = dp.get("medium_url") or dp.get("url") or ""
                        if url and "{size}" in url:
                            url = url.replace("{size}", "medium")
                    if not url:
                        continue
                    img_id = str(r.get("id") or int(time.time() * 1000))
                    out_path = os.path.join(output_dir, species, f"{img_id}.jpg")
                    ok = _download_image(url, out_path)
                    if ok:
                        counts[species] += 1
                # Stop paginating if all species hit limits
                if all(counts[sci] >= per_species_limit for sci in ALLOWED_SCI):
                    break
                page += 1

        elif is_gbif:
            # GBIF pagination: offset with limit
            try:
                url_parts = urllib.parse.urlparse(base_url)
                qs = urllib.parse.parse_qs(url_parts.query)
                limit = int(qs.get("limit", ["50"])[0])
            except Exception:
                limit = 50
            offset = 0
            max_pages = 40
            for _ in range(max_pages):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(base_url).query)
                qs["offset"] = [str(offset)]
                qs["limit"] = [str(limit)]
                new_query = urllib.parse.urlencode({k: v[0] for k, v in qs.items()})
                paged_url = urllib.parse.urlunparse((url_parts.scheme, url_parts.netloc, url_parts.path, url_parts.params, new_query, url_parts.fragment))
                data = _http_json(paged_url)
                results = data.get("results") or []
                if not results:
                    break
                for r in results:
                    sci = r.get("species") or r.get("scientificName") or ""
                    common = r.get("vernacularName") or ""
                    species = _normalize_species_name(sci, common)
                    if not species:
                        continue
                    if counts[species] >= per_species_limit:
                        continue
                    media = r.get("media") or []
                    url = ""
                    for m in media:
                        if str(m.get("type") or "").lower() in ("stillimage", "image"):
                            url = m.get("identifier") or ""
                            if url:
                                break
                    if not url:
                        continue
                    img_id = str(r.get("key") or r.get("occurrenceID") or int(time.time() * 1000))
                    out_path = os.path.join(output_dir, species, f"{img_id}.jpg")
                    ok = _download_image(url, out_path)
                    if ok:
                        counts[species] += 1
                if all(counts[sci] >= per_species_limit for sci in ALLOWED_SCI):
                    break
                offset += limit
        # else: unknown source, skip

    safe_print(json.dumps({"status": "ok", "counts": counts, "output_dir": os.path.abspath(output_dir)}))

def load_image_from_base64(b64: str):
    try:
        from PIL import Image
    except Exception:
        return None
    try:
        data = base64.b64decode(b64)
        img = Image.open(io.BytesIO(data)).convert("RGB")
        return img
    except Exception:
        return None

def infer_local(image_b64: str) -> Dict[str, Any]:
    try:
        import numpy as np
        import tensorflow as tf
        from tensorflow.keras.preprocessing.image import img_to_array
        from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
        from tensorflow.keras.models import load_model
    except Exception:
        return {"common": "Unknown", "scientific": "Unknown", "confidence": 0.0}

    model_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "models", "species_mobilenet.h5"))
    if not os.path.exists(model_path):
        return {"common": "Unknown", "scientific": "Unknown", "confidence": 0.0}

    img = load_image_from_base64(image_b64)
    if img is None:
        return {"common": "Unknown", "scientific": "Unknown", "confidence": 0.0}

    img = img.resize((224, 224))
    arr = img_to_array(img)
    arr = preprocess_input(arr)
    arr = np.expand_dims(arr, axis=0)

    try:
        model = load_model(model_path)
        preds = model.predict(arr, verbose=0)[0]
        idx = int(np.argmax(preds))
        conf = float(np.max(preds))
        spec = IDX_TO_SPECIES.get(idx, {"scientific": "Unknown", "common": "Unknown"})
        return {"common": spec["common"], "scientific": spec["scientific"], "confidence": conf}
    except Exception:
        return {"common": "Unknown", "scientific": "Unknown", "confidence": 0.0}

def train_model(data_dir: str, epochs: int = 5, batch_size: int = 16):
    try:
        import tensorflow as tf
        from tensorflow.keras.preprocessing.image import ImageDataGenerator
        from tensorflow.keras.applications import MobileNetV2
        from tensorflow.keras.layers import Dense, GlobalAveragePooling2D, Dropout
        from tensorflow.keras.models import Model
        from tensorflow.keras.optimizers import Adam
    except Exception as e:
        safe_print(json.dumps({"error": f"TensorFlow not available: {str(e)}"}))
        return

    # Expect directory layout:
    # data_dir/
    #   Elephas maximus/
    #   Panthera tigris/
    #   Panthera pardus/
    #   Bos gaurus/
    #   Melursus ursinus/
    #   Bison bison/
    target_size = (224, 224)
    train_datagen = ImageDataGenerator(
        rescale=1./255,
        rotation_range=20,
        width_shift_range=0.1,
        height_shift_range=0.1,
        shear_range=0.1,
        zoom_range=0.2,
        horizontal_flip=True,
        validation_split=0.2
    )
    train_gen = train_datagen.flow_from_directory(
        data_dir,
        target_size=target_size,
        batch_size=batch_size,
        class_mode='categorical',
        subset='training'
    )
    val_gen = train_datagen.flow_from_directory(
        data_dir,
        target_size=target_size,
        batch_size=batch_size,
        class_mode='categorical',
        subset='validation'
    )

    base = MobileNetV2(weights='imagenet', include_top=False, input_shape=(224, 224, 3))
    base.trainable = False
    x = base.output
    x = GlobalAveragePooling2D()(x)
    x = Dropout(0.2)(x)
    preds = Dense(len(ALLOWED), activation='softmax')(x)
    model = Model(inputs=base.input, outputs=preds)
    model.compile(optimizer=Adam(learning_rate=1e-4), loss='categorical_crossentropy', metrics=['accuracy'])

    model.fit(train_gen, validation_data=val_gen, epochs=epochs)
    # Fine-tune last blocks
    base.trainable = True
    for layer in base.layers[:-20]:
        layer.trainable = False
    model.compile(optimizer=Adam(learning_rate=1e-5), loss='categorical_crossentropy', metrics=['accuracy'])
    model.fit(train_gen, validation_data=val_gen, epochs=max(2, epochs // 2))

    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "models"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "species_mobilenet.h5")
    model.save(out_path)
    safe_print(json.dumps({"status": "ok", "model_path": out_path}))

def main():
    # Usage:
    # python species_classifier.py {"mode":"infer","image_base64":"..."}
    # python species_classifier.py {"mode":"train","data_dir":"c:/path/to/dataset","epochs":5,"batch_size":16}
    # python species_classifier.py {"mode":"build","api_urls":[...],"output_dir":"./ml/dataset","per_species_limit":100}
    arg = sys.argv[1] if len(sys.argv) > 1 else "{}"
    try:
        payload = json.loads(arg)
    except Exception:
        # Fallback: treat arg as a JSON file path
        try:
            if os.path.exists(arg):
                with open(arg, "r", encoding="utf-8-sig") as f:
                    payload = json.load(f)
            else:
                payload = {}
        except Exception as e:
            safe_print(f"Error loading JSON file: {e}")
            payload = {}
    mode = payload.get("mode") or "infer"
    if mode == "build":
        api_urls = payload.get("api_urls") or []
        output_dir = payload.get("output_dir") or os.path.abspath(os.path.join(os.path.dirname(__file__), "dataset"))
        per_species_limit = int(payload.get("per_species_limit") or 100)
        build_dataset(api_urls, output_dir, per_species_limit)
        return
    if mode == "train":
        data_dir = payload.get("data_dir") or ""
        epochs = int(payload.get("epochs") or 5)
        batch = int(payload.get("batch_size") or 16)
        if not data_dir:
            safe_print(json.dumps({"error": "Missing data_dir"}))
            return
        train_model(data_dir, epochs, batch)
        return
    image_b64 = payload.get("image_base64") or ""
    result = infer_local(image_b64)
    safe_print(json.dumps(result))

if __name__ == "__main__":
    main()
