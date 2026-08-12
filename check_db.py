import sqlite3
conn = sqlite3.connect('inventory.db')
tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables:", tables)
conn.close()
