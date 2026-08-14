"""
Seed script: adds a default store and all menu items to the inventory database.
Run once with: python seed_inventory.py
"""
import sqlite3, uuid, os, datetime

DB_PATH = os.path.join(os.path.dirname(__file__), 'session_data', 'inventory.db')

STORE_NAME = "SIPCHEM HQ"

ITEMS = [
    "BBQ Chicken Sandwich",
    "Blueberry Muffins",
    "Buttered Chicken",
    "Chicken Breast With Sauted Vegetables",
    "Chocolate Muffins",
    "Dawood Basha",
    "Fish Sayadieh",
    "Grilled Halloumi Sandwich",
    "Kafta Batata",
    "Mac & Cheese",
    "Penne Pesto Pasta",
    "Pesto Chicken Sandwich",
    "Pesto Halloumi Sandwich",
    "Sandwiches Roasted Vegetables with Cheese",
    "Smoked Chicken Sandwich",
    "Turkey Sandwich Brown Ciabatta",
    "Turkey Sandwich White Ciabatta",
]

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
now = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

# ── Ensure store exists ──────────────────────────────────────────────────────
existing_store = conn.execute(
    "SELECT id FROM stores WHERE name = ?", (STORE_NAME,)
).fetchone()

if existing_store:
    store_id = existing_store['id']
    print(f"Store already exists: '{STORE_NAME}' (id={store_id})")
else:
    cur = conn.execute(
        "INSERT INTO stores (name, status, created_at) VALUES (?, 'active', ?)",
        (STORE_NAME, now)
    )
    store_id = cur.lastrowid
    print(f"Created store: '{STORE_NAME}' (id={store_id})")

# ── Add items + assign to store ──────────────────────────────────────────────
added = 0
skipped = 0

for item_name in ITEMS:
    # Check if item already exists
    existing = conn.execute(
        "SELECT id FROM items WHERE LOWER(name) = LOWER(?)", (item_name,)
    ).fetchone()

    if existing:
        item_id = existing['id']
        print(f"  [skip] Item already exists: {item_name}")
        skipped += 1
    else:
        cur = conn.execute(
            "INSERT INTO items (name, description, qty_on_hand) VALUES (?, ?, ?)",
            (item_name, "", 0)
        )
        item_id = cur.lastrowid
        print(f"  [add]  Created item: {item_name}")
        added += 1

    # Assign to store if not already there
    inv_row = conn.execute(
        "SELECT id FROM store_inventory WHERE store_id=? AND item_id=?",
        (store_id, item_id)
    ).fetchone()

    if not inv_row:
        conn.execute(
            "INSERT INTO store_inventory (store_id, item_id, qty_on_store, last_updated) VALUES (?,?,?,?)",
            (store_id, item_id, 0, now)
        )

conn.commit()
conn.close()

print(f"\nDone! Added {added} new items, skipped {skipped} existing.")
print(f"All items assigned to store: '{STORE_NAME}'")
