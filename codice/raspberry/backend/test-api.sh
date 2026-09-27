#!/bin/bash
# Test API backend - conta record e gap

echo "=== Test API /sensors/history?hours=1 ==="
echo ""

# Fetch data
curl -s "http://localhost:3001/api/sensors/history?hours=1&tankId=1" > /tmp/api-test.json

# Analizza con Python
python3 << 'PYEOF'
import json

with open('/tmp/api-test.json') as f:
    response = json.load(f)

history = response.get('history', response)

with_data = [x for x in history if x.get('temp') is not None]
with_null = [x for x in history if x.get('temp') is None]

print(f"Total records: {len(history)}")
print(f"With data: {len(with_data)}")
print(f"NULL (gap): {len(with_null)}")
print(f"\nPrimi 10 record:")
for i, r in enumerate(history[:10]):
    temp_str = f"{r['temp']:.1f}°C" if r.get('temp') is not None else "NULL"
    print(f"  {i+1}. {r['time']}: {temp_str}")

# Find gap sequences
print(f"\nGap consecutivi (>= 2 min):")
gap_start = None
for i, r in enumerate(history):
    if r.get('temp') is None and gap_start is None:
        gap_start = i
    elif r.get('temp') is not None and gap_start is not None:
        gap_len = i - gap_start
        if gap_len >= 2:
            print(f"  Slot {gap_start}-{i-1}: {gap_len} minuti NULL")
        gap_start = None
PYEOF
