const fs = require('fs');
const path = require('path');

function splitCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function joinCSVLine(arr) {
  return arr
    .map((v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(',');
}

async function geocode(lat, lon) {
  const url = `https://wildlife-safety-api.onrender.com/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
  if (!res.ok) return 'Unknown wildlife area';
  const j = await res.json();
  const name = j?.display_name || '';
  if (!name || String(name).startsWith('Unknown forest area')) return 'Unknown wildlife area';
  return String(name);
}

async function main() {
  const inputPath = path.resolve(__dirname, '..', 'wildlife_recent.csv');
  const outputPath = path.resolve(__dirname, '..', 'wildlife_recent_addresses.csv');
  if (!fs.existsSync(inputPath)) {
    console.error('input_csv_missing');
    process.exit(1);
  }
  const text = fs.readFileSync(inputPath, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (!lines.length) {
    console.error('empty_csv');
    process.exit(1);
  }
  const header = splitCSVLine(lines[0]);
  const latIdx = header.findIndex((h) => String(h).trim().toLowerCase() === 'lat');
  const lonIdx = header.findIndex((h) => String(h).trim().toLowerCase() === 'lon');
  if (latIdx === -1 || lonIdx === -1) {
    console.error('missing_lat_lon_columns');
    process.exit(1);
  }
  const outHeader = [...header, 'location'];
  const cache = new Map();
  const outRows = [joinCSVLine(outHeader)];
  for (let li = 1; li < lines.length; li++) {
    const row = splitCSVLine(lines[li]);
    if (!row.length) continue;
    const lat = parseFloat(row[latIdx]);
    const lon = parseFloat(row[lonIdx]);
    let loc = 'Unknown wildlife area';
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      if (cache.has(key)) {
        loc = cache.get(key);
      } else {
        try {
          loc = await geocode(lat, lon);
        } catch {
          loc = 'Unknown wildlife area';
        }
        cache.set(key, loc);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    outRows.push(joinCSVLine([...row, loc]));
  }
  fs.writeFileSync(outputPath, outRows.join('\n'));
  console.log(JSON.stringify({ status: 'ok', output: outputPath, rows: outRows.length - 1 }));
}

main().catch((e) => {
  console.error('failed', e?.message || String(e));
  process.exit(1);
});
